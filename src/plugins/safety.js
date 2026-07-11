'use strict'

const { isBotOnFire, isLavaBlock, isFireBlock } = require('../action-service')

module.exports = {
  name: 'safety',

  setup (context) {
    const tasks = context.requireService('tasks')
    const actions = context.requireService('actions')
    const statusEffects = context.requireService('statusEffects')
    const config = {
      checkIntervalMs: 100,
      fireRetryDelayMs: 2000,
      waterSearchRadius: 12,
      extinguishTimeoutMs: 8000,
      escapeDurationMs: 1800,
      heatHazardRadius: 2,
      emergencyPriority: 1200,
      fallingBlocks: {
        enabled: true,
        horizontalRadius: 1.35,
        maxVerticalDistance: 12,
        dodgeDurationMs: 1000,
        priority: 1300,
        blockNames: ['sand', 'red_sand', 'anvil', 'chipped_anvil', 'damaged_anvil'],
        ...(context.pluginConfig.fallingBlocks || {})
      },
      avoidLavaAndFire: true,
      ignoreHeatWithFireResistance: true,
      ...context.pluginConfig
    }
    config.fallingBlocks = {
      enabled: true,
      horizontalRadius: 1.35,
      maxVerticalDistance: 12,
      dodgeDurationMs: 1000,
      priority: 1300,
      blockNames: ['sand', 'red_sand', 'anvil', 'chipped_anvil', 'damaged_anvil'],
      ...(context.pluginConfig.fallingBlocks || {})
    }

    let activeHeatTask = null
    let activeFallingTask = null
    let lastHeatAttemptAt = 0

    const annotateFallingBlock = packet => {
      const entity = context.bot.entities?.[packet.entityId]
      if (!entity || !isFallingBlockEntity(entity)) return
      const state = decodeFallingBlock(context.bot, packet)
      entity.fallingBlockStateId = state.stateId
      entity.fallingBlockName = state.name
    }

    context.on(context.bot._client, 'spawn_entity', annotateFallingBlock)

    const check = () => {
      if (!context.bot.entity) return
      checkFallingBlocks()
      checkHeatHazards()
    }

    const checkFallingBlocks = () => {
      if (!config.fallingBlocks.enabled || activeFallingTask) return
      const hazard = findFallingBlockHazard(context.bot, config.fallingBlocks)
      if (!hazard) return

      context.logger.warn(`Falling ${hazard.fallingBlockName || 'block'} detected; dodging.`)
      activeFallingTask = tasks.interrupt({
        name: `dodge falling ${hazard.fallingBlockName || 'block'}`,
        source: 'safety',
        priority: Number(config.fallingBlocks.priority) || 1300,
        interruptible: false,
        resumeOnInterrupt: false,
        metadata: { emergency: 'falling-block', entityId: hazard.id, block: hazard.fallingBlockName || null },
        run: ({ signal }) => actions.dodgeFallingBlock(hazard, {
          durationMs: config.fallingBlocks.dodgeDurationMs
        }, signal)
      }, {
        resumeCurrent: true,
        reason: 'Interrupted to avoid a falling block.'
      })

      activeFallingTask.promise
        .catch(error => context.logger.warn('Falling-block response failed:', error.message))
        .finally(() => { activeFallingTask = null })
    }

    const checkHeatHazards = () => {
      if (!config.avoidLavaAndFire || activeHeatTask) return
      if (config.ignoreHeatWithFireResistance !== false && statusEffects.has('FireResistance')) return
      const now = Date.now()
      if (now - lastHeatAttemptAt < Math.max(250, Number(config.fireRetryDelayMs) || 2000)) return

      const hazard = findHeatHazard(context.bot, Number(config.heatHazardRadius) || 2)
      const onFire = isBotOnFire(context.bot)
      if (!hazard && !onFire) return
      lastHeatAttemptAt = now

      const label = onFire ? 'fire' : (hazard?.block?.name || 'heat hazard')
      context.logger.warn(`${label} detected without Fire Resistance; interrupting the current task.`)
      activeHeatTask = tasks.interrupt({
        name: `escape ${label}`,
        source: 'safety',
        priority: Number(config.emergencyPriority) || 1200,
        interruptible: false,
        resumeOnInterrupt: false,
        metadata: { emergency: 'lava-fire', hazard: label },
        run: ({ signal }) => actions.escapeLavaOrFire(hazard?.position, {
          waterSearchRadius: config.waterSearchRadius,
          extinguishTimeoutMs: config.extinguishTimeoutMs,
          escapeDurationMs: config.escapeDurationMs
        }, signal)
      }, {
        resumeCurrent: true,
        reason: `Interrupted to escape ${label}.`
      })

      activeHeatTask.promise
        .catch(error => context.logger.error('Heat-hazard response failed:', error.message))
        .finally(() => { activeHeatTask = null })
    }

    const interval = setInterval(check, Math.max(50, Number(config.checkIntervalMs) || 100))
    context.addCleanup(() => clearInterval(interval))
    context.addCleanup(() => {
      activeHeatTask?.cancel('Safety plugin stopped.')
      activeFallingTask?.cancel('Safety plugin stopped.')
    })
  }
}

