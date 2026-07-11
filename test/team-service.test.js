'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { Vec3 } = require('vec3')
const { TeamService } = require('../src/team-service')

test('redefines teammates from players within seven blocks', () => {
  const ownTeam = {}
  const bot = {
    username: 'Bot',
    entity: { position: new Vec3(0, 64, 0) },
    players: {
      Near: { entity: { username: 'Near', position: new Vec3(6, 64, 0), isValid: true } },
      Far: { entity: { username: 'Far', position: new Vec3(8, 64, 0), isValid: true } }
    },
    teamMap: { Bot: ownTeam, ScoreboardMate: ownTeam }
  }
  const service = new TeamService(bot)
  assert.deepEqual(service.replaceWithNearbyPlayers(7), ['Near'])
  assert.equal(service.isTeammate('near'), true)
  assert.equal(service.isTeammate('Far'), false)
  assert.equal(service.isTeammate('ScoreboardMate'), true)
})
