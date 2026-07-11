'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { CombatService } = require('../src/combat-service')

function createService (config = {}) {
  let stopCalls = 0
  const bot = {
    username: 'Bot',
    entity: { position: new Vec3(0, 0, 0) },
    entities: {},
    heldItem: null,
    pathfinder: { setGoal () {} },
    deactivateItem () {}
  }
  const actions = {
    stopPathfinding () { stopCalls += 1 },
    hasWeapon () { return true }
  }
  const service = new CombatService({
    bot,
    tasks: { interrupt () { throw new Error('should not enqueue') } },
    actions,
    teams: { isTeammate: entity => entity.username === 'Friend', list: () => [] },
    config,
    logger: { debug () {}, warn () {} }
  })
  return { service, bot, getStopCalls: () => stopCalls }
}

test('inactive PvP polling does not stop unrelated pathfinding', () => {
  const { service, getStopCalls } = createService({ entryPoints: { attacked: true, always: false, nearbyNonTeammate: false } })
  service.tick()
  assert.equal(getStopCalls(), 0)
})

test('PvP target filtering excludes teammates and passive mobs', () => {
  const { service } = createService()
  service.manualOverride = true
  assert.equal(service.isValidTarget({ type: 'player', username: 'Friend', position: new Vec3(1, 0, 0) }), false)
  assert.equal(service.isValidTarget({ type: 'player', username: 'Enemy', position: new Vec3(1, 0, 0) }), true)
  assert.equal(service.isValidTarget({ type: 'mob', kind: 'Passive mobs', position: new Vec3(1, 0, 0) }), false)
  assert.equal(service.isValidTarget({ type: 'hostile', kind: 'Hostile mobs', position: new Vec3(1, 0, 0) }), true)
})
