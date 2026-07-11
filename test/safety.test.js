'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { findFallingBlockHazard, findHeatHazard, decodeFallingBlock } = require('../src/plugins/safety')

test('finds configured falling blocks above the bot', () => {
  const falling = {
    id: 2,
    name: 'falling_block',
    fallingBlockName: 'anvil',
    position: new Vec3(0.5, 70, 0.5),
    velocity: new Vec3(0, -0.2, 0)
  }
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: { 2: falling }
  }
  assert.equal(findFallingBlockHazard(bot, { blockNames: ['anvil'], horizontalRadius: 1.35, maxVerticalDistance: 12 }), falling)
  assert.equal(findFallingBlockHazard(bot, { blockNames: ['sand'], horizontalRadius: 1.35, maxVerticalDistance: 12 }), null)
})

test('finds nearby lava and decodes falling block state ids', () => {
  const lava = { name: 'lava' }
  const bot = {
    entity: { position: new Vec3(0, 64, 0), isInLava: false },
    blockAt: position => position.x === 1 && position.y === 64 && position.z === 0 ? lava : { name: 'air' },
    registry: { blocksByStateId: { 42: { name: 'sand' } }, blocks: {} }
  }
  assert.equal(findHeatHazard(bot, 2).block, lava)
  assert.deepEqual(decodeFallingBlock(bot, { data: 42 }), { stateId: 42, name: 'sand' })
})
