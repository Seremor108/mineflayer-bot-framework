'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, '..')

function read (relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf8')
}

test('required documentation files exist and are linked from the README', () => {
  const readme = read('README.md')
  const required = [
    'docs/COMMANDS.md',
    'docs/CONFIGURATION.md',
    'docs/PLUGINS.md',
    'docs/FOLLOW_MODE.md',
    'docs/PATHFINDING_SCAFFOLDING.md'
  ]

  for (const file of required) {
    assert.equal(fs.existsSync(path.join(ROOT, file)), true, `${file} should exist`)
    assert.equal(readme.includes(file), true, `${file} should be linked from README.md`)
  }
})

test('the command reference includes every built-in command', () => {
  const commands = read('docs/COMMANDS.md')
  const names = [
    'help',
    'ping',
    'pos',
    'queue',
    'plugins',
    'stop',
    'clear',
    'goto',
    'come',
    'follow',
    'leftblock',
    'rightblock',
    'leftentity',
    'rightentity',
    'jump',
    'sneak',
    'equip',
    'armor',
    'effect',
    'teammates',
    'pvp',
    'social',
    'loot',
    'tossjunk',
    'hello'
  ]

  for (const name of names) {
    assert.equal(commands.includes('`' + name), true, `missing command documentation for ${name}`)
  }
})

test('general documentation labels match the package version', () => {
  const version = require('../package.json').version
  const expected = `Mineflayer Bot Framework v${version}`

  for (const file of ['COMMANDS.md', 'docs/COMMANDS.md', 'docs/CONFIGURATION.md']) {
    assert.equal(read(file).includes(expected), true, `${file} should identify ${expected}`)
  }
})

test('the README documents v1.6 follow priority and plugin order', () => {
  const readme = read('README.md')
  assert.match(readme, /persistent follow mode: `10`/)
  assert.match(readme, /6\. `follow`\s+7\. `commands`/)
  assert.match(readme, /follow off/)
})

test('the README escapes command alternatives inside its Markdown table', () => {
  const readme = read('README.md')
  assert.equal(readme.includes('`plugins [info <name>\\|services]`'), true)
  assert.equal(readme.includes('`plugins [info <name>|services]`'), false)
})
