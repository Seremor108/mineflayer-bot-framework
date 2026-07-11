'use strict'

const { EventEmitter } = require('node:events')
const { goals: { GoalFollow } } = require('mineflayer-pathfinder')
const { abortableSleep, throwIfAborted, TaskCancelledError } = require('./task-queue')

class FollowService extends EventEmitter {
  constructor ({ bot, tasks, actions, pvp = null, config = {}, logger = console }) {
    super()
    if (!bot) throw new Error('FollowService requires a bot instance.')
    if (!tasks) throw new Error('FollowService requires the task queue.')
    if (!actions) throw new Error('FollowService requires the action service.')

    this.bot = bot
    this.tasks = tasks
    this.actions = actions
    this.pvp = pvp
    this.logger = logger
    this.config = buildFollowConfig(config)

    this.targetName = null
    this.range = this.config.defaultRange
    this.requestedBy = null
    this.followTask = null
    this.pausedReason = null
    this.disposed = false
  }

  start (targetName, options = {}) {
    if (this.disposed) throw new Error('The follow service has been disposed.')

    const requestedTarget = normalizePlayerName(targetName)
    if (!requestedTarget) throw new Error('A player name is required.')
    if (samePlayerName(requestedTarget, this.bot.username)) throw new Error('The bot cannot follow itself.')

    const range = normalizeFollowRange(
      options.range,
      this.config.defaultRange,
      this.config.minimumRange,
      this.config.maximumRange
    )

    if (this.isActive() && samePlayerName(this.targetName, requestedTarget) && this.range === range) {
      return this.getStatus()
    }

    if (this.followTask) this.stop('Follow target changed.')

    this.targetName = requestedTarget
    this.range = range
    this.requestedBy = options.requestedBy ? String(options.requestedBy) : null
    this.pausedReason = null

    const handle = this.tasks.interrupt({
      name: `follow player ${requestedTarget}`,
      source: 'follow',
      priority: Number(this.config.taskPriority) || 10,
      interruptible: true,
      resumeOnInterrupt: true,
      metadata: {
        followPlayer: true,
        target: requestedTarget,
        range,
        requestedBy: this.requestedBy
      },
      run: ({ signal }) => this.runFollow(signal)
    }, {
      resumeCurrent: true,
      reason: `Interrupted to follow ${requestedTarget}.`
    })

    this.followTask = handle
    handle.promise
      .catch(error => {
        if (!(error instanceof TaskCancelledError)) {
          this.logger.debug?.('Follow task ended:', error.message)
        }
      })
      .finally(() => {
        if (this.followTask !== handle) return
        this.followTask = null
        this.targetName = null
        this.requestedBy = null
        this.pausedReason = null
        this.emit('changed', this.getStatus())
      })

    this.emit('changed', this.getStatus())
    return this.getStatus()
  }

  stop (reason = 'Follow mode disabled.') {
    const wasActive = this.isActive()
    const handle = this.followTask

    this.targetName = null
    this.requestedBy = null
    this.pausedReason = null
    this.followTask = null

    if (handle) handle.cancel(reason)
    this.actions.stopPathfinding()
    this.emit('changed', this.getStatus())
    return wasActive
  }

  toggle (targetName, options = {}) {
    if (this.isActive()) {
      this.stop('Follow mode toggled off.')
      return this.getStatus()
    }
    return this.start(targetName, options)
  }

  isActive () {
    return Boolean(this.targetName && this.followTask && !['cancelled', 'failed', 'completed'].includes(this.followTask.status))
  }

  getStatus () {
    return Object.freeze({
      active: this.isActive(),
      target: this.targetName,
      range: this.range,
      requestedBy: this.requestedBy,
      taskId: this.followTask?.id || null,
      taskStatus: this.followTask?.status || null,
      paused: Boolean(this.pausedReason),
      pausedReason: this.pausedReason
    })
  }

