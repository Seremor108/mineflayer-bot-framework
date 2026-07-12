'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const workflow = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'validate-v1.6.yml'),
  'utf8'
)

test('CI validates the locked dependency tree on Node.js 18 and 20', () => {
  assert.match(workflow, /node-version: \[18, 20\]/)
  assert.match(workflow, /run: npm ci/)
  assert.doesNotMatch(workflow, /rm -f package-lock\.json/)
  assert.doesNotMatch(workflow, /\bnpm install\b/)
})

test('CI builds one archive after validation using the package version', () => {
  assert.match(workflow, /needs: validate/)
  assert.match(workflow, /require\('\.\/package\.json'\)\.version/)
  assert.match(workflow, /steps\.package\.outputs\.version/)
  assert.doesNotMatch(workflow, /mineflayer-bot-framework-v1\.6\.1/)
})
