'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { disconnectBot } = require('../src/bot-lifecycle')

const BUILT_IN_PLUGINS = [
  ['tasks', '../src/plugins/tasks'],
  ['actions', '../src/plugins/actions'],
  ['status-effects', '../src/plugins/status-effects'],
  ['teams', '../src/plugins/teams'],
  ['pvp', '../src/plugins/pvp'],
  ['follow', '../src/plugins/follow'],
  ['commands', '../src/plugins/commands-plugin'],
  ['social', '../src/plugins/social'],
  ['autonomy', '../src/plugins/autonomy'],
  ['safety', '../src/plugins/safety']
]

test('every built-in plugin exports a valid name and setup function', () => {
  for (const [expectedName, modulePath] of BUILT_IN_PLUGINS) {
    const plugin = require(modulePath)
    assert.equal(plugin.name, expectedName, `${modulePath} should export name ${expectedName}`)
    assert.equal(typeof plugin.setup, 'function', `${modulePath} should export setup(context)`)
  }
})

test('commands helper exports remain available without replacing the plugin wrapper', () => {
  const helpers = require('../src/plugins/commands')
  const plugin = require('../src/plugins/commands-plugin')

  assert.equal(typeof helpers.registerBuiltInCommands, 'function')
  assert.equal(typeof helpers.parseFollowCommand, 'function')
  assert.equal(typeof helpers.formatFollowStatus, 'function')
  assert.equal(plugin.name, 'commands')
  assert.equal(typeof plugin.setup, 'function')
})

test('disconnectBot prefers graceful quit', () => {
  const calls = []
  const bot = {
    quit: reason => calls.push(['quit', reason]),
    end: reason => calls.push(['end', reason])
  }

  assert.equal(disconnectBot(bot, 'test reason'), true)
  assert.deepEqual(calls, [['quit', 'test reason']])
})

test('disconnectBot falls back when high-level methods are unavailable', () => {
  const calls = []
  const bot = {
    _client: {
      end: reason => calls.push(['client.end', reason])
    }
  }

  assert.equal(disconnectBot(bot, 'early failure'), true)
  assert.deepEqual(calls, [['client.end', 'early failure']])
})

test('disconnectBot continues after a shutdown method throws', () => {
  const calls = []
  const bot = {
    quit () { throw new Error('not ready') },
    end: reason => calls.push(['end', reason])
  }

  assert.equal(disconnectBot(bot, 'fallback'), true)
  assert.deepEqual(calls, [['end', 'fallback']])
})
