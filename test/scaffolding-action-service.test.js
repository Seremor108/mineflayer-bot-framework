'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  ScaffoldingActionService,
  DEFAULT_SCAFFOLDING_BLOCK_NAMES,
  buildScaffoldingConfig,
  resolveScaffoldingItems,
  countScaffoldingItems,
  isNoPathError
} = require('../src/scaffolding-action-service')

function noPathError () {
  const error = new Error('No path to the goal!')
  error.name = 'NoPath'
  return error
}

function makeService ({ items = [{ type: 1, count: 8 }], minimumBlocks = 1 } = {}) {
  const movementCalls = []
  const goalCalls = []
  const service = Object.create(ScaffoldingActionService.prototype)

  Object.assign(service, {
    bot: {
      entity: {},
      inventory: { items: () => items },
      pathfinder: {
        setMovements (movements) { movementCalls.push(movements.name) },
        setGoal (goal) { goalCalls.push(goal) }
      }
    },
    scaffoldingConfig: {
      enabled: true,
      retryOnNoPath: true,
      minimumBlocks
    },
    movementProfiles: {
      normal: { name: 'normal' },
      scaffolding: { name: 'scaffolding' }
    },
    scaffoldingItemIds: [1],
    resolvedScaffoldingBlockNames: ['cobblestone'],
    disposed: false,
    logger: { info () {} }
  })

  service.ensureReady = () => {}
  service.stopManualControls = () => {}
  return { service, movementCalls, goalCalls }
}

test('builds conservative pathfinding scaffolding defaults', () => {
  const config = buildScaffoldingConfig()
  assert.equal(config.enabled, true)
  assert.equal(config.retryOnNoPath, true)
  assert.equal(config.allow1by1Towers, true)
  assert.equal(config.placeCost, 2)
  assert.deepEqual(config.blockNames, [...DEFAULT_SCAFFOLDING_BLOCK_NAMES])
})

test('normalizes configured scaffold names and preserves preference order', () => {
  const config = buildScaffoldingConfig({
    blockNames: ['Dirt', 'Cobblestone', 'dirt'],
    minimumBlocks: 4
  })
  assert.deepEqual(config.blockNames, ['dirt', 'cobblestone', 'dirt'])
  assert.equal(config.minimumBlocks, 4)
})

test('resolves only placeable scaffold items and removes duplicate item ids', () => {
  const registry = {
    itemsByName: {
      cobblestone: { id: 4 },
      dirt: { id: 3 },
      stick: { id: 280 }
    },
    blocksByName: {
      cobblestone: { id: 4 },
      dirt: { id: 3 }
    }
  }

  assert.deepEqual(resolveScaffoldingItems(registry, [
    'cobblestone',
    'stick',
    'missing',
    'dirt',
    'cobblestone'
  ]), [
    { name: 'cobblestone', itemId: 4, blockId: 4 },
    { name: 'dirt', itemId: 3, blockId: 3 }
  ])
})

test('counts only configured scaffold item stacks', () => {
  const items = [
    { type: 4, count: 32 },
    { type: 3, count: 12 },
    { type: 5, count: 64 }
  ]
  assert.equal(countScaffoldingItems(items, [4, 3]), 44)
  assert.equal(countScaffoldingItems(items, [1]), 0)
})

test('recognizes Mineflayer Pathfinder NoPath errors only', () => {
  assert.equal(isNoPathError(noPathError()), true)
  assert.equal(isNoPathError(new Error('No path to the goal!')), true)
  const timeout = new Error('Took too long')
  timeout.name = 'Timeout'
  assert.equal(isNoPathError(timeout), false)
})

test('retries a movement-only NoPath result with scaffolding and restores normal movement', async () => {
  const { service, movementCalls, goalCalls } = makeService()
  let attempts = 0
  service.runGoalWithCurrentMovements = async () => {
    attempts += 1
    if (attempts === 1) throw noPathError()
    return 'reached'
  }

  assert.equal(await service.gotoGoal({ name: 'goal' }), 'reached')
  assert.equal(attempts, 2)
  assert.deepEqual(movementCalls, ['normal', 'scaffolding', 'normal'])
  assert.deepEqual(goalCalls, [null])
})

test('does not scaffold for non-NoPath failures', async () => {
  const { service, movementCalls } = makeService()
  const timeout = new Error('Took too long to decide a path.')
  timeout.name = 'Timeout'
  service.runGoalWithCurrentMovements = async () => { throw timeout }

  await assert.rejects(service.gotoGoal({ name: 'goal' }), timeout)
  assert.deepEqual(movementCalls, ['normal'])
})

test('reports insufficient scaffold inventory instead of starting the fallback route', async () => {
  const { service, movementCalls } = makeService({ items: [], minimumBlocks: 3 })
  service.runGoalWithCurrentMovements = async () => { throw noPathError() }

  await assert.rejects(
    service.gotoGoal({ name: 'goal' }),
    error => error.name === 'NoPath' && /at least 3 configured blocks; 0 available/i.test(error.message)
  )
  assert.deepEqual(movementCalls, ['normal'])
})
