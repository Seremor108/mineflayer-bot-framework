'use strict'

const { Vec3 } = require('vec3')
const { abortableSleep, throwIfAborted } = require('./task-queue')
const {
  matchesItemRules,
  normalizeItemQuery,
  raceWithAbort
} = require('./action-service')

const DEFAULT_PROJECTILE_NAMES = Object.freeze([
  'arrow',
  'spectral_arrow',
  'snowball',
  'egg',
  'fireball',
  'small_fireball',
  'dragon_fireball'
])

const DEFAULT_ORE_NAMES = Object.freeze([
  'coal_ore',
  'deepslate_coal_ore',
  'copper_ore',
  'deepslate_copper_ore',
  'iron_ore',
  'deepslate_iron_ore',
  'gold_ore',
  'deepslate_gold_ore',
  'redstone_ore',
  'deepslate_redstone_ore',
  'lapis_ore',
  'deepslate_lapis_ore',
  'diamond_ore',
  'deepslate_diamond_ore',
  'emerald_ore',
  'deepslate_emerald_ore',
  'nether_gold_ore',
  'nether_quartz_ore',
  'ancient_debris'
])

const KNOWN_FOOD_POINTS = Object.freeze({
  apple: 4,
  baked_potato: 5,
  beef: 3,
  beetroot: 1,
  beetroot_soup: 6,
  bread: 5,
  carrot: 3,
  chicken: 2,
  cod: 2,
  cooked_beef: 8,
  cooked_chicken: 6,
  cooked_cod: 5,
  cooked_mutton: 6,
  cooked_porkchop: 8,
  cooked_rabbit: 5,
  cooked_salmon: 6,
  cookie: 2,
  dried_kelp: 1,
  enchanted_golden_apple: 4,
  golden_apple: 4,
  golden_carrot: 6,
  honey_bottle: 6,
  melon_slice: 2,
  mushroom_stew: 6,
  mutton: 2,
  porkchop: 3,
  potato: 1,
  pumpkin_pie: 8,
  rabbit: 3,
  rabbit_stew: 10,
  salmon: 2,
  sweet_berries: 2,
  tropical_fish: 1,
  chorus_fruit: 4,
  rotten_flesh: 4,
  poisonous_potato: 2,
  spider_eye: 2,
  pufferfish: 1
})

class AutonomyBehaviors {
  constructor ({ bot, actions, logger = console }) {
    if (!bot) throw new Error('AutonomyBehaviors requires a bot instance.')
    if (!actions) throw new Error('AutonomyBehaviors requires the action service.')
    this.bot = bot
    this.actions = actions
    this.logger = logger
  }

  async dodgeProjectile (projectile, options = {}, signal) {
    this.actions.ensureReady()
    throwIfAborted(signal)
    if (!projectile?.position || projectile.isValid === false) {
      throw new Error('The incoming projectile is no longer valid.')
    }

    const direction = chooseProjectileDodgeDirection(this.bot, projectile, options)
    if (!direction) throw new Error('No safe projectile dodge direction was found.')

    this.actions.stopPathfinding()
    this.actions.stopManualControls({ preserveSneak: false })
    const lookDistance = Math.max(2, Number(options.lookDistance) || 5)
    const target = this.bot.entity.position
      .plus(direction.scaled(lookDistance))
      .offset(0, this.bot.entity.eyeHeight || 1.62, 0)
    await raceWithAbort(this.bot.lookAt(target, true), signal)

    this.bot.setControlState('forward', true)
    this.bot.setControlState('sprint', options.sprint !== false)
    this.bot.setControlState('jump', Boolean(options.jump))
    try {
      await abortableSleep(clampDuration(options.dodgeDurationMs ?? 650, 100, 3000), signal)
    } finally {
      this.bot.setControlState('forward', false)
      this.bot.setControlState('sprint', false)
      this.bot.setControlState('jump', false)
    }

    return `Dodged ${entityName(projectile) || 'an incoming projectile'}.`
  }

