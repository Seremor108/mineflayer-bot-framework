'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  createMockCommandService,
  createPluginHarness
} = require('./helpers/plugin-harness')

test('plugin harness loads and fully cleans up a command plugin', async () => {
  const commands = createMockCommandService()
  const harness = createPluginHarness({
    plugin: {
      name: 'example',
      setup (context) {
        const unregister = context.requireService('commands').register('example', {
          async run () { return 'ok' }
        })
        context.addCleanup(unregister)
        context.on(context.bot, 'spawn', () => {})
      }
    },
    services: { commands }
  })

  await harness.load()
  assert.equal(commands.commands.has('example'), true)
  assert.equal(harness.bot.listenerCount('spawn'), 1)

  await harness.unload()
  harness.assertClean()
  assert.equal(commands.commands.size, 0)
  assert.equal(harness.bot.listenerCount('spawn'), 0)
})
