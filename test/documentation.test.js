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

test('the README documents v1.6 follow priority and plugin order', () => {
  const readme = read('README.md')
  assert.match(readme, /persistent follow mode: `10`/)
  assert.match(readme, /6\. `follow`\s+7\. `commands`/)
  assert.match(readme, /follow off/)
})

test('README Markdown tables have consistent unescaped column separators', () => {
  const readme = read('README.md')
  let expectedSeparators = null

  for (const [index, line] of readme.split('\n').entries()) {
    if (!line.trimStart().startsWith('|')) {
      expectedSeparators = null
      continue
    }

    const separators = countUnescapedPipes(line)
    if (expectedSeparators === null) expectedSeparators = separators
    assert.equal(separators, expectedSeparators, `README.md:${index + 1} has inconsistent table columns`)
  }
})

function countUnescapedPipes (line) {
  let count = 0
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '|' && line[index - 1] !== '\\') count += 1
  }
  return count
}