  async shearSheep (sheep, options = {}, signal) {
    this.actions.ensureReady()
    validateEntity(sheep, 'sheep')
    if (isShearedSheep(sheep)) return 'The sheep is already sheared.'

    const shears = this.actions.findInventoryItemOptional('shears')
    if (!shears) throw new Error('No shears are available.')
    const previous = this.bot.heldItem

    await this.actions.moveIntoEntityReach(sheep, signal)
    throwIfAborted(signal)
    await raceWithAbort(this.bot.equip(shears, 'hand'), signal)
    await raceWithAbort(this.actions.lookAtEntity(sheep), signal)
    throwIfAborted(signal)
    this.bot.useOn(sheep)
    await abortableSleep(clampDuration(options.interactionDelayMs ?? 300, 50, 1500), signal)
    await this.restoreHeldItem(previous)
    return `Sheared ${describeEntity(sheep)}.`
  }

  async milkCow (cow, options = {}, signal) {
    this.actions.ensureReady()
    validateEntity(cow, 'cow')
    const bucket = this.actions.findInventoryItemOptional('bucket')
    if (!bucket) throw new Error('No empty bucket is available.')
    const previous = this.bot.heldItem

    await this.actions.moveIntoEntityReach(cow, signal)
    throwIfAborted(signal)
    await raceWithAbort(this.bot.equip(bucket, 'hand'), signal)
    await raceWithAbort(this.actions.lookAtEntity(cow), signal)
    throwIfAborted(signal)
    this.bot.useOn(cow)
    await abortableSleep(clampDuration(options.interactionDelayMs ?? 300, 50, 1500), signal)
    await this.restoreHeldItem(previous)
    return `Milked ${describeEntity(cow)}.`
  }

  async mineOre (blockOrPosition, options = {}, signal) {
    this.actions.ensureReady()
    const block = this.actions.resolveBlock(blockOrPosition)
    const allowed = new Set((options.blockNames || DEFAULT_ORE_NAMES).map(normalizeItemQuery))
    if (!allowed.has(normalizeItemQuery(block.name))) {
      throw new Error(`${block.name} is not a configured ore.`)
    }
    if (typeof this.bot.canSeeBlock === 'function' && !this.bot.canSeeBlock(block)) {
      throw new Error('The ore is no longer visible.')
    }
    if (typeof this.bot.canDigBlock === 'function' && !this.bot.canDigBlock(block)) {
      throw new Error(`The bot cannot dig ${block.name} from its current state.`)
    }

    await this.actions.moveIntoBlockReach(block, signal)
    throwIfAborted(signal)
    const previous = this.bot.heldItem
    const tool = findBestHarvestTool(this.bot, block)
    if (tool && this.bot.heldItem !== tool) {
      await raceWithAbort(this.bot.equip(tool, 'hand'), signal)
    }

    await raceWithAbort(
      this.bot.dig(block, options.forceLook !== false, 'raycast'),
      signal,
      () => {
        try { this.bot.stopDigging() } catch (_) {}
      }
    )
    await this.restoreHeldItem(previous)
    return `Mined ${block.name} at ${formatPosition(block.position)}.`
  }

  async eatInventoryFood (item, options = {}, signal) {
    this.actions.ensureReady()
    throwIfAborted(signal)
    if (!item?.name) throw new Error('A food item is required.')
    if (foodPointsFor(this.bot, item) <= 0) throw new Error(`${item.name} is not recognized as food.`)

    await raceWithAbort(this.bot.equip(item, 'hand'), signal)
    await raceWithAbort(
      this.bot.consume(),
      signal,
      () => {
        try { this.bot.deactivateItem() } catch (_) {}
      }
    )
    return `Ate ${item.displayName || item.name}.`
  }

  async eatCake (blockOrPosition, options = {}, signal) {
    this.actions.ensureReady()
    const position = blockOrPosition?.position ? blockOrPosition.position.clone() : toVec3(blockOrPosition).floored()
    const targetFood = Math.max(1, Math.min(20, Math.floor(Number(options.targetFood) || 18)))
    const maximumBites = Math.max(1, Math.min(7, Math.floor(Number(options.maximumBites) || 7)))
    let bites = 0

    while (bites < maximumBites && (!Number.isFinite(this.bot.food) || this.bot.food < targetFood)) {
      throwIfAborted(signal)
      const cake = this.bot.blockAt(position)
      if (!cake || cake.name !== 'cake') break
      await this.actions.moveIntoBlockReach(cake, signal)
      await raceWithAbort(this.bot.activateBlock(cake), signal)
      bites += 1
      await abortableSleep(clampDuration(options.biteDelayMs ?? 250, 50, 1500), signal)
    }

    if (bites === 0) throw new Error('No edible cake remains at that position.')
    return `Ate ${bites} cake slice${bites === 1 ? '' : 's'}.`
  }

