'use strict'

const { Movements } = require('mineflayer-pathfinder')
const { ActionService, normalizeItemQuery } = require('./action-service')
const { throwIfAborted } = require('./task-queue')

const DEFAULT_SCAFFOLDING_BLOCK_NAMES = Object.freeze([
  'cobblestone',
  'cobbled_deepslate',
  'dirt',
  'netherrack'
])

class ScaffoldingActionService extends ActionService {
  constructor (bot, config = {}, logger = console) {
    super(bot, config, logger)
    this.scaffoldingConfig = buildScaffoldingConfig(config.scaffolding)
    this.movementProfiles = {
      normal: null,
      scaffolding: null
    }
    this.scaffoldingItemIds = []
    this.resolvedScaffoldingBlockNames = []
  }

  configureMovements () {
    if (!this.bot.entity || !this.bot.registry) return null

    const normal = super.configureMovements()
    normal.scafoldingBlocks = []
    normal.allow1by1towers = false

    const scaffolding = super.configureMovements()
    const resolved = resolveScaffoldingItems(
      this.bot.registry,
      this.scaffoldingConfig.blockNames
    )

    this.scaffoldingItemIds = resolved.map(candidate => candidate.itemId)
    this.resolvedScaffoldingBlockNames = resolved.map(candidate => candidate.name)
    scaffolding.scafoldingBlocks = [...this.scaffoldingItemIds]
    scaffolding.allow1by1towers = this.scaffoldingConfig.allow1by1Towers !== false
    scaffolding.placeCost = Math.max(0, Number(this.scaffoldingConfig.placeCost) || 2)

    this.movementProfiles.normal = normal
    this.movementProfiles.scaffolding = scaffolding
    this.useMovementProfile('normal')

    if (this.scaffoldingConfig.enabled && this.scaffoldingItemIds.length === 0) {
      this.logger.warn?.('Pathfinding scaffolding is enabled, but none of the configured block names exist in this Minecraft version.')
    }

    return normal
  }

  async gotoGoal (goal, signal) {
    this.ensureReady()
    throwIfAborted(signal)
    if (!this.movementProfiles.normal || !this.movementProfiles.scaffolding) {
      this.configureMovements()
    }

    this.useMovementProfile('normal')

    try {
      return await this.runGoalWithCurrentMovements(goal, signal)
    } catch (error) {
      if (!this.shouldRetryWithScaffolding(error)) throw error

      const available = this.availableScaffoldingBlockCount()
      const minimum = Math.max(1, Math.floor(Number(this.scaffoldingConfig.minimumBlocks) || 1))
      if (available < minimum) {
        const unavailable = new Error(
          `No movement-only path was found, and scaffolding requires at least ${minimum} configured block${minimum === 1 ? '' : 's'}; ${available} available.`
        )
        unavailable.name = 'NoPath'
        unavailable.cause = error
        throw unavailable
      }

      throwIfAborted(signal)
      this.logger.info?.(
        `No movement-only path found; retrying with ${available} scaffold block${available === 1 ? '' : 's'} available.`
      )

      // The first goto has removed its listeners, but the pathfinder can still retain
      // its failed goal. Clear it before changing movement profiles and retrying.
      this.bot.pathfinder.setGoal(null)
      this.stopManualControls({ preserveSneak: true })
      this.useMovementProfile('scaffolding')

      try {
        return await this.runGoalWithCurrentMovements(goal, signal)
      } finally {
        if (!this.disposed && this.movementProfiles.normal) {
          this.useMovementProfile('normal')
        }
      }
    }
  }

  runGoalWithCurrentMovements (goal, signal) {
    return super.gotoGoal(goal, signal)
  }

  shouldRetryWithScaffolding (error) {
    return this.scaffoldingConfig.enabled !== false &&
      this.scaffoldingConfig.retryOnNoPath !== false &&
      isNoPathError(error) &&
      this.scaffoldingItemIds.length > 0
  }

  availableScaffoldingBlockCount () {
    return countScaffoldingItems(
      this.bot.inventory?.items?.() || [],
      this.scaffoldingItemIds
    )
  }

  useMovementProfile (profileName) {
    const profile = this.movementProfiles[profileName]
    if (!profile) throw new Error(`Movement profile "${profileName}" is not configured.`)
    this.bot.pathfinder.setMovements(profile)
    this.movements = profile
    return profile
  }

  getScaffoldingStatus () {
    return Object.freeze({
      enabled: this.scaffoldingConfig.enabled !== false,
      retryOnNoPath: this.scaffoldingConfig.retryOnNoPath !== false,
      configuredBlockNames: Object.freeze([...this.scaffoldingConfig.blockNames]),
      resolvedBlockNames: Object.freeze([...this.resolvedScaffoldingBlockNames]),
      availableBlocks: this.availableScaffoldingBlockCount(),
      minimumBlocks: Math.max(1, Math.floor(Number(this.scaffoldingConfig.minimumBlocks) || 1)),
      allow1by1Towers: this.scaffoldingConfig.allow1by1Towers !== false,
      placeCost: Math.max(0, Number(this.scaffoldingConfig.placeCost) || 2)
    })
  }
}

function buildScaffoldingConfig (config = {}) {
  const blockNames = Array.isArray(config.blockNames)
    ? config.blockNames.map(normalizeItemQuery).filter(Boolean)
    : [...DEFAULT_SCAFFOLDING_BLOCK_NAMES]

  return {
    enabled: true,
    retryOnNoPath: true,
    minimumBlocks: 1,
    placeCost: 2,
    allow1by1Towers: true,
    ...config,
    blockNames
  }
}

function resolveScaffoldingItems (registry, blockNames = DEFAULT_SCAFFOLDING_BLOCK_NAMES) {
  const resolved = []
  const seenIds = new Set()

  for (const requestedName of blockNames || []) {
    const name = normalizeItemQuery(requestedName)
    if (!name) continue
    const item = registry?.itemsByName?.[name]
    const block = registry?.blocksByName?.[name]
    if (!item || !block || !Number.isInteger(item.id) || seenIds.has(item.id)) continue
    seenIds.add(item.id)
    resolved.push({ name, itemId: item.id, blockId: block.id })
  }

  return resolved
}

function countScaffoldingItems (items, itemIds) {
  const allowed = new Set((itemIds || []).filter(Number.isInteger))
  return (items || []).reduce((total, item) => {
    if (!item || !allowed.has(item.type)) return total
    return total + Math.max(0, Number(item.count) || 0)
  }, 0)
}

function isNoPathError (error) {
  return Boolean(error && (
    error.name === 'NoPath' ||
    /no path to the goal/i.test(String(error.message || ''))
  ))
}

function createMovementProfile (bot, config = {}) {
  const movements = new Movements(bot)
  movements.canDig = Boolean(config.canDigWhilePathing)
  movements.allowSprinting = config.allowSprinting !== false
  movements.allowParkour = Boolean(config.allowParkour)
  movements.allow1by1towers = Boolean(config.allow1by1Towers)
  if (Number.isFinite(config.maxDropDown)) {
    movements.maxDropDown = Math.max(0, Math.floor(config.maxDropDown))
  }
  return movements
}

module.exports = {
  ScaffoldingActionService,
  DEFAULT_SCAFFOLDING_BLOCK_NAMES,
  buildScaffoldingConfig,
  resolveScaffoldingItems,
  countScaffoldingItems,
  isNoPathError,
  createMovementProfile
}
