'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  isAutonomyStatus,
  isEffectStatus,
  isFollowStatus,
  isPluginStatus,
  isPvpStatus,
  isSocialStatus,
  isTeammateStatus
} = require('../src/status-report-policy')

const cases = [
  ['follow', isFollowStatus,
    [[], ['status'], ['STATE'], [' status ']],
    [['me'], ['Alice'], ['on'], ['off'], ['toggle']]],
  ['effect', isEffectStatus,
    [['speed'], ['Fire Resistance'], ['12']],
    [[]]],
  ['teammates', isTeammateStatus,
    [[], ['list'], ['LIST']],
    [['near'], ['clear'], ['unknown']]],
  ['pvp', isPvpStatus,
    [[], ['status'], ['STATUS']],
    [['on'], ['off'], ['auto'], ['unknown']]],
  ['social', isSocialStatus,
    [[], ['status'], ['STATUS'], ['stare'], ['mimic'], ['stare', 'STATUS']],
    [['unknown'], ['stare', 'on'], ['mimic', 'off'], ['mimic', 'unknown']]],
  ['autonomy', isAutonomyStatus,
    [[], ['status'], ['STATUS']],
    [['on'], ['off'], ['unknown']]],
  ['plugins', isPluginStatus,
    [[], ['list'], ['LIST'], ['services'], ['SERVICES'], ['info', 'hello']],
    [['info'], ['info', '   '], ['unknown']]]
]

for (const [name, policy, accepted, rejected] of cases) {
  test(`${name} status-report policy accepts only report forms`, () => {
    for (const args of accepted) {
      assert.equal(policy({ args }), true, `expected status report: ${name} ${args.join(' ')}`)
    }
    for (const args of rejected) {
      assert.equal(policy({ args }), false, `expected ordinary command: ${name} ${args.join(' ')}`)
    }
  })
}
