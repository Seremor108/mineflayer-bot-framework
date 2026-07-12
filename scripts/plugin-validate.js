'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { normalizePluginModule, validatePlugin } = require('../src/plugin-validation')

const root = path.join(__dirname, '..')
const targets = process.argv.slice(2)
const files = targets.length > 0
  ? targets.map(target => path.resolve(process.cwd(), target))
  : collectPlugins(path.join(root, 'plugins'))

if (files.length === 0) {
  console.error('No plugin files found.')
  process.exit(1)
}

let failed = false
const names = new Map()

for (const file of files) {
  try {
    delete require.cache[require.resolve(file)]
    const plugin = validatePlugin(normalizePluginModule(require(file)), file)
    const previous = names.get(plugin.name)
    if (previous) throw new Error(`Duplicate plugin name "${plugin.name}" also used by ${previous}.`)
    names.set(plugin.name, file)
    console.log(`Valid: ${path.relative(root, file)} (${plugin.name})`)
  } catch (error) {
    failed = true
    console.error(`Invalid: ${path.relative(root, file)}: ${error.message}`)
  }
}

if (failed) process.exit(1)

function collectPlugins (directory) {
  if (!fs.existsSync(directory)) return []
  return fs.readdirSync(directory, { withFileTypes: true })
    .filter(entry => entry.isFile() && entry.name.endsWith('.js'))
    .map(entry => path.join(directory, entry.name))
    .sort()
}
