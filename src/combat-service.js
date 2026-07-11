'use strict'

const { EventEmitter } = require('node:events')
const { goals: { GoalFollow } } = require('mineflayer-pathfinder')
const { abortableSleep, throwIfAborted } = require('./task-queue')
const { isWeaponItem } = require('./action-service')

class CombatService extends EventEmitter {
  constructor ({ bot, tasks, actions, teams, config = {}, logger = console }) {
    super()
    this.bot = bot
    this.tasks = tasks
    this.actions = actions
    this.teams = teams
    this.logger = logger
    this.config = {
      entryPoints: {
        attacked: true,
        nearbyNonTeammate: false,
        always: false,
        ...(config.entryPoints || {})
      },
      activationDurationMs: 15000,
      nearbyEntryRadius: 6,
      targetSearchRadius: 24,
      attackRadius: 3,
      attackCooldownMs: 625,
      combatPriority: 100,
      attackPlayers: true,
      attackHostileMobs: true,
      equipBestMeleeWeapon: true,
      bow: {
        enabled: true,
        chargeMs: 1000,
        maximumRange: 24,
        preferredRange: 12,
        aimStepRadians: 0.12,
        ...(config.bow || {})
      },
      smoothAim: {
        stepMs: 50,
        maxRadiansPerStep: 0.18,
        ...(config.smoothAim || {})
      },
      retreat: {
        durationMs: 1800,
        priority: 1100,
        ...(config.retreat || {})
      },
      ...config
    }
    this.config.entryPoints = {
      attacked: true,
      nearbyNonTeammate: false,
      always: false,
      ...(config.entryPoints || {})
    }
    this.config.bow = { enabled: true, chargeMs: 1000, maximumRange: 24, preferredRange: 12, aimStepRadians: 0.12, ...(config.bow || {}) }
    this.config.smoothAim = { stepMs: 50, maxRadiansPerStep: 0.18, ...(config.smoothAim || {}) }
    this.config.retreat = { durationMs: 1800, priority: 1100, ...(config.retreat || {}) }

    this.manualOverride = null
    this.activeUntil = 0
    this.lockedTarget = null
    this.combatTask = null
    this.retreatTask = null
    this.lastAttackAt = 0
    this.disposed = false
  }

  setMode (mode) {
    const normalized = String(mode || '').trim().toLowerCase()
    if (['on', 'enabled', 'true'].includes(normalized)) this.manualOverride = true
    else if (['off', 'disabled', 'false'].includes(normalized)) this.manualOverride = false
    else if (['auto', 'config', 'default'].includes(normalized)) this.manualOverride = null
    else throw new Error('PvP mode must be on, off, or auto.')

    if (this.manualOverride === false) this.stop('PvP mode disabled.')
    this.tick()
    return this.getStatus()
  }

  getStatus () {
    return {
      mode: this.manualOverride === null ? 'auto' : (this.manualOverride ? 'on' : 'off'),
      active: this.isActive(),
      target: describeEntity(this.lockedTarget),
      entryPoints: { ...this.config.entryPoints },
      teammates: this.teams.list()
    }
  }

  isActive () {
    if (this.manualOverride === false) return false
    if (this.manualOverride === true) return true
    if (this.config.entryPoints.always) return true
    if (Date.now() < this.activeUntil) return true
    return Boolean(this.config.entryPoints.nearbyNonTeammate && this.findNearbyEnemyPlayer())
  }

  canAttack (entity) {
    return this.isActive() && this.isValidTarget(entity)
  }

  onAttacked (attacker) {
    if (!attacker || attacker === this.bot.entity || attacker.isValid === false) return

    if (!this.actions.hasWeapon({ includeBow: true })) {
      this.startRetreat(attacker)
      return
    }

    if (this.manualOverride !== false && this.config.entryPoints.attacked) {
      this.activeUntil = Date.now() + Math.max(1000, Number(this.config.activationDurationMs) || 15000)
      if (this.isValidTarget(attacker)) this.lockedTarget = attacker
      this.tick()
    }
  }

