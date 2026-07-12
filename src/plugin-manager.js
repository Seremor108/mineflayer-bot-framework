'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { normalizePluginModule, validatePlugin } = require('./plugin-validation')

class PluginManager {
  constructor ({ bot, config = {}, rootDir = process.cwd(), logger = console }) {
    if (!bot) throw new Error('PluginManager requires a bot instance.')

    this.bot = bot
    this.config = config
    this.rootDir = rootDir
    this.logger = logger
    this.plugins = new Map()
    this.services = new Map()
    this.disposed = false
  }

  async load (pluginModule, source = 'inline') {
    if (this.disposed) throw new Error('Cannot load plugins after the plugin manager has been disposed.')

    const plugin = normalizePluginModule(pluginModule)

    validatePlugin(plugin, source)

    const { name } = plugin
    const pluginConfig = this.config.plugins?.[name] || {}

    if (pluginConfig.enabled === false) {
      this.logger.log(`[plugin:${name}] Disabled.`)
      return false
    }

    if (this.plugins.has(name)) {
      throw new Error(`A plugin named "${name}" is already loaded.`)
    }

    const record = {
      plugin,
      source,
      context: null,
      cleanups: [],
      status: 'loading'
    }

    this.plugins.set(name, record)

    const context = this.createContext(name, pluginConfig, record.cleanups)
    record.context = context

    try {
      const result = await plugin.setup(context)

      if (typeof result === 'function') {
        record.cleanups.push(result)
      } else if (result && typeof result.dispose === 'function') {
        record.cleanups.push(() => result.dispose())
      }

      record.status = 'loaded'
      this.logger.log(`[plugin:${name}] Loaded.`)
      return true
    } catch (error) {
      await runCleanups(record.cleanups, this.logger, name)
      this.plugins.delete(name)
      throw new Error(`Failed to load plugin "${name}" from ${source}: ${error.message}`, { cause: error })
    }
  }

  async loadDirectory (directoryPath) {
    const absolutePath = path.resolve(this.rootDir, directoryPath)

    if (!fs.existsSync(absolutePath)) return []

    const files = fs.readdirSync(absolutePath, { withFileTypes: true })
      .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
      .map(entry => path.join(absolutePath, entry.name))
      .sort()

    const results = []

    for (const filePath of files) {
      try {
        const loaded = await this.load(require(filePath), filePath)
        results.push({ filePath, loaded })
      } catch (error) {
        this.logger.error(error.message)
        results.push({ filePath, loaded: false, error })
      }
    }

    return results
  }

  async unload (name) {
    const record = this.plugins.get(name)
    if (!record) return false

    this.plugins.delete(name)
    record.status = 'unloading'

    if (typeof record.plugin.teardown === 'function') {
      try {
        await record.plugin.teardown(record.context)
      } catch (error) {
        this.logger.error(`[plugin:${name}] Teardown failed:`, error)
      }
    }

    await runCleanups(record.cleanups, this.logger, name)
    record.status = 'unloaded'
    this.logger.log(`[plugin:${name}] Unloaded.`)
    return true
  }

  async unloadAll () {
    if (this.disposed && this.plugins.size === 0) return

    const names = [...this.plugins.keys()].reverse()

    for (const name of names) {
      await this.unload(name)
    }

    this.disposed = true
  }

  list () {
    return [...this.plugins.entries()].map(([name, record]) => ({
      name,
      source: record.source,
      status: record.status
    }))
  }

  describe (name) {
    const record = this.plugins.get(name)
    if (!record) return null

    return {
      name,
      source: record.source,
      status: record.status,
      services: [...this.services.entries()]
        .filter(([, service]) => service.owner === name)
        .map(([serviceName]) => serviceName)
        .sort()
    }
  }

  listServices () {
    return [...this.services.entries()].map(([name, service]) => ({
      name,
      owner: service.owner
    })).sort((left, right) => left.name.localeCompare(right.name))
  }

  createContext (pluginName, pluginConfig, cleanups) {
    const logger = createPluginLogger(this.logger, pluginName)

    const addCleanup = (cleanup) => {
      if (typeof cleanup !== 'function') {
        throw new TypeError('Plugin cleanup must be a function.')
      }

      cleanups.push(cleanup)
      return cleanup
    }

    const on = (emitter, eventName, listener) => {
      if (!emitter || typeof emitter.on !== 'function' || typeof emitter.removeListener !== 'function') {
        throw new TypeError('context.on requires an EventEmitter-like object.')
      }

      emitter.on(eventName, listener)
      addCleanup(() => emitter.removeListener(eventName, listener))
      return listener
    }

    const once = (emitter, eventName, listener) => {
      if (!emitter || typeof emitter.once !== 'function' || typeof emitter.removeListener !== 'function') {
        throw new TypeError('context.once requires an EventEmitter-like object.')
      }

      emitter.once(eventName, listener)
      addCleanup(() => emitter.removeListener(eventName, listener))
      return listener
    }

    const provideService = (serviceName, value) => {
      if (!serviceName || typeof serviceName !== 'string') {
        throw new TypeError('Service names must be non-empty strings.')
      }

      if (this.services.has(serviceName)) {
        const existing = this.services.get(serviceName)
        throw new Error(`Service "${serviceName}" is already provided by plugin "${existing.owner}".`)
      }

      const service = { owner: pluginName, value }
      this.services.set(serviceName, service)

      addCleanup(() => {
        if (this.services.get(serviceName) === service) {
          this.services.delete(serviceName)
        }
      })

      return value
    }

    const getService = (serviceName) => this.services.get(serviceName)?.value

    const requireService = (serviceName) => {
      const service = getService(serviceName)
      if (service === undefined) {
        throw new Error(`Required service "${serviceName}" is not available.`)
      }
      return service
    }

    return Object.freeze({
      bot: this.bot,
      config: this.config,
      pluginConfig: Object.freeze({ ...pluginConfig }),
      logger,
      addCleanup,
      on,
      once,
      provideService,
      getService,
      requireService,
      listPlugins: () => this.list(),
      describePlugin: name => this.describe(name),
      listServices: () => this.listServices()
    })
  }
}

function createPluginLogger (logger, pluginName) {
  const prefix = `[plugin:${pluginName}]`

  return Object.freeze({
    debug: (...args) => (logger.debug || logger.log).call(logger, prefix, ...args),
    log: (...args) => logger.log(prefix, ...args),
    info: (...args) => (logger.info || logger.log).call(logger, prefix, ...args),
    warn: (...args) => logger.warn(prefix, ...args),
    error: (...args) => logger.error(prefix, ...args)
  })
}

async function runCleanups (cleanups, logger, pluginName) {
  for (const cleanup of [...cleanups].reverse()) {
    try {
      await cleanup()
    } catch (error) {
      logger.error(`[plugin:${pluginName}] Cleanup failed:`, error)
    }
  }

  cleanups.length = 0
}

module.exports = { PluginManager }