  async restoreHeldItem (previous) {
    if (!previous || this.bot.heldItem === previous) return
    const stillPresent = this.bot.inventory.items().some(item => item === previous || item.slot === previous.slot)
    if (!stillPresent) return
    try { await this.bot.equip(previous, 'hand') } catch (error) {
      this.logger.debug?.('Could not restore the previously held item:', error.message)
    }
  }
}

function predictProjectileThreat (botPosition, projectile, options = {}) {
  if (!botPosition || !projectile?.position || !projectile?.velocity) return null
  const allowedNames = new Set((options.projectileNames || DEFAULT_PROJECTILE_NAMES).map(normalizeItemQuery))
  const name = entityName(projectile)
  if (!allowedNames.has(name)) return null

  const velocity = toVec3(projectile.velocity)
  const speedSquared = velocity.x * velocity.x + velocity.y * velocity.y + velocity.z * velocity.z
  const minimumSpeed = Math.max(0.001, Number(options.minimumSpeed) || 0.03)
  if (speedSquared < minimumSpeed * minimumSpeed) return null

  const relative = toVec3(botPosition).minus(toVec3(projectile.position))
  const timeTicks = dot(relative, velocity) / speedSquared
  const lookAheadTicks = Math.max(1, Number(options.lookAheadTicks) || 24)
  if (timeTicks < 0 || timeTicks > lookAheadTicks) return null

  const closestPoint = toVec3(projectile.position).plus(velocity.scaled(timeTicks))
  const closestDelta = toVec3(botPosition).minus(closestPoint)
  const horizontalDistance = Math.hypot(closestDelta.x, closestDelta.z)
  const verticalDistance = Math.abs(closestDelta.y)
  const threatRadius = Math.max(0.25, Number(options.threatRadius) || 1.4)
  const verticalTolerance = Math.max(0.5, Number(options.verticalTolerance) || 2)
  if (horizontalDistance > threatRadius || verticalDistance > verticalTolerance) return null

  return {
    projectile,
    name,
    timeTicks,
    closestPoint,
    closestDistance: Math.sqrt(horizontalDistance * horizontalDistance + verticalDistance * verticalDistance),
    horizontalDistance,
    verticalDistance
  }
}

function chooseProjectileDodgeDirection (bot, projectile, options = {}) {
  if (!bot?.entity?.position || !projectile?.position || !projectile?.velocity) return null
  const velocity = toVec3(projectile.velocity)
  const horizontal = new Vec3(velocity.x, 0, velocity.z)
  const sideDirections = []
  if (horizontal.norm() >= 0.01) {
    const travel = horizontal.normalize()
    sideDirections.push(new Vec3(-travel.z, 0, travel.x), new Vec3(travel.z, 0, -travel.x))
  }

  const away = bot.entity.position.minus(toVec3(projectile.position))
  away.y = 0
  if (away.norm() >= 0.01) sideDirections.push(away.normalize())

  const fallback = [
    new Vec3(1, 0, 0),
    new Vec3(-1, 0, 0),
    new Vec3(0, 0, 1),
    new Vec3(0, 0, -1),
    new Vec3(1, 0, 1).normalize(),
    new Vec3(-1, 0, 1).normalize(),
    new Vec3(1, 0, -1).normalize(),
    new Vec3(-1, 0, -1).normalize()
  ]

  const candidates = uniqueDirections([...sideDirections, ...fallback])
  const dodgeDistance = Math.max(1, Number(options.dodgeDistance) || 2.25)
  return candidates.find(direction => isSafeDodgeDirection(bot, direction, dodgeDistance, options)) || null
}

function isSafeDodgeDirection (bot, directionLike, distance = 2.25, options = {}) {
  if (!bot?.entity?.position || typeof bot.blockAt !== 'function') return false
  const direction = toVec3(directionLike)
  direction.y = 0
  if (direction.norm() < 0.01) return false
  const normalized = direction.normalize()
  const steps = Math.max(1, Math.ceil(Number(distance) || 2.25))
  const base = bot.entity.position.floored()

  for (let step = 1; step <= steps; step += 1) {
    const offset = normalized.scaled(Math.min(step, distance))
    const feetPosition = base.plus(offset).floored()
    const feet = bot.blockAt(feetPosition)
    const head = bot.blockAt(feetPosition.offset(0, 1, 0))
    const floor = bot.blockAt(feetPosition.offset(0, -1, 0))
    if (!isPassable(feet) || !isPassable(head) || !isSafeFloor(floor, options)) return false
  }

  return true
}

