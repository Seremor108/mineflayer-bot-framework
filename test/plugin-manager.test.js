'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { PluginManager } = require('../src/plugin-manager')
const { validatePlugin } = require('../src/plugin-validation')

function createLogger () {
  return {
    debug () {},
    log () {},
    info () {},
    warn () {},
    error () {}
  }
}

test('loads a plugin and removes tracked listeners during unload', async () => {
  const bot = new EventEmitter()
  const manager = new PluginManager({ bot, logger: createLogger() })
  let calls = 0
  let cleanedUp = false

  await manager.load({
    name: 'listener-test',
    setup (context) {
      context.on(bot, 'tick', () => { calls += 1 })
      context.addCleanup(() => { cleanedUp = true })
    }
  })

  bot.emit('tick')
  assert.equal(calls, 1)
  assert.equal(bot.listenerCount('tick'), 1)

  await manager.unload('listener-test')

  bot.emit('tick')
  assert.equal(calls, 1)
  assert.equal(bot.listenerCount('tick'), 0)
  assert.equal(cleanedUp, true)
})

test('shares services between plugins and removes them with their provider', async () => {
  const bot = new EventEmitter()
  const manager = new PluginManager({ bot, logger: createLogger() })
  const service = { answer: 42 }

  await manager.load({
    name: 'provider',
    setup (context) {
      context.provideService('example', service)
    }
  })

  await manager.load({
    name: 'consumer',
    setup (context) {
      assert.equal(context.requireService('example'), service)
    }
  })

  await manager.unload('provider')

  await assert.rejects(
    manager.load({
      name: 'late-consumer',
      setup (context) {
        context.requireService('example')
      }
    }),
    /Required service "example" is not available/
  )
})

test('skips plugins disabled in configuration', async () => {
  const bot = new EventEmitter()
  const manager = new PluginManager({
    bot,
    logger: createLogger(),
    config: {
      plugins: {
        disabled: { enabled: false }
      }
    }
  })
  let loaded = false

  const result = await manager.load({
    name: 'disabled',
    setup () {
      loaded = true
    }
  })

  assert.equal(result, false)
  assert.equal(loaded, false)
  assert.deepEqual(manager.list(), [])
})

test('shared validation rejects invalid lifecycle hooks', () => {
  assert.throws(
    () => validatePlugin({ name: 'bad-teardown', setup () {}, teardown: true }, 'test'),
    /teardown must be a function/
  )
})

test('describes plugin-owned services without exposing service values', async () => {
  const manager = new PluginManager({ bot: new EventEmitter(), logger: createLogger() })

  await manager.load({
    name: 'provider',
    setup (context) { context.provideService('example', { secret: true }) }
  })

  assert.deepEqual(manager.describe('provider'), {
    name: 'provider',
    source: 'inline',
    status: 'loaded',
    services: ['example']
  })
  assert.deepEqual(manager.listServices(), [{ name: 'example', owner: 'provider' }])

  await manager.unloadAll()
})
