'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const { Vec3 } = require('vec3')
const { TaskQueue } = require('../src/task-queue')
const {
  FollowService,
  buildFollowConfig,
  normalizeFollowRange,
  findPlayerEntity
} = require('../src/follow-service')
const { parseFollowCommand, formatFollowStatus } = require('../src/plugins/commands')

function createLogger () {
  return { debug () {}, log () {}, info () {}, warn () {}, error () {} }
}

function createFixture ({ pvpActive = false } = {}) {
  const goals = []
  const target = {
    id: 7,
    type: 'player',
    username: 'Alice',
    isValid: true,
    position: new Vec3(4, 64, 0)
  }
  const bot = {
    username: 'TestBot',
    entity: {
      id: 1,
      type: 'player',
      username: 'TestBot',
      position: new Vec3(0, 64, 0)
    },
    players: {
      Alice: { username: 'Alice', entity: target }
    },
    entities: { 1: null, 7: target },
    pathfinder: {
      setGoal (goal, dynamic = false) {
        goals.push({ goal, dynamic })
      }
    }
  }
  bot.entities[1] = bot.entity

  const actions = {
    movements: {},
    stopPathfinding () { bot.pathfinder.setGoal(null) },
    configureMovements () { this.movements = {}; return this.movements }
  }
  let active = pvpActive
  const pvp = {
    isActive: () => active,
    setActive: value => { active = Boolean(value) }
  }
  const tasks = new TaskQueue({ logger: createLogger() })
  const follow = new FollowService({
    bot,
    tasks,
    actions,
    pvp,
    logger: createLogger(),
    config: { pollIntervalMs: 10, taskPriority: 10 }
  })

  return { bot, target, goals, actions, pvp, tasks, follow }
}

async function waitFor (predicate, timeoutMs = 1000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  throw new Error('Timed out waiting for condition.')
}

test('normalizes follow configuration and clamps requested ranges', () => {
  const config = buildFollowConfig({ minimumRange: 2, maximumRange: 5, defaultRange: 3 })
  assert.equal(config.defaultRange, 3)
  assert.equal(normalizeFollowRange(1, config.defaultRange, config.minimumRange, config.maximumRange), 2)
  assert.equal(normalizeFollowRange(10, config.defaultRange, config.minimumRange, config.maximumRange), 5)
  assert.throws(() => normalizeFollowRange('nope'), /valid follow range/)
})

test('finds player entities case-insensitively', () => {
  const { bot, target } = createFixture()
  assert.equal(findPlayerEntity(bot, 'alice'), target)
  assert.equal(findPlayerEntity(bot, 'ALICE'), target)
  assert.equal(findPlayerEntity(bot, 'Missing'), null)
})

test('parses follow command forms', () => {
  assert.deepEqual(parseFollowCommand([], 'Alice'), { operation: 'status' })
  assert.deepEqual(parseFollowCommand(['on'], 'Alice'), { operation: 'on', target: 'Alice', range: undefined })
  assert.deepEqual(parseFollowCommand(['Bob', '3'], 'Alice'), { operation: 'on', target: 'Bob', range: 3 })
  assert.deepEqual(parseFollowCommand(['toggle', 'me', '4'], 'Alice'), { operation: 'toggle', target: 'Alice', range: 4 })
  assert.deepEqual(parseFollowCommand(['off'], 'Alice'), { operation: 'off' })
  assert.match(formatFollowStatus({ active: true, target: 'Alice', range: 2, taskStatus: 'running', pausedReason: 'pvp' }), /paused while PvP is active/)
})

test('follows a visible player with a dynamic GoalFollow', async () => {
  const { goals, tasks, follow } = createFixture()
  follow.start('alice', { range: 3, requestedBy: 'Controller' })

  await waitFor(() => goals.some(entry => entry.goal && entry.dynamic === true))
  const status = follow.getStatus()
  assert.equal(status.active, true)
  assert.equal(status.target, 'alice')
  assert.equal(status.range, 3)
  assert.equal(status.requestedBy, 'Controller')

  follow.stop('Test complete.')
  await waitFor(() => !follow.isActive())
  await tasks.dispose()
})

test('pauses while PvP is active and resumes when PvP is disabled', async () => {
  const { goals, pvp, tasks, follow } = createFixture({ pvpActive: true })
  follow.start('Alice')

  await waitFor(() => follow.getStatus().pausedReason === 'pvp')
  assert.equal(goals.some(entry => entry.goal), false)

  pvp.setActive(false)
  await waitFor(() => goals.some(entry => entry.goal && entry.dynamic === true))
  assert.equal(follow.getStatus().paused, false)

  follow.stop('Test complete.')
  await tasks.dispose()
})

test('restarts follow mode after a higher-priority emergency task', async () => {
  const { goals, tasks, follow } = createFixture()
  follow.start('Alice')
  await waitFor(() => goals.filter(entry => entry.goal).length === 1)

  const interrupted = once(tasks, 'interrupted')
  const emergency = tasks.interrupt({
    name: 'test emergency',
    source: 'safety',
    priority: 1200,
    interruptible: false,
    resumeOnInterrupt: false,
    metadata: { emergency: 'test' },
    run: async ({ sleep }) => sleep(20)
  }, {
    resumeCurrent: true,
    reason: 'Test emergency interruption.'
  })

  await interrupted
  await emergency.promise
  await waitFor(() => goals.filter(entry => entry.goal).length >= 2)

  const status = follow.getStatus()
  assert.equal(status.active, true)
  assert.equal(status.target, 'Alice')
  assert.ok(status.taskStatus === 'running' || status.taskStatus === 'queued')

  follow.stop('Test complete.')
  await tasks.dispose()
})
