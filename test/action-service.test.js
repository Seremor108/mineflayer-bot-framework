'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  normalizeDestination,
  normalizeItemQuery,
  getArmorDestination,
  armorScore
} = require('../src/action-service')

test('normalizes equipment destinations and item names', () => {
  assert.equal(normalizeDestination('off hand'), 'off-hand')
  assert.equal(normalizeDestination('chestplate'), 'torso')
  assert.equal(normalizeItemQuery('Diamond Sword'), 'diamond_sword')
})

test('recognizes armor slots and ranks stronger materials higher', () => {
  assert.equal(getArmorDestination('diamond_helmet'), 'head')
  assert.equal(getArmorDestination('iron_chestplate'), 'torso')
  assert.equal(getArmorDestination('golden_leggings'), 'legs')
  assert.equal(getArmorDestination('leather_boots'), 'feet')
  assert.equal(getArmorDestination('diamond_sword'), null)
  assert.ok(armorScore({ name: 'netherite_helmet', enchants: [] }) > armorScore({ name: 'diamond_helmet', enchants: [] }))
})

const { isWeaponItem, weaponScore, matchesItemRules } = require('../src/action-service')

test('recognizes weapons and item-rule wildcards', () => {
  assert.equal(isWeaponItem({ name: 'diamond_sword' }), true)
  assert.equal(isWeaponItem({ name: 'bow' }), false)
  assert.equal(isWeaponItem({ name: 'bow' }, { includeBow: true }), true)
  assert.ok(weaponScore({ name: 'diamond_sword' }) > weaponScore({ name: 'wooden_sword' }))
  assert.equal(matchesItemRules({ name: 'diamond_sword' }, { include: ['diamond_*'] }), true)
  assert.equal(matchesItemRules({ name: 'diamond_sword' }, { include: ['*'], exclude: ['*_sword'] }), false)
})
