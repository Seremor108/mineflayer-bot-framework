'use strict'

const { TaskCancelledError, TaskInterruptedError } = require('./task-queue')

/**
 * Create a command registry that accepts private messages and optionally public chat.
 * Commands may run immediately or create serialized tasks in the shared task queue.
 */
function createCommandService (bot, config, logger, taskQueue, pluginConfig = {}) {
  const prefix = config.commandPrefix || '!'
  const allowedUsers = new Set((config.allowedUsers || []).map(name => String(name).toLowerCase()))
  const acceptWhispers = pluginConfig.acceptWhispers !== false
  const acceptPublic = Boolean(pluginConfig.acceptPublic)
  const whisperPrefixOptional = pluginConfig.whisperPrefixOptional !== false
  const notifyTaskCompletion = pluginConfig.notifyTaskCompletion !== false
  const sendPrivateReplies = pluginConfig.sendPrivateReplies !== false
  const commands = new Map()
  const primaryCommands = new Map()

  const service = Object.freeze({
    register,
    unregister,
    get: name => commands.get(normalizeName(name)) || null,
    list: () => [...primaryCommands.values()].map(command => ({
      name: command.name,
      aliases: [...command.aliases],
      description: command.description,
      usage: command.usage,
      queued: Boolean(command.createTask)
    })),
    executeInput,
    dispose
  })

  async function handleWhisper (username, message) {
    if (!acceptWhispers) return
    await executeInput(username, message, 'whisper')
  }

  async function handleChat (username, message) {
    if (!acceptPublic) return
    await executeInput(username, message, 'chat')
  }

  async function executeInput (username, message, channel = 'whisper') {
    if (!username || username === bot.username) return false
    if (allowedUsers.size > 0 && !allowedUsers.has(String(username).toLowerCase())) return false

    let input = String(message || '').trim()
    if (!input) return false

    if (input.startsWith(prefix)) {
      input = input.slice(prefix.length).trim()
    } else if (channel !== 'whisper' || !whisperPrefixOptional) {
      return false
    }

    if (!input) return false

    const ordinaryReply = createReply(bot, username, channel, logger, sendPrivateReplies)
    let tokens

    try {
      tokens = tokenizeCommandLine(input)
    } catch (error) {
      ordinaryReply(`Could not parse command: ${error.message}`)
      return true
    }

    const [rawName, ...args] = tokens
    const commandName = normalizeName(rawName)
    const command = commands.get(commandName)

    if (!command) {
      ordinaryReply(`Unknown command "${rawName}". Use ${prefix}help.`)
      return true
    }

    let statusReport = false
    try {
      statusReport = isStatusReport(command, { username, args, channel, raw: input })
    } catch (error) {
      logger.error(`[command:${command.name}:status-report]`, error)
      ordinaryReply(`Command failed: ${error.message}`)
      return true
    }
    const reply = createReply(bot, username, channel, logger, sendPrivateReplies || statusReport)

    const commandContext = Object.freeze({
      bot,
      username,
      args,
      reply,
      channel,
      prefix,
      raw: input,
      command: command.name,
      taskQueue
    })

    try {
      if (command.createTask) {
        if (!taskQueue) throw new Error('The task queue is unavailable.')
        const taskSpec = await command.createTask(commandContext)
        validateTaskSpec(command.name, taskSpec)

        const handle = taskQueue.enqueue({
          priority: 0,
          interruptible: true,
          resumeOnInterrupt: true,
          ...taskSpec,
          source: 'user',
          metadata: {
            username,
            command: command.name,
            channel,
            ...(taskSpec.metadata || {})
          }
        })

        ordinaryReply(`Queued #${handle.id}: ${taskSpec.name || command.name}.`)

        handle.promise.then(result => {
          if (!notifyTaskCompletion || taskSpec.notifyCompletion === false) return
          const suffix = result == null || result === '' ? '' : ` ${String(result)}`
          reply(`Task #${handle.id} completed.${suffix}`)
        }).catch(error => {
          if (!notifyTaskCompletion || taskSpec.notifyCompletion === false) return
          if (error instanceof TaskCancelledError || error instanceof TaskInterruptedError) {
            ordinaryReply(`Task #${handle.id} cancelled: ${error.message}`)
          } else {
            ordinaryReply(`Task #${handle.id} failed: ${error.message}`)
          }
        })
      } else {
        const result = await command.run(commandContext)
        if (result !== undefined && result !== null && result !== '') reply(String(result))
      }
    } catch (error) {
      logger.error(`[command:${command.name}]`, error)
      ordinaryReply(`Command failed: ${error.message}`)
    }

    return true
  }

  function register (name, command) {
    const normalizedName = normalizeName(name)
    if (!normalizedName) throw new TypeError('Command names cannot be empty.')
    if (!command || (typeof command.run !== 'function' && typeof command.createTask !== 'function')) {
      throw new TypeError(`Command "${normalizedName}" must define run(context) or createTask(context).`)
    }
    if (commands.has(normalizedName)) throw new Error(`Command "${normalizedName}" is already registered.`)

    const aliases = [...new Set((command.aliases || []).map(normalizeName).filter(Boolean))]
    for (const alias of aliases) {
      if (commands.has(alias)) throw new Error(`Command alias "${alias}" is already registered.`)
    }

    const record = Object.freeze({
      name: normalizedName,
      aliases: Object.freeze(aliases),
      description: command.description || 'No description provided.',
      usage: command.usage || `${prefix}${normalizedName}`,
      statusReport: command.statusReport,
      run: command.run,
      createTask: command.createTask
    })

    primaryCommands.set(normalizedName, record)
    commands.set(normalizedName, record)
    for (const alias of aliases) commands.set(alias, record)

    return () => unregister(normalizedName)
  }

  function unregister (name) {
    const record = commands.get(normalizeName(name))
    if (!record) return false

    primaryCommands.delete(record.name)
    for (const [registeredName, candidate] of commands) {
      if (candidate === record) commands.delete(registeredName)
    }
    return true
  }

  function dispose () {
    bot.removeListener('whisper', handleWhisper)
    bot.removeListener('chat', handleChat)
    commands.clear()
    primaryCommands.clear()
  }

  bot.on('whisper', handleWhisper)
  bot.on('chat', handleChat)

  return service
}