function isShearedSheep (entity) {
  if (!entity) return false
  if (typeof entity.sheared === 'boolean') return entity.sheared
  if (typeof entity.isSheared === 'boolean') return entity.isSheared
  const metadata = entity.metadata || []
  for (const index of [16, 17, 18]) {
    const value = metadata[index]
    if (typeof value === 'number' && (value & 0x10) !== 0) return true
  }
  return false
}

function findNearestAnimal (bot, kind, radius, predicate = () => true) {
  if (!bot?.entity?.position) return null
  const maximumDistanceSquared = Math.max(1, Number(radius) || 8) ** 2
  return Object.values(bot.entities || {})
    .filter(entity => entity && entity !== bot.entity && entity.isValid !== false)
    .filter(entity => entityName(entity) === normalizeItemQuery(kind))
    .filter(entity => bot.entity.position.distanceSquared(entity.position) <= maximumDistanceSquared)
    .filter(predicate)
    .sort((a, b) => bot.entity.position.distanceSquared(a.position) - bot.entity.position.distanceSquared(b.position))[0] || null
}

function findVisibleOre (bot, rules = {}, recentlyVisited = () => false) {
  if (!bot?.entity?.position || typeof bot.findBlocks !== 'function') return null
  const blockNames = rules.blockNames || DEFAULT_ORE_NAMES
  const ids = blockNames
    .map(name => bot.registry?.blocksByName?.[normalizeItemQuery(name)]?.id)
    .filter(Number.isInteger)
  if (ids.length === 0) return null

  const positions = bot.findBlocks({
    matching: ids,
    maxDistance: Math.max(1, Number(rules.searchRadius) || 16),
    count: Math.max(1, Math.floor(Number(rules.maximumCandidates) || 64))
  }) || []

  return positions
    .filter(position => !recentlyVisited(position))
    .map(position => ({ position, block: bot.blockAt(position) }))
    .filter(candidate => candidate.block && blockNames.map(normalizeItemQuery).includes(normalizeItemQuery(candidate.block.name)))
    .filter(candidate => typeof bot.canSeeBlock !== 'function' || bot.canSeeBlock(candidate.block))
    .sort((a, b) => bot.entity.position.distanceSquared(a.position) - bot.entity.position.distanceSquared(b.position))[0]?.block || null
}

function findVisibleCake (bot, rules = {}) {
  if (!bot?.entity?.position || typeof bot.findBlocks !== 'function') return null
  const cakeId = bot.registry?.blocksByName?.cake?.id
  if (!Number.isInteger(cakeId)) return null
  const positions = bot.findBlocks({
    matching: cakeId,
    maxDistance: Math.max(1, Number(rules.cakeSearchRadius) || 12),
    count: 16
  }) || []
  return positions
    .map(position => bot.blockAt(position))
    .filter(block => block?.name === 'cake')
    .filter(block => typeof bot.canSeeBlock !== 'function' || bot.canSeeBlock(block))
    .sort((a, b) => bot.entity.position.distanceSquared(a.position) - bot.entity.position.distanceSquared(b.position))[0] || null
}

function selectFoodItem (bot, rules = {}) {
  const configured = {
    include: Array.isArray(rules.include) ? rules.include : ['*'],
    exclude: Array.isArray(rules.exclude)
      ? rules.exclude
      : ['rotten_flesh', 'poisonous_potato', 'spider_eye', 'pufferfish', 'chorus_fruit', 'golden_apple', 'enchanted_golden_apple']
  }
  const candidates = (bot.inventory?.items?.() || [])
    .filter(item => matchesItemRules(item, configured))
    .map(item => ({ item, foodPoints: foodPointsFor(bot, item) }))
    .filter(candidate => candidate.foodPoints > 0)

  if (rules.preferBestFood === false) return candidates[0]?.item || null
  candidates.sort((a, b) => b.foodPoints - a.foodPoints || b.item.count - a.item.count)
  return candidates[0]?.item || null
}

