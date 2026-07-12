'use strict'

const { Vec3 } = require('vec3')
const { isSocialStatus } = require('./status-report-policy')

class SocialService {
  constructor ({ bot, tasks, actions, pvp, commands, config = {}, logger = console }) {
    this.bot = bot
    this.tasks = tasks
    this.actions = actions
    this.pvp = pvp
    this.commands = commands
    this.logger = logger
    this.config = {
      stareBack: {
        enabled: true,
        maxDistance: 12,
        stareAngleDegrees: 12,
        responseAngleDegrees: 18,
        onlyWhenIdle: true,
        aimStepRadians: 0.1,
        ...(config.stareBack || {})
      },
      mimicRepeatedActions: {
        enabled: true,
        threshold: 3,
        windowMs: 2500,
        responseCooldownMs: 5000,
        responseRepetitions: 3,
        pulseMs: 180,
        gapMs: 100,
        botLookAngleDegrees: 22,
        jumpRiseThreshold: 0.2,
        jumpResetMs: 500,
        ...(config.mimicRepeatedActions || {})
      },
      tickIntervalMs: 150,
      ...config
    }
    this.config.stareBack = { enabled: true, maxDistance: 12, stareAngleDegrees: 12, responseAngleDegrees: 18, onlyWhenIdle: true, aimStepRadians: 0.1, ...(config.stareBack || {}) }
    this.config.mimicRepeatedActions = { enabled: true, threshold: 3, windowMs: 2500, responseCooldownMs: 5000, responseRepetitions: 3, pulseMs: 180, gapMs: 100, botLookAngleDegrees: 22, jumpRiseThreshold: 0.2, jumpResetMs: 500, ...(config.mimicRepeatedActions || {}) }

    this.histories = new Map()
    this.lastResponses = new Map()
    this.entityStates = new Map()
    this.stareAimRunning = false
    this.disposed = false
    this.unregisterCommand = commands?.register('social', {
      description: 'Toggle or inspect social behaviors.',
      usage: '!social [stare|mimic] [on|off|status]',
      statusReport: isSocialStatus,
      run: ({ args }) => this.handleCommand(args)
    })
  }

  handleCommand (args) {
    const behavior = String(args[0] || 'status').toLowerCase()
    if (behavior === 'status') return this.statusText()
    const target = behavior === 'stare' ? this.config.stareBack : behavior === 'mimic' ? this.config.mimicRepeatedActions : null
    if (!target) throw new Error('Behavior must be stare or mimic.')
    const mode = String(args[1] || 'status').toLowerCase()
    if (mode === 'status') return `${behavior} is ${target.enabled ? 'on' : 'off'}.`
    if (['on', 'true', 'enable', 'enabled'].includes(mode)) target.enabled = true
    else if (['off', 'false', 'disable', 'disabled'].includes(mode)) target.enabled = false
    else throw new Error('Mode must be on, off, or status.')
    return `${behavior} is now ${target.enabled ? 'on' : 'off'}.`
  }

  statusText () {
    return `Social behaviors: stare ${this.config.stareBack.enabled ? 'on' : 'off'}, mimic ${this.config.mimicRepeatedActions.enabled ? 'on' : 'off'}.`
  }

  tick () {
    if (this.disposed || !this.bot.entity) return
    this.detectJumpStates()
    this.detectShieldStates()
    this.stareBack()
  }

  onCrouch (entity) {
    if (entity?.type === 'player') this.recordAction(entity, 'sneak')
  }

  detectJumpStates () {
    for (const entity of Object.values(this.bot.entities || {})) {
      if (entity?.type !== 'player' || entity === this.bot.entity || entity.isValid === false) continue
      const state = this.getEntityState(entity)
      const now = Date.now()
      const y = entity.position.y
      const deltaY = y - state.lastY
      const rose = deltaY > Math.max(0.05, Number(this.config.mimicRepeatedActions.jumpRiseThreshold) || 0.2)
      if (!state.jumpLatched && rose) {
        state.jumpLatched = true
        state.lastJumpAt = now
        this.recordAction(entity, 'jump')
      }
      if (deltaY <= 0.01 && now - state.lastJumpAt >= Math.max(100, Number(this.config.mimicRepeatedActions.jumpResetMs) || 500)) {
        state.jumpLatched = false
      }
      state.lastY = y
    }
  }

  detectShieldStates () {
    for (const entity of Object.values(this.bot.entities || {})) {
      if (entity?.type !== 'player' || entity === this.bot.entity || entity.isValid === false) continue
      const state = this.getEntityState(entity)
      const blocking = isEntityUsingShield(this.bot, entity)
      if (blocking && !state.shieldBlocking) this.recordAction(entity, 'shield')
      state.shieldBlocking = blocking
    }
  }