function findHeatHazard (bot, radius = 2) {
  if (!bot.entity) return null
  const feet = bot.entity.position.floored()
  if (bot.entity.isInLava) return { position: feet, block: bot.blockAt(feet) }
  const safeRadius = Math.max(0, Math.floor(radius))
  let nearest = null

  for (let x = -safeRadius; x <= safeRadius; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -safeRadius; z <= safeRadius; z += 1) {
        const position = feet.offset(x, y, z)
        const block = bot.blockAt(position)
        if (!isLavaBlock(block) && !isFireBlock(block)) continue
        const distance = bot.entity.position.distanceSquared(position.offset(0.5, 0.5, 0.5))
        if (!nearest || distance < nearest.distance) nearest = { position, block, distance }
      }
    }
  }

  return nearest
}

function findFallingBlockHazard (bot, config = {}) {
  if (!bot.entity) return null
  const horizontalRadius = Math.max(0.25, Number(config.horizontalRadius) || 1.35)
  const maxVertical = Math.max(1, Number(config.maxVerticalDistance) || 12)
  const allowed = new Set((config.blockNames || []).map(name => String(name).toLowerCase()))

  return Object.values(bot.entities || {})
    .filter(isFallingBlockEntity)
    .filter(entity => {
      const dx = entity.position.x - bot.entity.position.x
      const dz = entity.position.z - bot.entity.position.z
      const horizontal = Math.sqrt(dx * dx + dz * dz)
      const vertical = entity.position.y - bot.entity.position.y
      const typeAllowed = !entity.fallingBlockName || allowed.size === 0 || allowed.has(entity.fallingBlockName)
      return typeAllowed && horizontal <= horizontalRadius && vertical >= 0.25 && vertical <= maxVertical && Number(entity.velocity?.y || 0) <= 0.1
    })
    .sort((a, b) => a.position.y - b.position.y)[0] || null
}

function isFallingBlockEntity (entity) {
  return Boolean(entity && ['falling_block', 'falling_sand'].includes(entity.name))
}

function decodeFallingBlock (bot, packet) {
  const raw = Number(packet.objectData ?? packet.data ?? packet.blockState ?? -1)
  if (!Number.isInteger(raw) || raw < 0) return { stateId: null, name: null }
  const state = bot.registry?.blocksByStateId?.[raw]
  if (state) return { stateId: raw, name: state.name }
  const legacyId = raw & 0x0fff
  const legacy = bot.registry?.blocks?.[legacyId]
  return { stateId: raw, name: legacy?.name || null }
}

module.exports.findHeatHazard = findHeatHazard
module.exports.findFallingBlockHazard = findFallingBlockHazard
module.exports.decodeFallingBlock = decodeFallingBlock
module.exports.isFallingBlockEntity = isFallingBlockEntity
