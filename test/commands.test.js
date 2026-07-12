'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter, once } = require('node:events')
const { createCommandService, tokenizeCommandLine } = require('../src/commands')
const { TaskQueue } = require('../src/task-queue')

function createLogger () {
  return { debug () {}, log () {}, info () {}, warn () {}, error () {} }
}

function createBot () {
  const bot = new EventEmitter()
  bot.username = 'TestBot'
  bot.sentWhispers = []
  bot.sentChat = []
  bot.whisper = (username, message) => bot.sentWhispers.push({ username, message })
  bot.chat = message => bot.sentChat.push(message)
  return bot
}

test('tokenizes quoted command arguments', () => {
  assert.deepEqual(
    tokenizeCommandLine('equip "diamond sword" hand'),
    ['equip', 'diamond sword', 'hand']
  )
  assert.deepEqual(
    tokenizeCommandLine("leftentity 'Friendly Villager'"),
    ['leftentity', 'Friendly Villager']
  )
})

test('accepts a prefix-free direct message and adds it to the task queue', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, {
    commandPrefix: '!',
    allowedUsers: ['Alice']
  }, createLogger(), queue, {
    acceptWhispers: true,
    whisperPrefixOptional: true,
    notifyTaskCompletion: true
  })

  let received = null
  commands.register('remember', {
    createTask ({ args }) {
      return {
        name: 'remember message',
        run: async () => { received = args.join(' ') }
      }
    }
  })

  const completed = once(queue, 'completed')
  assert.equal(await commands.executeInput('Alice', 'remember "hello world"', 'whisper'), true)
  await completed

  assert.equal(received, 'hello world')
  assert.match(bot.sentWhispers[0].message, /^Queued #\d+: remember message\.$/)
  assert.match(bot.sentWhispers[1].message, /^Task #\d+ completed\./)

  commands.dispose()
  await queue.dispose()
})

test('ignores unauthorized direct messages', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, {
    commandPrefix: '!',
    allowedUsers: ['Alice']
  }, createLogger(), queue)

  let ran = false
  commands.register('test', {
    run: async () => { ran = true }
  })

  assert.equal(await commands.executeInput('Mallory', 'test', 'whisper'), false)
  assert.equal(ran, false)
  assert.deepEqual(bot.sentWhispers, [])

  commands.dispose()
  await queue.dispose()
})

test('executes private commands without ordinary replies when private replies are disabled', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, {
    commandPrefix: '!',
    allowedUsers: ['Alice']
  }, createLogger(), queue, {
    sendPrivateReplies: false
  })
  let followed = null

  commands.register('follow', {
    statusReport: ({ args }) => !args[0] || args[0] === 'status',
    async run ({ args, reply }) {
      if (args[0] === 'status') return 'Follow mode: on.'
      followed = args[0]
      reply(`Following ${args[0]}.`)
      return `Following ${args[0]}.`
    }
  })

  assert.equal(await commands.executeInput('Alice', 'follow me', 'whisper'), true)
  assert.equal(followed, 'me')
  assert.deepEqual(bot.sentWhispers, [])

  assert.equal(await commands.executeInput('Alice', 'unknown-macro-command', 'whisper'), true)
  assert.deepEqual(bot.sentWhispers, [])

  assert.equal(await commands.executeInput('Alice', 'follow "me', 'whisper'), true)
  assert.deepEqual(bot.sentWhispers, [])

  commands.register('fail-now', {
    async run () { throw new Error('Immediate failure.') }
  })
  assert.equal(await commands.executeInput('Alice', 'fail-now', 'whisper'), true)
  assert.deepEqual(bot.sentWhispers, [])

  assert.equal(await commands.executeInput('Alice', 'follow status', 'whisper'), true)
  assert.deepEqual(bot.sentWhispers, [{ username: 'Alice', message: 'Follow mode: on.' }])

  commands.register('pos', {
    aliases: ['position'],
    statusReport: true,
    async run () { return 'Position: 1.0, 2.0, 3.0.' }
  })
  assert.equal(await commands.executeInput('Alice', 'PoSiTiOn', 'whisper'), true)
  assert.deepEqual(bot.sentWhispers.at(-1), {
    username: 'Alice',
    message: 'Position: 1.0, 2.0, 3.0.'
  })

  commands.dispose()
  await queue.dispose()
})

