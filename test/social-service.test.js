'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { isEntityLookingAt, isEntityUsingShield } = require('../src/social-service')

test('detects when one entity is looking at another', () => {
  const bot = { world: { raycast: () => null } }
  const viewer = { position: new Vec3(0, 0, 0), eyeHeight: 1.62, yaw: Math.PI, pitch: 0 }
  const target = { position: new Vec3(0, 0, 5), height: 1.8 }
  assert.equal(isEntityLookingAt(bot, viewer, target, 10), true)
  viewer.yaw = 0
  assert.equal(isEntityLookingAt(bot, viewer, target, 10), false)
})

test('detects active shield use from living-entity metadata', () => {
  const bot = { registry: { entitiesByName: { player: { metadataKeys: ['shared_flags', 'living_entity_flags'] } } } }
  const entity = {
    name: 'player',
    metadata: [0, 0x03],
    equipment: [null, { name: 'shield' }]
  }
  assert.equal(isEntityUsingShield(bot, entity), true)
  entity.metadata[1] = 0
  assert.equal(isEntityUsingShield(bot, entity), false)
})
