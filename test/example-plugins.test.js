'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { EventEmitter } = require('node:events')
const { PluginManager } = require('../src/plugin-manager')
const { validatePlugin } = require('../src/plugin-validation')
const { createMockCommandService } = require('./helpers/plugin-harness')

const ROOT = path.join(__dirname, '..')
const PLUGINS = path.join(ROOT, 'plugins')
const EXAMPLE_FILES = [
  'example-command.js',
  'example-config.js',
  'example-events.js',
  'example-queued-task.js',
  'example-service-provider.js',
  'example-service-user.js'
]

function loadExample (file) {
  return require(path.join(PLUGINS, file))
}

function createLogger () {
  return { debug () {}, log () {}, info () {}, warn () {}, error () {} }
}

test('copyable example plugins are valid and disabled in the example config', () => {
  const config = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.example.json'), 'utf8'))
  const discovered = fs.readdirSync(PLUGINS).filter(file => file.startsWith('example-')).sort()

  assert.deepEqual(discovered, EXAMPLE_FILES)

  for (const file of EXAMPLE_FILES) {
    const plugin = validatePlugin(loadExample(file), file)
    assert.equal(file, `${plugin.name}.js`)
    assert.equal(config.plugins[plugin.name]?.enabled, false, `${plugin.name} should be disabled by default`)
  }
})

test('all examples load together in documented alphabetical dependency order and clean up', async () => {
  const bot = new EventEmitter()
  bot.username = 'ExampleTestBot'
  bot.entity = { position: { x: 0, y: 64, z: 0 } }
  const commands = createMockCommandService()
  const plugins = EXAMPLE_FILES.map(loadExample)
  const enabledConfig = Object.fromEntries(plugins.map(plugin => [plugin.name, {
    enabled: true,
    greeting: 'Test greeting',
    heartbeatMs: 60000
  }]))
  const manager = new PluginManager({
    bot,
    logger: createLogger(),
    config: { plugins: enabledConfig }
  })

  await manager.load({
    name: 'example-test-commands',
    setup (context) { context.provideService('commands', commands) }
  }, 'test command provider')

  for (const [index, plugin] of plugins.entries()) {
    await manager.load(plugin, EXAMPLE_FILES[index])
  }

  assert.deepEqual([...commands.commands.keys()].sort(), [
    'example-echo',
    'example-greet',
    'example-time',
    'example-wait'
  ])
  assert.deepEqual(manager.describe('example-service-provider').services, ['exampleClock'])
  assert.equal(bot.listenerCount('spawn'), 1)
  assert.equal(bot.listenerCount('kicked'), 1)

  bot.emit('spawn')
  await manager.unloadAll()

  assert.equal(commands.commands.size, 0)
  assert.equal(bot.listenerCount('spawn'), 0)
  assert.equal(bot.listenerCount('kicked'), 0)
  assert.deepEqual(manager.listServices(), [])
})
