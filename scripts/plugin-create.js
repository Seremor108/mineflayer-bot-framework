'use strict'

const fs = require('node:fs')
const path = require('node:path')
const { PLUGIN_NAME_PATTERN } = require('../src/plugin-validation')

const name = String(process.argv[2] || '').trim()
if (!name) fail('Usage: npm run plugin:create -- <name>')
if (!PLUGIN_NAME_PATTERN.test(name)) fail('Plugin names may contain letters, numbers, hyphens, and underscores, and must start with a letter or number.')

const root = path.join(__dirname, '..')
const target = path.join(root, 'plugins', `${name}.js`)
if (fs.existsSync(target)) fail(`${path.relative(root, target)} already exists.`)

const source = `'use strict'\n\nmodule.exports = {\n  name: '${name}',\n\n  setup (context) {\n    context.logger.info('Ready.')\n\n    context.on(context.bot, 'spawn', () => {\n      context.logger.debug('Bot spawned.')\n    })\n  }\n}\n`

fs.writeFileSync(target, source, { flag: 'wx' })
console.log(`Created ${path.relative(root, target)}.`)
console.log(`Add a "${name}" block under config.plugins to configure or disable it.`)

function fail (message) {
  console.error(message)
  process.exit(1)
}
