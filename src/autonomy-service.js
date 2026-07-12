'use strict'

const {
  AutonomyBehaviors,
  DEFAULT_ORE_NAMES,
  DEFAULT_PROJECTILE_NAMES,
  entityName,
  findNearestAnimal,
  findVisibleCake,
  findVisibleOre,
  isShearedSheep,
  predictProjectileThreat,
  selectFoodItem
} = require('./autonomy-behaviors')
const { isAutonomyStatus } = require('./status-report-policy')

class AutonomyService {
  constructor ({ bot, tasks, actions, commands, config = {}, logger = console }) {
    this.bot = bot
    this.tasks = tasks
    this.actions = actions
    this.commands = commands
    this.logger = logger
    this.behaviors = new AutonomyBehaviors({ bot, actions, logger })
    this.config = buildConfig(config)

    this.lastChecks = {
      projectileDodging: 0,
      eating: 0,
      inventoryToss: 0,
      animalInteractions: 0,
      visibleOreMining: 0,
      chestLooting: 0
    }
    this.activeTasks = {
      projectileDodging: null,
      eating: null,
      inventoryToss: null,
      animalInteractions: null,
      visibleOreMining: null,
      chestLooting: null
    }
    this.visitedChests = new Map()
    this.visitedAnimals = new Map()
    this.visitedOres = new Map()
    this.projectileCooldowns = new Map()
    this.disposed = false

    this.unregisterLoot = commands.register('loot', {
      description: 'Toggle autonomous chest looting.',
      usage: '!loot [on|off|status]',
      statusReport: isAutonomyStatus,
      run: ({ args }) => this.toggle('chestLooting', args[0])
    })
    this.unregisterToss = commands.register('tossjunk', {
      aliases: ['autotoss'],
      description: 'Toggle automatic configured-item disposal when inventory is full.',
      usage: '!tossjunk [on|off|status]',
      statusReport: isAutonomyStatus,
      run: ({ args }) => this.toggle('inventoryToss', args[0])
    })
  }

  toggle (section, mode) {
    const target = this.config[section]
    if (!target || typeof target.enabled !== 'boolean') throw new Error(`Unknown autonomy section "${section}".`)
    const normalized = String(mode || 'status').toLowerCase()
    const labels = {
      chestLooting: 'Autonomous chest looting',
      inventoryToss: 'Automatic item tossing'
    }
    const label = labels[section] || section
    if (normalized === 'status') return `${label} is ${target.enabled ? 'on' : 'off'}.`
    if (['on', 'true', 'enable', 'enabled'].includes(normalized)) target.enabled = true
    else if (['off', 'false', 'disable', 'disabled'].includes(normalized)) target.enabled = false
    else throw new Error('Mode must be on, off, or status.')
    return `${label} is now ${target.enabled ? 'on' : 'off'}.`
  }

  tick () {
    if (this.disposed || !this.bot.entity) return
    const now = Date.now()

    this.runPeriodicCheck('projectileDodging', now, () => this.checkProjectileDodging())
    this.runPeriodicCheck('eating', now, () => this.checkEating())
    this.runPeriodicCheck('inventoryToss', now, () => this.checkInventoryToss())
    this.runPeriodicCheck('animalInteractions', now, () => this.checkAnimalInteractions())
    this.runPeriodicCheck('visibleOreMining', now, () => this.checkVisibleOreMining())
    this.runPeriodicCheck('chestLooting', now, () => this.checkChestLooting())

    this.pruneCooldowns(now)
  }

  runPeriodicCheck (section, now, callback) {
    const config = this.config[section]
    if (!config?.enabled) return
    const interval = Math.max(25, Number(config.checkIntervalMs) || 250)
    if (now - this.lastChecks[section] < interval) return
    this.lastChecks[section] = now
    callback()
  }

  checkProjectileDodging () {
    if (this.activeTasks.projectileDodging) return
    const threat = this.findProjectileThreat()
    if (!threat) return

    const projectile = threat.projectile
    const key = projectileKey(projectile)
    this.projectileCooldowns.set(key, Date.now())
    const handle = this.tasks.interrupt({
      name: `dodge incoming ${threat.name}`,
      source: 'autonomy',
      priority: Number(this.config.projectileDodging.priority) || 1400,
      interruptible: true,
      metadata: {
        autonomy: 'projectile-dodge',
        projectileId: projectile.id,
        projectileName: threat.name,
        timeTicks: threat.timeTicks
      },
      run: ({ signal }) => this.behaviors.dodgeProjectile(projectile, this.config.projectileDodging, signal)
    }, {
      interruptCurrent: true,
      resumeCurrent: true,
      reason: `Interrupted to dodge an incoming ${threat.name}.`
    })
    this.trackTask('projectileDodging', handle, 'Projectile dodge')
  }

