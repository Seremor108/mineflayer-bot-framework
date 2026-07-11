'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const {
  predictProjectileThreat,
  chooseProjectileDodgeDirection,
  isSafeDodgeDirection,
  isShearedSheep,
  findNearestAnimal,
  findVisibleOre,
  findVisibleCake,
  selectFoodItem,
  foodPointsFor
} = require('../src/autonomy-behaviors')
const { buildConfig } = require('../src/autonomy-service')

function block (name, boundingBox = 'block') {
  return { name, boundingBox }
}

function makeGroundedBot ({ unsafe = [] } = {}) {
  const unsafeKeys = new Set(unsafe)
  return {
    entity: { position: new Vec3(0, 64, 0) },
    blockAt (position) {
      const key = `${position.x},${position.y},${position.z}`
      if (position.y === 63) return unsafeKeys.has(key) ? null : block('stone')
      return block('air', 'empty')
    }
  }
}

test('predictProjectileThreat recognizes an incoming arrow', () => {
  const threat = predictProjectileThreat(new Vec3(0, 64, 0), {
    name: 'arrow',
    position: new Vec3(8, 64, 0),
    velocity: new Vec3(-0.5, 0, 0)
  })

  assert.ok(threat)
  assert.equal(threat.name, 'arrow')
  assert.equal(threat.timeTicks, 16)
  assert.equal(threat.horizontalDistance, 0)
})

test('predictProjectileThreat ignores outgoing and unsupported entities', () => {
  assert.equal(predictProjectileThreat(new Vec3(0, 64, 0), {
    name: 'arrow',
    position: new Vec3(8, 64, 0),
    velocity: new Vec3(0.5, 0, 0)
  }), null)

  assert.equal(predictProjectileThreat(new Vec3(0, 64, 0), {
    name: 'item',
    position: new Vec3(8, 64, 0),
    velocity: new Vec3(-0.5, 0, 0)
  }), null)
})

test('safe projectile dodge rejects directions leading over the void', () => {
  const bot = makeGroundedBot({ unsafe: ['0,63,1', '0,63,2'] })
  assert.equal(isSafeDodgeDirection(bot, new Vec3(0, 0, 1), 2), false)
  assert.equal(isSafeDodgeDirection(bot, new Vec3(0, 0, -1), 2), true)

  const direction = chooseProjectileDodgeDirection(bot, {
    name: 'snowball',
    position: new Vec3(8, 64, 0),
    velocity: new Vec3(-0.5, 0, 0)
  }, { dodgeDistance: 2 })

  assert.ok(direction)
  assert.ok(direction.z < 0)
})

test('isShearedSheep supports direct state and metadata flags', () => {
  assert.equal(isShearedSheep({ sheared: true }), true)
  assert.equal(isShearedSheep({ metadata: { 17: 0x10 } }), true)
  assert.equal(isShearedSheep({ metadata: { 17: 0 } }), false)
})

test('findNearestAnimal filters by kind, range, and predicate', () => {
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    entities: {
      1: { id: 1, name: 'sheep', position: new Vec3(6, 64, 0), isValid: true },
      2: { id: 2, name: 'sheep', position: new Vec3(2, 64, 0), isValid: true, sheared: true },
      3: { id: 3, name: 'cow', position: new Vec3(1, 64, 0), isValid: true }
    }
  }

  const sheep = findNearestAnimal(bot, 'sheep', 10, entity => !entity.sheared)
  assert.equal(sheep.id, 1)
  assert.equal(findNearestAnimal(bot, 'cow', 0.5), null)
})

test('findVisibleOre returns the nearest visible configured ore', () => {
  const positions = [new Vec3(7, 64, 0), new Vec3(3, 64, 0), new Vec3(2, 64, 0)]
  const blocks = new Map([
    ['7,64,0', { name: 'diamond_ore', position: positions[0] }],
    ['3,64,0', { name: 'iron_ore', position: positions[1] }],
    ['2,64,0', { name: 'iron_ore', position: positions[2], hidden: true }]
  ])
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry: { blocksByName: { diamond_ore: { id: 1 }, iron_ore: { id: 2 } } },
    findBlocks: () => positions,
    blockAt: position => blocks.get(`${position.x},${position.y},${position.z}`),
    canSeeBlock: candidate => !candidate.hidden
  }

  const ore = findVisibleOre(bot, { blockNames: ['diamond_ore', 'iron_ore'] })
  assert.equal(ore.name, 'iron_ore')
  assert.deepEqual(ore.position, positions[1])
})

test('findVisibleCake returns visible cake and ignores hidden cake', () => {
  const hidden = { name: 'cake', position: new Vec3(2, 64, 0), hidden: true }
  const visible = { name: 'cake', position: new Vec3(5, 64, 0) }
  const bot = {
    entity: { position: new Vec3(0, 64, 0) },
    registry: { blocksByName: { cake: { id: 92 } } },
    findBlocks: () => [hidden.position, visible.position],
    blockAt: position => position.x === 2 ? hidden : visible,
    canSeeBlock: candidate => !candidate.hidden
  }

  assert.equal(findVisibleCake(bot).position.x, 5)
})

test('food selection prefers stronger safe food and honors exclusions', () => {
  const items = [
    { name: 'bread', count: 3 },
    { name: 'cooked_beef', count: 1 },
    { name: 'rotten_flesh', count: 64 }
  ]
  const bot = { inventory: { items: () => items }, registry: {} }

  assert.equal(foodPointsFor(bot, items[1]), 8)
  assert.equal(selectFoodItem(bot).name, 'cooked_beef')
  assert.equal(selectFoodItem(bot, { include: ['bread'] }).name, 'bread')
})

test('v1.4 autonomy configuration keeps all new behaviors independently toggleable', () => {
  const config = buildConfig({
    projectileDodging: { enabled: false },
    eating: { enabled: false },
    animalInteractions: { enabled: true, milkCows: false },
    visibleOreMining: { enabled: true, blockNames: ['diamond_ore'] }
  })

  assert.equal(config.projectileDodging.enabled, false)
  assert.equal(config.eating.enabled, false)
  assert.equal(config.animalInteractions.enabled, true)
  assert.equal(config.animalInteractions.shearSheep, true)
  assert.equal(config.animalInteractions.milkCows, false)
  assert.deepEqual(config.visibleOreMining.blockNames, ['diamond_ore'])
})
