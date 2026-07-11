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
