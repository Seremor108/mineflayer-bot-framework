'use strict'

const path = require('node:path')
const { normalizePluginModule, validatePlugin } = require('../src/plugin-validation')
const { createMockCommandService, createPluginHarness } = require('../test/helpers/plugin-harness')

const target = process.argv[2]
if (!target) {
  console.error('Usage: npm run plugin:test -- <plugin-file>')
  process.exit(1)
}

void main().catch(error => {
  console.error(`Plugin smoke test failed: ${error.message}`)
  process.exitCode = 1
})

async function main () {
  const file = path.resolve(process.cwd(), target)
  const plugin = validatePlugin(normalizePluginModule(require(file)), file)
  const commands = createMockCommandService()
  const harness = createPluginHarness({ plugin, services: { commands } })

  await harness.load()
  const state = harness.manager.describe(plugin.name)
  if (!state || state.status !== 'loaded') throw new Error('Plugin did not reach loaded status.')
  await harness.unload()
  harness.assertClean()
  if (commands.commands.size !== 0) throw new Error('Plugin left commands registered after unload.')

  console.log(`Plugin smoke test passed: ${plugin.name}.`)
}