  findProjectileThreat () {
    const now = Date.now()
    const cooldown = Math.max(100, Number(this.config.projectileDodging.cooldownMs) || 900)
    return Object.values(this.bot.entities || {})
      .filter(entity => entity && entity !== this.bot.entity && entity.isValid !== false)
      .filter(entity => now - (this.projectileCooldowns.get(projectileKey(entity)) || 0) >= cooldown)
      .map(entity => predictProjectileThreat(this.bot.entity.position, entity, this.config.projectileDodging))
      .filter(Boolean)
      .sort((a, b) => a.timeTicks - b.timeTicks || a.closestDistance - b.closestDistance)[0] || null
  }

  checkEating () {
    if (this.activeTasks.eating || !this.isQueueIdle()) return
    if (!Number.isFinite(this.bot.food)) return
    const threshold = Math.max(1, Math.min(20, Math.floor(Number(this.config.eating.hungerThreshold) || 16)))
    if (this.bot.food >= threshold) return

    const food = selectFoodItem(this.bot, this.config.eating)
    const cake = !food && this.config.eating.eatCake !== false
      ? findVisibleCake(this.bot, this.config.eating)
      : null
    if (!food && !cake) return

    const handle = this.tasks.enqueue({
      name: food ? `eat ${food.name}` : `eat cake at ${cake.position.x}, ${cake.position.y}, ${cake.position.z}`,
      source: 'autonomy',
      priority: Number(this.config.eating.priority) || -5,
      interruptible: true,
      resumeOnInterrupt: false,
      metadata: {
        autonomy: 'eating',
        food: food?.name || 'cake',
        position: cake ? positionMetadata(cake.position) : undefined
      },
      run: ({ signal }) => food
        ? this.behaviors.eatInventoryFood(food, this.config.eating, signal)
        : this.behaviors.eatCake(cake, {
            ...this.config.eating,
            targetFood: this.config.eating.targetFood
          }, signal)
    })
    this.trackTask('eating', handle, 'Automatic eating')
  }

  checkInventoryToss () {
    if (this.activeTasks.inventoryToss || this.bot.inventory.emptySlotCount() > 0) return
    const handle = this.tasks.enqueue({
      name: 'discard configured useless items',
      source: 'autonomy',
      priority: -20,
      interruptible: true,
      resumeOnInterrupt: false,
      metadata: { autonomy: 'inventory-toss' },
      run: ({ signal }) => this.actions.tossConfiguredItems(this.config.inventoryToss, signal)
    })
    this.trackTask('inventoryToss', handle, 'Automatic toss')
  }

  checkAnimalInteractions () {
    if (this.activeTasks.animalInteractions || !this.isQueueIdle()) return
    const config = this.config.animalInteractions
    const radius = Math.max(1, Number(config.searchRadius) || 10)
    const opportunities = []

    if (config.shearSheep && this.actions.findInventoryItemOptional('shears')) {
      const sheep = findNearestAnimal(this.bot, 'sheep', radius, entity =>
        !isShearedSheep(entity) && !this.isAnimalRecentlyVisited('sheep', entity, config.sheepCooldownMs)
      )
      if (sheep) opportunities.push({ kind: 'sheep', entity: sheep })
    }

    if (config.milkCows && this.actions.findInventoryItemOptional('bucket')) {
      const cow = findNearestAnimal(this.bot, 'cow', radius, entity =>
        !this.isAnimalRecentlyVisited('cow', entity, config.cowCooldownMs)
      )
      if (cow) opportunities.push({ kind: 'cow', entity: cow })
    }

    const opportunity = opportunities
      .sort((a, b) => this.bot.entity.position.distanceSquared(a.entity.position) - this.bot.entity.position.distanceSquared(b.entity.position))[0]
    if (!opportunity) return

    const key = animalKey(opportunity.kind, opportunity.entity)
    this.visitedAnimals.set(key, Date.now())
    const handle = this.tasks.enqueue({
      name: opportunity.kind === 'sheep'
        ? `shear ${describeEntity(opportunity.entity)}`
        : `milk ${describeEntity(opportunity.entity)}`,
      source: 'autonomy',
      priority: Number(config.priority) || -35,
      interruptible: true,
      resumeOnInterrupt: false,
      metadata: {
        autonomy: opportunity.kind === 'sheep' ? 'shear-sheep' : 'milk-cow',
        entityId: opportunity.entity.id
      },
      run: ({ signal }) => opportunity.kind === 'sheep'
        ? this.behaviors.shearSheep(opportunity.entity, config, signal)
        : this.behaviors.milkCow(opportunity.entity, config, signal)
    })
    this.trackTask('animalInteractions', handle, 'Animal interaction')
  }