  async runFollow (signal) {
    let followedEntityId = null
    let goalActive = false

    try {
      while (this.targetName && !this.disposed) {
        throwIfAborted(signal)

        if (this.config.pauseDuringPvp !== false && this.pvp?.isActive?.()) {
          if (goalActive) {
            this.actions.stopPathfinding()
            goalActive = false
            followedEntityId = null
          }
          this.setPausedReason('pvp')
          await abortableSleep(this.config.pollIntervalMs, signal)
          continue
        }

        const target = findPlayerEntity(this.bot, this.targetName)
        if (!target) {
          if (goalActive) {
            this.actions.stopPathfinding()
            goalActive = false
            followedEntityId = null
          }
          this.setPausedReason('target-unavailable')
          await abortableSleep(this.config.pollIntervalMs, signal)
          continue
        }

        this.setPausedReason(null)
        if (!goalActive || followedEntityId !== target.id) {
          ensureNormalMovements(this.actions)
          this.bot.pathfinder.setGoal(new GoalFollow(target, this.range), true)
          goalActive = true
          followedEntityId = target.id
        }

        await abortableSleep(this.config.pollIntervalMs, signal)
      }

      return 'Follow mode stopped.'
    } finally {
      this.actions.stopPathfinding()
      this.setPausedReason(null)
    }
  }

  setPausedReason (reason) {
    if (this.pausedReason === reason) return
    this.pausedReason = reason
    this.emit('changed', this.getStatus())
  }

  dispose () {
    if (this.disposed) return
    this.disposed = true
    this.stop('Follow service disposed.')
    this.removeAllListeners()
  }
}

function buildFollowConfig (config = {}) {
  const minimumRange = positiveNumber(config.minimumRange, 1)
  const maximumRange = Math.max(minimumRange, positiveNumber(config.maximumRange, 16))
  return Object.freeze({
    defaultRange: normalizeFollowRange(config.defaultRange, 2, minimumRange, maximumRange),
    minimumRange,
    maximumRange,
    taskPriority: finiteNumber(config.taskPriority, 10),
    pollIntervalMs: Math.max(25, finiteNumber(config.pollIntervalMs, 100)),
    pauseDuringPvp: config.pauseDuringPvp !== false
  })
}

function normalizeFollowRange (value, fallback = 2, minimum = 1, maximum = 16) {
  const parsed = value == null || value === '' ? Number(fallback) : Number(value)
  if (!Number.isFinite(parsed)) throw new Error(`"${value}" is not a valid follow range.`)
  return Math.min(Math.max(parsed, minimum), maximum)
}

function normalizePlayerName (name) {
  return String(name || '').trim()
}

function samePlayerName (left, right) {
  return normalizePlayerName(left).toLowerCase() === normalizePlayerName(right).toLowerCase()
}

function findPlayerEntity (bot, playerName) {
  const normalized = normalizePlayerName(playerName).toLowerCase()
  if (!normalized) return null

  const playerRecord = Object.values(bot.players || {}).find(player =>
    player?.username && String(player.username).toLowerCase() === normalized
  )
  const fromPlayers = playerRecord?.entity
  if (isUsablePlayerEntity(bot, fromPlayers, normalized)) return fromPlayers

  return Object.values(bot.entities || {}).find(entity =>
    isUsablePlayerEntity(bot, entity, normalized)
  ) || null
}

function isUsablePlayerEntity (bot, entity, normalizedName) {
  return Boolean(
    entity &&
    entity !== bot.entity &&
    entity.type === 'player' &&
    entity.isValid !== false &&
    entity.position &&
    String(entity.username || '').toLowerCase() === normalizedName
  )
}

function ensureNormalMovements (actions) {
  if (typeof actions.useMovementProfile === 'function' && actions.movementProfiles?.normal) {
    actions.useMovementProfile('normal')
    return
  }
  if (!actions.movements && typeof actions.configureMovements === 'function') {
    actions.configureMovements()
  }
}

function finiteNumber (value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function positiveNumber (value, fallback) {
  const parsed = finiteNumber(value, fallback)
  return Math.max(Number.EPSILON, parsed)
}

module.exports = {
  FollowService,
  buildFollowConfig,
  normalizeFollowRange,
  findPlayerEntity,
  samePlayerName
}