function foodPointsFor (bot, item) {
  if (!item?.name) return 0
  const direct = Number(item.foodPoints ?? item.food?.foodPoints)
  if (Number.isFinite(direct) && direct > 0) return direct
  const registryFood = bot?.registry?.foodsByName?.[item.name]
  const registryPoints = Number(registryFood?.foodPoints ?? registryFood?.points)
  if (Number.isFinite(registryPoints) && registryPoints > 0) return registryPoints
  const registryItem = bot?.registry?.itemsByName?.[item.name]
  const itemPoints = Number(registryItem?.foodPoints)
  if (Number.isFinite(itemPoints) && itemPoints > 0) return itemPoints
  return KNOWN_FOOD_POINTS[normalizeItemQuery(item.name)] || 0
}

function findBestHarvestTool (bot, block) {
  const items = bot.inventory?.items?.() || []
  const harvestTools = block?.harvestTools || {}
  const explicit = items.filter(item => harvestTools[item.type] || harvestTools[String(item.type)])
  const candidates = explicit.length > 0 ? explicit : items.filter(item => item.name?.endsWith('_pickaxe'))
  return [...candidates].sort((a, b) => harvestToolScore(b) - harvestToolScore(a))[0] || null
}

function harvestToolScore (item) {
  const name = normalizeItemQuery(item?.name)
  const materialScores = { netherite: 70, diamond: 60, iron: 50, stone: 40, golden: 30, gold: 30, wooden: 20, wood: 20 }
  const material = Object.keys(materialScores).find(prefix => name.startsWith(`${prefix}_`))
  let score = material ? materialScores[material] : 0
  if (name.endsWith('_pickaxe')) score += 20
  score += (item?.enchants?.length || 0) * 0.25
  return score
}

function entityName (entity) {
  return normalizeItemQuery(entity?.name || entity?.objectType || entity?.mobType || entity?.displayName || '')
}

function describeEntity (entity) {
  return entity?.username || entity?.displayName || entity?.name || `entity ${entity?.id ?? 'unknown'}`
}

function validateEntity (entity, expectedName) {
  if (!entity?.position || entity.isValid === false) throw new Error(`A valid ${expectedName} entity is required.`)
  if (entityName(entity) !== expectedName) throw new Error(`The target entity is not a ${expectedName}.`)
}

function uniqueDirections (directions) {
  const seen = new Set()
  const output = []
  for (const direction of directions) {
    if (!direction || direction.norm() < 0.01) continue
    const normalized = direction.normalize()
    const key = `${Math.round(normalized.x * 100)},${Math.round(normalized.z * 100)}`
    if (seen.has(key)) continue
    seen.add(key)
    output.push(normalized)
  }
  return output
}

function isPassable (block) {
  return !block || block.boundingBox === 'empty' || ['air', 'cave_air', 'void_air', 'water', 'flowing_water'].includes(block.name)
}

function isSafeFloor (block, options = {}) {
  if (!block || block.boundingBox !== 'block') return false
  const unsafe = new Set((options.unsafeFloorNames || ['lava', 'flowing_lava', 'fire', 'soul_fire', 'magma_block', 'cactus']).map(normalizeItemQuery))
  return !unsafe.has(normalizeItemQuery(block.name))
}

function dot (a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z
}

function toVec3 (value) {
  if (value instanceof Vec3) return value.clone()
  if (Array.isArray(value) && value.length >= 3) return new Vec3(Number(value[0]), Number(value[1]), Number(value[2]))
  if (value && typeof value === 'object') return new Vec3(Number(value.x), Number(value.y), Number(value.z))
  throw new TypeError('Expected a position with x, y, and z coordinates.')
}

function formatPosition (position) {
  return `${Number(position.x).toFixed(1)}, ${Number(position.y).toFixed(1)}, ${Number(position.z).toFixed(1)}`
}

function clampDuration (value, minimum, maximum) {
  const duration = Number(value)
  if (!Number.isFinite(duration)) throw new TypeError('Duration must be a finite number of milliseconds.')
  return Math.min(maximum, Math.max(minimum, Math.floor(duration)))
}

module.exports = {
  AutonomyBehaviors,
  DEFAULT_PROJECTILE_NAMES,
  DEFAULT_ORE_NAMES,
  KNOWN_FOOD_POINTS,
  predictProjectileThreat,
  chooseProjectileDodgeDirection,
  isSafeDodgeDirection,
  isShearedSheep,
  findNearestAnimal,
  findVisibleOre,
  findVisibleCake,
  selectFoodItem,
  foodPointsFor,
  findBestHarvestTool,
  entityName
}