function createReply (bot, username, channel, logger, allowPrivateReply = true) {
  return text => {
    if (channel === 'whisper' && !allowPrivateReply) return false

    try {
      if (channel === 'whisper' && typeof bot.whisper === 'function') {
        bot.whisper(username, String(text))
      } else {
        bot.chat(String(text))
      }
      return true
    } catch (error) {
      logger.warn(`Could not reply to ${username}:`, error.message)
      return false
    }
  }
}

function isStatusReport (command, context) {
  if (command.statusReport === true) return true
  if (typeof command.statusReport === 'function') return Boolean(command.statusReport(context))
  return false
}

function tokenizeCommandLine (input) {
  const tokens = []
  let token = ''
  let quote = null
  let escaping = false
  let tokenStarted = false

  for (const character of String(input)) {
    if (escaping) {
      token += character
      tokenStarted = true
      escaping = false
      continue
    }

    if (character === '\\') {
      escaping = true
      tokenStarted = true
      continue
    }

    if (quote) {
      if (character === quote) {
        quote = null
      } else {
        token += character
      }
      tokenStarted = true
      continue
    }

    if (character === '"' || character === "'") {
      quote = character
      tokenStarted = true
      continue
    }

    if (/\s/.test(character)) {
      if (tokenStarted) {
        tokens.push(token)
        token = ''
        tokenStarted = false
      }
      continue
    }

    token += character
    tokenStarted = true
  }

  if (escaping) token += '\\'
  if (quote) throw new Error(`Unclosed ${quote} quote.`)
  if (tokenStarted) tokens.push(token)
  return tokens
}

function validateTaskSpec (commandName, taskSpec) {
  if (!taskSpec || typeof taskSpec !== 'object' || typeof taskSpec.run !== 'function') {
    throw new TypeError(`Queued command "${commandName}" must return a task with run(context).`)
  }
}

function normalizeName (name) {
  return String(name || '').trim().toLowerCase()
}

module.exports = { createCommandService, tokenizeCommandLine, normalizeName }
