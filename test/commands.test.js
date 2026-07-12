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

  assert.equal(await commands.executeInput('Alice', 'follow status', 'whisper'), true)
  assert.deepEqual(bot.sentWhispers, [{ username: 'Alice', message: 'Follow mode: on.' }])

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
