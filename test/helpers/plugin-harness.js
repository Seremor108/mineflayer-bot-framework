'use strict'

const { EventEmitter } = require('node:events')
const { PluginManager } = require('../../src/plugin-manager')

function createPluginHarness ({ plugin, pluginConfig = {}, services = {}, bot, logger } = {}) {
  if (!plugin) throw new TypeError('createPluginHarness requires a plugin.')

  const testBot = bot || createMockBot()
  const testLogger = logger || createMockLogger()
  const config = { plugins: { [plugin.name]: pluginConfig } }
  const manager = new PluginManager({ bot: testBot, config, logger: testLogger })
  const providers = Object.entries(services).map(([name, value], index) => ({
    name: `harness-provider-${index}`,
    setup (context) { context.provideService(name, value) }
  }))

  return Object.freeze({
    bot: testBot,
    logger: testLogger,
    manager,
    async load () {
      for (const provider of providers) await manager.load(provider, 'plugin harness')
      return manager.load(plugin, 'plugin harness target')
    },
    async unload () { await manager.unloadAll() },
    assertClean () {
      if (manager.list().length !== 0) throw new Error('Plugin harness still has loaded plugins.')
      if (manager.listServices().length !== 0) throw new Error('Plugin harness still has registered services.')
    }
  })
}

function createMockBot () {
  const bot = new EventEmitter()
  bot.username = 'PluginTestBot'
  bot.chat = () => {}
  bot.whisper = () => {}
  return bot
}

function createMockLogger () {
  return { debug () {}, log () {}, info () {}, warn () {}, error () {} }
}

function createMockCommandService () {
  const commands = new Map()
  return {
    commands,
    register (name, command) {
      if (commands.has(name)) throw new Error(`Command "${name}" is already registered.`)
      commands.set(name, command)
      return () => commands.delete(name)
    }
  }
}

module.exports = {
  createMockBot,
  createMockCommandService,
  createMockLogger,
  createPluginHarness
}
