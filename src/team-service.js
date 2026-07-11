'use strict'

class TeamService {
  constructor (bot, config = {}) {
    if (!bot) throw new Error('TeamService requires a bot instance.')
    this.bot = bot
    this.config = {
      useScoreboardTeams: true,
      customTeammates: [],
      ...config
    }
    this.customTeammates = new Set(
      (this.config.customTeammates || []).map(normalizeUsername).filter(Boolean)
    )
  }

  isTeammate (entityOrUsername) {
    const username = getUsername(entityOrUsername)
    if (!username) return false
    const normalized = normalizeUsername(username)
    if (normalized === normalizeUsername(this.bot.username)) return true
    if (this.customTeammates.has(normalized)) return true

    if (this.config.useScoreboardTeams !== false) {
      const ownTeam = this.bot.teamMap?.[this.bot.username]
      const theirTeam = this.bot.teamMap?.[username]
      if (ownTeam && theirTeam && ownTeam === theirTeam) return true
    }

    return false
  }

  replaceWithNearbyPlayers (radius = 7) {
    if (!this.bot.entity) throw new Error('The bot has not spawned yet.')
    const safeRadius = Math.max(0, Number(radius) || 7)
    const nearby = Object.values(this.bot.players || {})
      .map(player => player?.entity)
      .filter(entity => entity && entity.isValid !== false && entity.username !== this.bot.username)
      .filter(entity => this.bot.entity.position.distanceTo(entity.position) <= safeRadius)
      .map(entity => entity.username)
      .filter(Boolean)

    this.customTeammates.clear()
    for (const username of nearby) this.customTeammates.add(normalizeUsername(username))
    return nearby.sort((a, b) => a.localeCompare(b))
  }

  set (usernames) {
    this.customTeammates.clear()
    for (const username of usernames || []) {
      const normalized = normalizeUsername(username)
      if (normalized) this.customTeammates.add(normalized)
    }
    return this.list()
  }

  add (username) {
    const normalized = normalizeUsername(username)
    if (!normalized) throw new Error('A username is required.')
    this.customTeammates.add(normalized)
  }

  remove (username) {
    return this.customTeammates.delete(normalizeUsername(username))
  }

  clear () {
    this.customTeammates.clear()
  }

  list () {
    return [...this.customTeammates].sort()
  }
}

function normalizeUsername (username) {
  return String(username || '').trim().toLowerCase()
}

function getUsername (entityOrUsername) {
  if (typeof entityOrUsername === 'string') return entityOrUsername
  return entityOrUsername?.username || null
}

module.exports = { TeamService, normalizeUsername }