test('suppresses queued and completion replies but still runs private tasks', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, {
    allowedUsers: ['Alice']
  }, createLogger(), queue, {
    sendPrivateReplies: false,
    notifyTaskCompletion: true
  })
  let ran = false

  commands.register('macro-task', {
    createTask () {
      return {
        name: 'macro task',
        async run () { ran = true }
      }
    }
  })

  const completed = once(queue, 'completed')
  assert.equal(await commands.executeInput('Alice', 'macro-task', 'whisper'), true)
  await completed
  await new Promise(resolve => setImmediate(resolve))

  assert.equal(ran, true)
  assert.deepEqual(bot.sentWhispers, [])

  commands.dispose()
  await queue.dispose()
})

test('private reply setting does not suppress public command replies', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, {
    commandPrefix: '!',
    allowedUsers: ['Alice']
  }, createLogger(), queue, {
    acceptPublic: true,
    sendPrivateReplies: false
  })

  commands.register('say-result', {
    async run () { return 'Public result.' }
  })

  assert.equal(await commands.executeInput('Alice', '!say-result', 'chat'), true)
  assert.deepEqual(bot.sentChat, ['Public result.'])

  commands.dispose()
  await queue.dispose()
})

test('suppresses private task failure and cancellation notices', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, { allowedUsers: ['Alice'] }, createLogger(), queue, {
    sendPrivateReplies: false,
    notifyTaskCompletion: true
  })

  commands.register('fail-task', {
    createTask () {
      return { name: 'failing task', async run () { throw new Error('Expected failure.') } }
    }
  })

  const failed = once(queue, 'failed')
  await commands.executeInput('Alice', 'fail-task', 'whisper')
  await failed
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(bot.sentWhispers, [])

  commands.register('cancel-task', {
    createTask () {
      return {
        name: 'cancellable task',
        async run ({ signal }) {
          await new Promise((resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true })
          })
        }
      }
    }
  })

  const started = once(queue, 'started')
  await commands.executeInput('Alice', 'cancel-task', 'whisper')
  await started
  const cancelled = once(queue, 'cancelled')
  assert.equal(queue.cancelCurrent('Expected cancellation.'), true)
  await cancelled
  await new Promise(resolve => setImmediate(resolve))
  assert.deepEqual(bot.sentWhispers, [])

  commands.dispose()
  await queue.dispose()
})

test('keeps public queued-task replies enabled', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, {
    commandPrefix: '!',
    allowedUsers: ['Alice']
  }, createLogger(), queue, {
    acceptPublic: true,
    sendPrivateReplies: false,
    notifyTaskCompletion: true
  })

  commands.register('public-task', {
    createTask () {
      return { name: 'public task', async run () { return 'Done.' } }
    }
  })

  const completed = once(queue, 'completed')
  await commands.executeInput('Alice', '!public-task', 'chat')
  await completed
  await new Promise(resolve => setImmediate(resolve))

  assert.match(bot.sentChat[0], /^Queued #\d+: public task\.$/)
  assert.match(bot.sentChat[1], /^Task #\d+ completed\. Done\.$/)

  commands.dispose()
  await queue.dispose()
})

test('applies private reply suppression through the whisper event handler', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, { allowedUsers: ['Alice'] }, createLogger(), queue, {
    acceptWhispers: true,
    sendPrivateReplies: false
  })
  let resolveRan
  const ran = new Promise(resolve => { resolveRan = resolve })

  commands.register('macro-event', {
    async run () {
      resolveRan()
      return 'Macro event ran.'
    }
  })

  bot.emit('whisper', 'Alice', 'macro-event')
  await ran
  await new Promise(resolve => setImmediate(resolve))

  assert.deepEqual(bot.sentWhispers, [])

  commands.dispose()
  await queue.dispose()
})

test('contains status-report policy errors without leaking private replies', async () => {
  const bot = createBot()
  const queue = new TaskQueue({ logger: createLogger() })
  const commands = createCommandService(bot, { allowedUsers: ['Alice'] }, createLogger(), queue, {
    sendPrivateReplies: false
  })
  let ran = false

  commands.register('broken-policy', {
    statusReport () { throw new Error('Broken policy.') },
    async run () { ran = true }
  })

  assert.equal(await commands.executeInput('Alice', 'broken-policy', 'whisper'), true)
  assert.equal(ran, false)
  assert.deepEqual(bot.sentWhispers, [])

  commands.dispose()
  await queue.dispose()
})
