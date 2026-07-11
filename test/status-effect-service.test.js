'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { StatusEffectService } = require('../src/status-effect-service')

test('resolves effect names and checks active amplifiers', () => {
  const bot = {
    registry: {
      effects: { 11: { id: 11, name: 'FireResistance', displayName: 'Fire Resistance' } },
      effectsArray: [{ id: 11, name: 'FireResistance', displayName: 'Fire Resistance' }]
    },
    entity: { effects: { 11: { id: 11, amplifier: 1, duration: 200 } } }
  }
  const service = new StatusEffectService(bot)
  assert.equal(service.resolve('fire resistance').id, 11)
  assert.equal(service.has('FireResistance'), true)
  assert.equal(service.has('fire_resistance', bot.entity, 2), false)
  assert.equal(service.list()[0].level, 2)
})