  checkVisibleOreMining () {
    if (this.activeTasks.visibleOreMining || !this.isQueueIdle()) return
    const config = this.config.visibleOreMining
    if (this.bot.inventory.emptySlotCount() === 0) return
    const ore = findVisibleOre(this.bot, config, position => this.isOreRecentlyVisited(position))
    if (!ore) return

    this.visitedOres.set(this.oreKey(ore.position), Date.now())
    const handle = this.tasks.enqueue({
      name: `mine visible ${ore.name} at ${ore.position.x}, ${ore.position.y}, ${ore.position.z}`,
      source: 'autonomy',
      priority: Number(config.priority) || -40,
      interruptible: true,
      resumeOnInterrupt: false,
      metadata: {
        autonomy: 'visible-ore-mining',
        block: ore.name,
        position: positionMetadata(ore.position)
      },
      run: ({ signal }) => this.behaviors.mineOre(ore, config, signal)
    })
    this.trackTask('visibleOreMining', handle, 'Visible ore mining')
  }

  checkChestLooting () {
    if (this.activeTasks.chestLooting || !this.isQueueIdle()) return
    const position = this.findLootableChest()
    if (!position) return
    const key = this.chestKey(position)
    this.visitedChests.set(key, Date.now())

    const handle = this.tasks.enqueue({
      name: `loot chest at ${position.x}, ${position.y}, ${position.z}`,
      source: 'autonomy',
      priority: -30,
      interruptible: true,
      resumeOnInterrupt: false,
      metadata: { autonomy: 'chest-loot', position: positionMetadata(position) },
      run: async ({ signal }) => {
        if (this.bot.inventory.emptySlotCount() === 0 && this.config.inventoryToss.enabled) {
          await this.actions.tossConfiguredItems(this.config.inventoryToss, signal)
        }
        return this.actions.lootChest(position, this.config.chestLooting, signal)
      }
    })
    this.trackTask('chestLooting', handle, 'Chest looting')
  }

  trackTask (section, handle, label) {
    this.activeTasks[section] = handle
    handle.promise
      .catch(error => this.logger.debug?.(`${label} ended:`, error.message))
      .finally(() => {
        if (this.activeTasks[section] === handle) this.activeTasks[section] = null
      })
  }

  isQueueIdle () {
    const state = this.tasks.list()
    return !state.current && state.pending.length === 0
  }

  findLootableChest () {
    const ids = (this.config.chestLooting.blockNames || [])
      .map(name => this.bot.registry.blocksByName?.[String(name)]?.id)
      .filter(Number.isInteger)
    if (ids.length === 0) return null
    const positions = this.bot.findBlocks({
      matching: ids,
      maxDistance: Math.max(1, Number(this.config.chestLooting.searchRadius) || 16),
      count: 24
    }) || []
    return positions
      .filter(position => !this.isRecentlyVisitedChest(position))
      .sort((a, b) => this.bot.entity.position.distanceSquared(a) - this.bot.entity.position.distanceSquared(b))[0] || null
  }

  isRecentlyVisitedChest (position) {
    const visitedAt = this.visitedChests.get(this.chestKey(position)) || 0
    return Date.now() - visitedAt < Math.max(1000, Number(this.config.chestLooting.revisitCooldownMs) || 300000)
  }

  isAnimalRecentlyVisited (kind, entity, cooldownMs) {
    const visitedAt = this.visitedAnimals.get(animalKey(kind, entity)) || 0
    return Date.now() - visitedAt < Math.max(1000, Number(cooldownMs) || 60000)
  }

  isOreRecentlyVisited (position) {
    const visitedAt = this.visitedOres.get(this.oreKey(position)) || 0
    return Date.now() - visitedAt < Math.max(1000, Number(this.config.visibleOreMining.revisitCooldownMs) || 60000)
  }

  chestKey (position) {
    return `${this.bot.game?.dimension || 'unknown'}:${position.x},${position.y},${position.z}`
  }