  tick () {
    if (this.disposed || !this.bot.entity) return
    if (!this.isActive()) {
      if (this.combatTask || this.lockedTarget) this.stop('PvP entry conditions are inactive.')
      return
    }
    if (this.combatTask) return

    const target = this.chooseTarget()
    if (!target) return
    this.lockedTarget = target
    let started = false
    const handle = this.tasks.interrupt({
      name: `PvP: ${describeEntity(target)}`,
      source: 'pvp',
      priority: Number(this.config.combatPriority) || 100,
      interruptible: true,
      resumeOnInterrupt: false,
      metadata: { targetId: target.id, target: describeEntity(target) },
      run: ({ signal }) => {
        started = true
        return this.runCombat(signal)
      }
    }, {
      resumeCurrent: true,
      reason: `Interrupted by PvP against ${describeEntity(target)}.`
    })

    this.combatTask = handle
    handle.promise
      .catch(error => this.logger.debug?.('PvP task ended:', error.message))
      .finally(() => {
        if (this.combatTask === handle) this.combatTask = null
        this.lockedTarget = null
        if (started) this.actions.stopPathfinding()
        try { this.bot.deactivateItem() } catch (_) {}
      })
  }

  stop (reason = 'PvP stopped.') {
    const wasRunning = this.combatTask?.status === 'running'
    if (this.combatTask) this.combatTask.cancel(reason)
    this.combatTask = null
    this.lockedTarget = null
    if (wasRunning) this.actions.stopPathfinding()
    try { this.bot.deactivateItem() } catch (_) {}
  }

  startRetreat (attacker) {
    if (this.retreatTask || !attacker?.position) return
    const handle = this.tasks.interrupt({
      name: `retreat from ${describeEntity(attacker)}`,
      source: 'safety',
      priority: Number(this.config.retreat.priority) || 1100,
      interruptible: false,
      resumeOnInterrupt: false,
      metadata: { emergency: 'unarmed-retreat', attackerId: attacker.id },
      run: ({ signal }) => this.actions.retreatFromEntity(attacker, {
        durationMs: this.config.retreat.durationMs,
        sprint: true,
        jump: true
      }, signal)
    }, {
      resumeCurrent: true,
      reason: 'Interrupted because the unarmed bot was attacked.'
    })
    this.retreatTask = handle
    handle.promise.catch(error => this.logger.warn('Retreat failed:', error.message)).finally(() => {
      if (this.retreatTask === handle) this.retreatTask = null
    })
  }

  chooseTarget () {
    if (this.isValidTarget(this.lockedTarget)) return this.lockedTarget
    const candidates = Object.values(this.bot.entities || {})
      .filter(entity => this.isValidTarget(entity))
      .filter(entity => this.bot.entity.position.distanceTo(entity.position) <= Number(this.config.targetSearchRadius || 24))
      .sort((a, b) => this.bot.entity.position.distanceSquared(a.position) - this.bot.entity.position.distanceSquared(b.position))
    return candidates[0] || null
  }

  findNearbyEnemyPlayer () {
    const radius = Number(this.config.nearbyEntryRadius) || 6
    return Object.values(this.bot.entities || {}).find(entity =>
      entity?.type === 'player' &&
      entity !== this.bot.entity &&
      entity.isValid !== false &&
      !this.teams.isTeammate(entity) &&
      this.bot.entity.position.distanceTo(entity.position) <= radius
    ) || null
  }

  isValidTarget (entity) {
    if (!entity || entity === this.bot.entity || entity.isValid === false || !entity.position) return false
    if (entity.type === 'player') {
      return this.config.attackPlayers !== false && !this.teams.isTeammate(entity)
    }
    return this.config.attackHostileMobs !== false && isHostileMob(entity)
  }

