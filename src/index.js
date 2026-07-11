'use strict'

const fs = require('node:fs')
const path = require('node:path')
const mineflayer = require('mineflayer')
const { PluginManager } = require('./plugin-manager')
const tasksPlugin = require('./plugins/tasks')
const actionsPlugin = require('./plugins/actions')
const statusEffectsPlugin = require('./plugins/status-effects')
const teamsPlugin = require('./plugins/teams')
const pvpPlugin = require('./plugins/pvp')
const commandsPlugin = require('./plugins/commands')
const socialPlugin = require('./plugins/social')
const autonomyPlugin = require('./plugins/autonomy')
const safetyPlugin = require('./plugins/safety')

const ROOT_PATH = path.join(__dirname, '..')
const CONFIG_PATH = path.join(ROOT_PATH, 'config.json')
const USER_PLUGINS_PATH = path.join(ROOT_PATH, 'plugins')

let bot = null
let pluginManager = null
let reconnectTimer = null
let shuttingDown = false

function loadConfig () {
  if (!fs.existsSync(CONFIG_PATH)) {
    console.error('Missing config.json. Copy config.example.json to config.json and edit it.')
    process.exit(1)
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'))

  for (const field of ['host', 'username', 'auth']) {
    if (!config[field]) throw new Error(`Missing required config field: ${field}`)
  }

  return {
    port: 25565,
    version: false,
    commandPrefix: '!',
    allowedUsers: [],
    plugins: {},
    reconnect: { enabled: true, delayMs: 5000 },
    ...config,
    reconnect: {
      enabled: true,
      delayMs: 5000,
      ...(config.reconnect || {})
    },
    plugins: {
      ...(config.plugins || {})
    }
  }
}

const config = loadConfig()

async function connect () {
  clearTimeout(reconnectTimer)

  console.log(`Connecting to ${config.host}:${config.port} as ${config.username}...`)

  const currentBot = mineflayer.createBot({
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    version: config.version || false
  })

  const currentManager = new PluginManager({
    bot: currentBot,
    config,
    rootDir: ROOT_PATH
  })

  bot = currentBot
  pluginManager = currentManager

  currentBot.once('login', () => {
    console.log(`Logged in as ${currentBot.username}.`)
  })

  currentBot.once('spawn', () => {
    console.log('Spawned in the world.')
  })

  currentBot.on('kicked', (reason) => {
    console.warn('Kicked:', reason)
  })

  currentBot.on('error', (error) => {
    console.error('Bot error:', error.message)
  })

  currentBot.once('end', async (reason) => {
    console.warn(`Disconnected: ${reason || 'unknown reason'}`)

    await currentManager.unloadAll()

    if (pluginManager === currentManager) pluginManager = null
    if (bot === currentBot) bot = null

    if (!shuttingDown && config.reconnect.enabled) {
      console.log(`Reconnecting in ${config.reconnect.delayMs} ms...`)
      reconnectTimer = setTimeout(() => void connect(), config.reconnect.delayMs)
    }
  })

  try {
    await currentManager.load(tasksPlugin, 'built-in tasks plugin')
    await currentManager.load(actionsPlugin, 'built-in actions plugin')
    await currentManager.load(statusEffectsPlugin, 'built-in status-effects plugin')
    await currentManager.load(teamsPlugin, 'built-in teams plugin')
    await currentManager.load(pvpPlugin, 'built-in pvp plugin')
    await currentManager.load(commandsPlugin, 'built-in commands plugin')
    await currentManager.load(socialPlugin, 'built-in social plugin')
    await currentManager.load(autonomyPlugin, 'built-in autonomy plugin')
    await currentManager.load(safetyPlugin, 'built-in safety plugin')
    await currentManager.loadDirectory(USER_PLUGINS_PATH)
  } catch (error) {
    console.error(error)
    currentBot.quit('Plugin setup failed')
  }
}

async function shutdown (signal) {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(reconnectTimer)

  console.log(`Received ${signal}; shutting down.`)

  const currentBot = bot
  const currentManager = pluginManager

  if (currentManager) {
    await currentManager.unloadAll()
    if (pluginManager === currentManager) pluginManager = null
  }

  if (currentBot) {
    currentBot.quit('Bot shutting down')
  } else {
    process.exit(0)
  }

  setTimeout(() => process.exit(0), 1000).unref()
}

process.on('SIGINT', () => void shutdown('SIGINT'))
process.on('SIGTERM', () => void shutdown('SIGTERM'))

process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error)
  void shutdown('uncaughtException')
})

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection:', reason)
})

void connect()