  recordAction (entity, action) {
    const config = this.config.mimicRepeatedActions
    if (!config.enabled || !this.isBotLookingAt(entity, config.botLookAngleDegrees)) return
    const now = Date.now()
    const key = `${entity.id}:${action}`
    const history = (this.histories.get(key) || []).filter(timestamp => now - timestamp <= config.windowMs)
    history.push(now)
    this.histories.set(key, history)

    const threshold = Math.max(2, Math.floor(Number(config.threshold) || 3))
    if (history.length < threshold) return
    const lastResponse = this.lastResponses.get(key) || 0
    if (now - lastResponse < Math.max(500, Number(config.responseCooldownMs) || 5000)) return
    this.lastResponses.set(key, now)
    this.histories.set(key, [])

    const handle = this.tasks.enqueue({
      name: `socially mirror ${action} for ${entity.username || 'player'}`,
      source: 'social',
      priority: -10,
      interruptible: true,
      resumeOnInterrupt: false,
      metadata: { socialAction: action, player: entity.username, entityId: entity.id },
      run: ({ signal }) => this.actions.spamSocialAction(action, {
        repetitions: config.responseRepetitions,
        pulseMs: config.pulseMs,
        gapMs: config.gapMs
      }, signal)
    })
    handle.promise.catch(error => this.logger.debug?.('Social response ended:', error.message))
  }

  stareBack () {
    const config = this.config.stareBack
    if (!config.enabled || this.stareAimRunning) return
    if (config.onlyWhenIdle && (this.tasks.list().current || this.tasks.list().pending.length > 0)) return
    if (this.pvp?.lockedTarget) return

    const target = Object.values(this.bot.entities || {})
      .filter(entity => entity?.type === 'player' && entity !== this.bot.entity && entity.isValid !== false)
      .filter(entity => this.bot.entity.position.distanceTo(entity.position) <= Number(config.maxDistance || 12))
      .filter(entity => isEntityLookingAt(this.bot, entity, this.bot.entity, config.stareAngleDegrees))
      .sort((a, b) => this.bot.entity.position.distanceSquared(a.position) - this.bot.entity.position.distanceSquared(b.position))[0]
    if (!target) return

    this.stareAimRunning = true
    this.actions.smoothAimAtEntity(target, {
      durationMs: Math.max(50, Number(this.config.tickIntervalMs) || 150),
      stepMs: Math.max(25, Number(this.config.tickIntervalMs) || 150),
      maxRadiansPerStep: Number(config.aimStepRadians) || 0.1
    }).catch(() => {}).finally(() => { this.stareAimRunning = false })
  }

  isBotLookingAt (entity, angleDegrees) {
    return isEntityLookingAt(this.bot, this.bot.entity, entity, angleDegrees)
  }

  getEntityState (entity) {
    let state = this.entityStates.get(entity.id)
    if (!state) {
      state = { lastY: entity.position.y, jumpLatched: false, lastJumpAt: 0, shieldBlocking: false }
      this.entityStates.set(entity.id, state)
    }
    return state
  }

  forgetEntity (entity) {
    if (!entity) return
    this.entityStates.delete(entity.id)
    for (const key of [...this.histories.keys()]) if (key.startsWith(`${entity.id}:`)) this.histories.delete(key)
  }

  dispose () {
    this.disposed = true
    this.unregisterCommand?.()
    this.histories.clear()
    this.lastResponses.clear()
    this.entityStates.clear()
  }
}

function isEntityLookingAt (bot, viewer, target, angleDegrees = 15) {
  if (!viewer?.position || !target?.position) return false
  const eye = viewer.position.offset(0, viewer.eyeHeight || viewer.height || 1.62, 0)
  const targetPoint = target.position.offset(0, (target.height || 1.8) * 0.65, 0)
  const toTarget = targetPoint.minus(eye)
  if (toTarget.norm() === 0) return true
  const view = viewDirection(viewer.pitch || 0, viewer.headYaw ?? viewer.yaw ?? 0)
  const cosine = view.normalize().dot(toTarget.normalize())
  const threshold = Math.cos((Math.max(1, Number(angleDegrees) || 15) * Math.PI) / 180)
  if (cosine < threshold) return false

  try {
    const hit = bot.world.raycast(eye, toTarget.normalize(), toTarget.norm())
    return !hit || hit.position.distanceTo(target.position) < 1.5
  } catch (_) {
    return true
  }
}

function viewDirection (pitch, yaw) {
  return new Vec3(
    -Math.sin(yaw) * Math.cos(pitch),
    Math.sin(pitch),
    -Math.cos(yaw) * Math.cos(pitch)
  )
}

function isEntityUsingShield (bot, entity) {
  const metadataKeys = bot.registry?.entitiesByName?.[entity.name]?.metadataKeys
  let flags
  if (metadataKeys) {
    const index = metadataKeys.indexOf('living_entity_flags')
    if (index >= 0) flags = entity.metadata?.[index]
  }
  if (typeof flags !== 'number') {
    for (const index of [6, 7, 8, 9]) {
      const candidate = entity.metadata?.[index]
      if (typeof candidate === 'number' && candidate >= 0 && candidate <= 7) {
        flags = candidate
        break
      }
    }
  }
  if (typeof flags !== 'number' || (flags & 0x01) === 0) return false
  const offHand = (flags & 0x02) !== 0
  const item = entity.equipment?.[offHand ? 1 : 0]
  return item?.name === 'shield'
}

module.exports = { SocialService, isEntityLookingAt, isEntityUsingShield, viewDirection }