  async runCombat (signal) {
    while (this.isActive()) {
      throwIfAborted(signal)
      const target = this.chooseTarget()
      if (!target) break
      this.lockedTarget = target

      const distance = this.bot.entity.position.distanceTo(target.position)
      if (distance > Number(this.config.targetSearchRadius || 24)) {
        this.lockedTarget = null
        await abortableSleep(100, signal)
        continue
      }

      const held = this.bot.heldItem
      if (this.config.bow.enabled !== false && held?.name === 'bow') {
        await this.handleBow(target, distance, signal)
      } else {
        await this.handleMelee(target, distance, signal)
      }

      await abortableSleep(Math.max(25, Number(this.config.smoothAim.stepMs) || 50), signal)
    }
    return 'PvP engagement ended.'
  }

  async handleMelee (target, distance, signal) {
    if (this.config.equipBestMeleeWeapon !== false) {
      const weapon = await this.actions.equipBestWeapon({ includeBow: false }, signal)
      if (!weapon) {
        this.startRetreat(target)
        throw new Error('No melee weapon is available; retreating.')
      }
    } else if (!isWeaponItem(this.bot.heldItem, { includeBow: false })) {
      this.startRetreat(target)
      throw new Error('No melee weapon is equipped; retreating.')
    }

    const attackRadius = Math.max(1, Number(this.config.attackRadius) || 3)
    if (distance > attackRadius) {
      this.bot.pathfinder.setGoal(new GoalFollow(target, Math.max(1, attackRadius - 0.35)), true)
      await this.actions.smoothAimAtEntity(target, {
        durationMs: Number(this.config.smoothAim.stepMs) || 50,
        stepMs: Number(this.config.smoothAim.stepMs) || 50,
        maxRadiansPerStep: Number(this.config.smoothAim.maxRadiansPerStep) || 0.18
      }, signal)
      return
    }

    this.bot.pathfinder.setGoal(null)
    await this.actions.smoothAimAtEntity(target, {
      durationMs: Number(this.config.smoothAim.stepMs) || 50,
      stepMs: Number(this.config.smoothAim.stepMs) || 50,
      maxRadiansPerStep: Number(this.config.smoothAim.maxRadiansPerStep) || 0.18
    }, signal)

    const cooldown = Math.max(100, Number(this.config.attackCooldownMs) || 625)
    const currentDistance = this.bot.entity.position.distanceTo(target.position)
    if (Date.now() - this.lastAttackAt >= cooldown && currentDistance <= attackRadius && this.isValidTarget(target)) {
      this.bot.attack(target, true)
      this.lastAttackAt = Date.now()
      this.emit('attack', target)
    }
  }

  async handleBow (target, distance, signal) {
    const maximumRange = Math.max(3, Number(this.config.bow.maximumRange) || 24)
    const preferredRange = Math.max(3, Math.min(maximumRange, Number(this.config.bow.preferredRange) || 12))
    if (distance > maximumRange) {
      this.bot.pathfinder.setGoal(new GoalFollow(target, preferredRange), true)
      await this.actions.smoothAimAtEntity(target, {
        durationMs: Number(this.config.smoothAim.stepMs) || 50,
        maxRadiansPerStep: Number(this.config.bow.aimStepRadians) || 0.12
      }, signal)
      return
    }

    this.bot.pathfinder.setGoal(null)
    await this.actions.fireBowAt(target, {
      chargeMs: Number(this.config.bow.chargeMs) || 1000,
      stepMs: Number(this.config.smoothAim.stepMs) || 50,
      maxRadiansPerStep: Number(this.config.bow.aimStepRadians) || 0.12
    }, signal)
    this.lastAttackAt = Date.now()
    this.emit('attack', target)
  }

  dispose () {
    this.disposed = true
    this.stop('Combat service disposed.')
    if (this.retreatTask) this.retreatTask.cancel('Combat service disposed.')
    this.removeAllListeners()
  }
}

function isHostileMob (entity) {
  return entity.type === 'hostile' || entity.kind === 'Hostile mobs'
}

function describeEntity (entity) {
  if (!entity) return null
  return entity.username || entity.displayName || entity.name || `entity ${entity.id}`
}

module.exports = { CombatService, isHostileMob }