  oreKey (position) {
    return `${this.bot.game?.dimension || 'unknown'}:${position.x},${position.y},${position.z}`
  }

  pruneCooldowns (now = Date.now()) {
    pruneMap(this.visitedChests, now, Math.max(1000, Number(this.config.chestLooting.revisitCooldownMs) || 300000))
    pruneMap(this.visitedOres, now, Math.max(1000, Number(this.config.visibleOreMining.revisitCooldownMs) || 60000))
    pruneMap(this.projectileCooldowns, now, Math.max(100, Number(this.config.projectileDodging.cooldownMs) || 900) * 4)
    const animalCooldown = Math.max(
      1000,
      Number(this.config.animalInteractions.sheepCooldownMs) || 300000,
      Number(this.config.animalInteractions.cowCooldownMs) || 60000
    )
    pruneMap(this.visitedAnimals, now, animalCooldown)
  }

  dispose () {
    this.disposed = true
    this.unregisterLoot?.()
    this.unregisterToss?.()
    for (const handle of Object.values(this.activeTasks)) handle?.cancel('Autonomy service stopped.')
    this.visitedChests.clear()
    this.visitedAnimals.clear()
    this.visitedOres.clear()
    this.projectileCooldowns.clear()
  }
}

function buildConfig (config) {
  return {
    ...config,
    projectileDodging: {
      enabled: true,
      checkIntervalMs: 75,
      projectileNames: [...DEFAULT_PROJECTILE_NAMES],
      lookAheadTicks: 24,
      minimumSpeed: 0.03,
      threatRadius: 1.4,
      verticalTolerance: 2,
      dodgeDistance: 2.25,
      dodgeDurationMs: 650,
      cooldownMs: 900,
      priority: 1400,
      sprint: true,
      jump: false,
      ...(config.projectileDodging || {})
    },
    eating: {
      enabled: true,
      checkIntervalMs: 500,
      hungerThreshold: 16,
      targetFood: 19,
      priority: -5,
      preferBestFood: true,
      eatCake: true,
      cakeSearchRadius: 12,
      maximumBites: 7,
      include: ['*'],
      exclude: [
        'rotten_flesh',
        'poisonous_potato',
        'spider_eye',
        'pufferfish',
        'chorus_fruit',
        'golden_apple',
        'enchanted_golden_apple'
      ],
      ...(config.eating || {})
    },
    animalInteractions: {
      enabled: false,
      checkIntervalMs: 1500,
      searchRadius: 10,
      shearSheep: true,
      milkCows: true,
      sheepCooldownMs: 300000,
      cowCooldownMs: 60000,
      interactionDelayMs: 300,
      priority: -35,
      ...(config.animalInteractions || {})
    },
    visibleOreMining: {
      enabled: false,
      checkIntervalMs: 1000,
      searchRadius: 16,
      maximumCandidates: 64,
      revisitCooldownMs: 60000,
      priority: -40,
      blockNames: [...DEFAULT_ORE_NAMES],
      ...(config.visibleOreMining || {})
    },
    chestLooting: {
      enabled: false,
      searchRadius: 16,
      checkIntervalMs: 1500,
      revisitCooldownMs: 300000,
      blockNames: ['chest', 'trapped_chest'],
      include: ['*'],
      exclude: [],
      maxPerStack: null,
      ...(config.chestLooting || {})
    },
    inventoryToss: {
      enabled: false,
      checkIntervalMs: 500,
      minimumFreeSlots: 1,
      include: ['rotten_flesh', 'poisonous_potato', 'spider_eye'],
      exclude: [],
      ...(config.inventoryToss || {})
    }
  }
}

function projectileKey (entity) {
  if (entity?.id != null) return `id:${entity.id}`
  const position = entity?.position
  return `${entityName(entity)}:${Math.round(position?.x || 0)},${Math.round(position?.y || 0)},${Math.round(position?.z || 0)}`
}

function animalKey (kind, entity) {
  return `${kind}:${entity?.id ?? describeEntity(entity)}`
}

function positionMetadata (position) {
  return { x: position.x, y: position.y, z: position.z }
}

function describeEntity (entity) {
  return entity?.username || entity?.displayName || entity?.name || `entity ${entity?.id ?? 'unknown'}`
}

function pruneMap (map, now, cooldown) {
  for (const [key, visitedAt] of map) {
    if (now - visitedAt >= cooldown) map.delete(key)
  }
}

module.exports = { AutonomyService, buildConfig }
