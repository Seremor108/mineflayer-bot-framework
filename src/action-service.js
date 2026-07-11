'use strict'

const { Vec3 } = require('vec3')
const {
  pathfinder,
  Movements,
  goals: { GoalBlock, GoalNear, GoalLookAtBlock }
} = require('mineflayer-pathfinder')
const { abortableSleep, throwIfAborted, TaskCancelledError } = require('./task-queue')

const EQUIPMENT_DESTINATIONS = new Set(['hand', 'head', 'torso', 'legs', 'feet', 'off-hand'])
const DESTINATION_ALIASES = Object.freeze({
  mainhand: 'hand',
  main_hand: 'hand',
  hand: 'hand',
  offhand: 'off-hand',
  off_hand: 'off-hand',
  'off-hand': 'off-hand',
  helmet: 'head',
  head: 'head',
  chest: 'torso',
  chestplate: 'torso',
  torso: 'torso',
  leggings: 'legs',
  legs: 'legs',
  boots: 'feet',
  feet: 'feet'
})

const ARMOR_MATERIAL_RANK = Object.freeze({
  netherite: 70,
  diamond: 60,
  iron: 50,
  turtle: 45,
  chainmail: 40,
  golden: 30,
  gold: 30,
  leather: 20
})

class ActionService {
  constructor (bot, config = {}, logger = console) {
    if (!bot) throw new Error('ActionService requires a bot instance.')

    this.bot = bot
    this.config = {
      canDigWhilePathing: false,
      allowSprinting: true,
      allowParkour: false,
      allow1by1Towers: false,
      interactionReach: 4.5,
      entityReach: 3,
      blockPunchMs: 120,
      ...config
    }
    this.logger = logger
    this.movements = null
    this.entityAttackPolicy = () => false
    this.disposed = false

    bot.loadPlugin(pathfinder)
  }

  configureMovements () {
    if (!this.bot.entity || !this.bot.registry) return null

    const movements = new Movements(this.bot)
    movements.canDig = Boolean(this.config.canDigWhilePathing)
    movements.allowSprinting = this.config.allowSprinting !== false
    movements.allowParkour = Boolean(this.config.allowParkour)
    movements.allow1by1towers = Boolean(this.config.allow1by1Towers)

    if (Number.isFinite(this.config.maxDropDown)) {
      movements.maxDropDown = Math.max(0, Math.floor(this.config.maxDropDown))
    }

    this.bot.pathfinder.setMovements(movements)
    this.movements = movements
    return movements
  }

  ensureReady () {
    if (this.disposed) throw new Error('The action service has been disposed.')
    if (!this.bot.entity) throw new Error('The bot has not spawned yet.')
    if (!this.movements) this.configureMovements()
  }

  async gotoPosition ({ x, y, z, range = 1 }, signal) {
    this.ensureReady()
    const position = toFinitePosition(x, y, z)
    const safeRange = Math.max(0, Math.floor(Number(range) || 0))
    const goal = safeRange === 0
      ? new GoalBlock(Math.floor(position.x), Math.floor(position.y), Math.floor(position.z))
      : new GoalNear(position.x, position.y, position.z, safeRange)

    await this.gotoGoal(goal, signal)
    return `Reached ${formatPosition(position)}.`
  }

  async gotoEntity (entityOrSelector, { range = 2 } = {}, signal) {
    const entity = this.resolveEntity(entityOrSelector)
    const position = entity.position.clone()
    await this.gotoPosition({ x: position.x, y: position.y, z: position.z, range }, signal)
    return `Reached ${describeEntity(entity)}.`
  }

  async gotoGoal (goal, signal) {
    this.ensureReady()
    throwIfAborted(signal)

    const operation = this.bot.pathfinder.goto(goal)
    await raceWithAbort(operation, signal, () => {
      this.bot.pathfinder.setGoal(null)
      this.stopManualControls({ preserveSneak: true })
    })
  }

  stopPathfinding () {
    if (this.bot.pathfinder) this.bot.pathfinder.setGoal(null)
    if (this.bot.targetDigBlock) this.bot.stopDigging()
    this.stopManualControls({ preserveSneak: true })
  }

  async leftClickBlock (blockOrPosition, { punchMs = this.config.blockPunchMs } = {}, signal) {
    this.ensureReady()
    const block = this.resolveBlock(blockOrPosition)
    await this.moveIntoBlockReach(block, signal)
    throwIfAborted(signal)

    const target = block.position.offset(0.5, 0.5, 0.5)
    await raceWithAbort(this.bot.lookAt(target, true), signal)
    throwIfAborted(signal)

    const face = getVisibleBlockFace(this.bot, block)
    let started = false

    try {
      this.bot._client.write('block_dig', {
        status: 0,
        location: block.position,
        face
      })
      started = true
      this.bot.swingArm('right')
      await abortableSleep(clampDuration(punchMs, 50, 1000), signal)
    } finally {
      if (started && typeof this.bot._client?.write === 'function') {
        try {
          this.bot._client.write('block_dig', {
            status: 1,
            location: block.position,
            face
          })
        } catch (_) {}
      }
    }

    return `Left-clicked ${block.name} at ${formatPosition(block.position)}.`
  }

  async rightClickBlock (blockOrPosition, options = {}, signal) {
    this.ensureReady()
    const block = this.resolveBlock(blockOrPosition)
    await this.moveIntoBlockReach(block, signal)
    throwIfAborted(signal)

    const direction = options.direction ? toVec3(options.direction) : new Vec3(0, 1, 0)
    const cursorPos = options.cursorPos ? toVec3(options.cursorPos) : undefined
    await raceWithAbort(this.bot.activateBlock(block, direction, cursorPos), signal)
    return `Right-clicked ${block.name} at ${formatPosition(block.position)}.`
  }

  setEntityAttackPolicy (policy) {
    this.entityAttackPolicy = typeof policy === 'function' ? policy : () => false
  }

  canAttackEntity (entityOrSelector) {
    const entity = this.resolveEntity(entityOrSelector)
    return Boolean(this.entityAttackPolicy(entity))
  }

  async leftClickEntity (entityOrSelector, signal) {
    this.ensureReady()
    const entity = this.resolveEntity(entityOrSelector)
    if (!this.entityAttackPolicy(entity)) {
      throw new Error('PvP mode is disabled, or the target is protected by the teammate/hostility rules.')
    }
    await this.moveIntoEntityReach(entity, signal)
    throwIfAborted(signal)
    await raceWithAbort(this.lookAtEntity(entity), signal)
    throwIfAborted(signal)
    this.bot.attack(entity, true)
    return `Left-clicked ${describeEntity(entity)}.`
  }

  async rightClickEntity (entityOrSelector, { useHeldItem = false } = {}, signal) {
    this.ensureReady()
    const entity = this.resolveEntity(entityOrSelector)
    await this.moveIntoEntityReach(entity, signal)
    throwIfAborted(signal)
    await raceWithAbort(this.lookAtEntity(entity), signal)
    throwIfAborted(signal)

    if (useHeldItem) {
      this.bot.useOn(entity)
    } else {
      await raceWithAbort(this.bot.activateEntity(entity), signal)
    }

    return `Right-clicked ${describeEntity(entity)}.`
  }

  async jump (durationMs = 450, signal) {
    this.ensureReady()
    throwIfAborted(signal)
    this.bot.setControlState('jump', true)

    try {
      await abortableSleep(clampDuration(durationMs, 50, 10000), signal)
    } finally {
      this.bot.setControlState('jump', false)
    }

    return 'Jumped.'
  }

  async sneak (durationMs = 1000, signal) {
    this.ensureReady()
    throwIfAborted(signal)
    this.bot.setControlState('sneak', true)

    try {
      await abortableSleep(clampDuration(durationMs, 50, 60000), signal)
    } finally {
      this.bot.setControlState('sneak', false)
    }

    return 'Finished sneaking.'
  }

  async setSneaking (enabled, signal) {
    this.ensureReady()
    throwIfAborted(signal)
    this.bot.setControlState('sneak', Boolean(enabled))
    return enabled ? 'Sneaking enabled.' : 'Sneaking disabled.'
  }

  async equipItem (itemQuery, destination = 'hand', signal) {
    this.ensureReady()
    throwIfAborted(signal)
    const item = this.findInventoryItem(itemQuery)
    const normalizedDestination = normalizeDestination(destination)
    await raceWithAbort(this.bot.equip(item, normalizedDestination), signal)
    return `Equipped ${item.displayName || item.name} to ${normalizedDestination}.`
  }

  async equipArmor (itemQuery = 'best', signal) {
    this.ensureReady()
    throwIfAborted(signal)

    if (normalizeItemQuery(itemQuery) !== 'best') {
      const item = this.findInventoryItem(itemQuery)
      const destination = getArmorDestination(item.name)
      if (!destination) throw new Error(`${item.displayName || item.name} is not recognized as armor.`)
      await raceWithAbort(this.bot.equip(item, destination), signal)
      return `Equipped ${item.displayName || item.name} to ${destination}.`
    }

    const equipped = []
    for (const destination of ['head', 'torso', 'legs', 'feet']) {
      throwIfAborted(signal)
      const candidate = this.findBestArmor(destination)
      if (!candidate) continue
      await raceWithAbort(this.bot.equip(candidate, destination), signal)
      equipped.push(candidate.displayName || candidate.name)
    }

    if (equipped.length === 0) return 'No armor upgrades were found in the inventory.'
    return `Equipped: ${equipped.join(', ')}.`
  }

  async extinguishFire ({ searchRadius = 12, timeoutMs = 8000 } = {}, signal) {
    this.ensureReady()
    throwIfAborted(signal)

    if (!isBotOnFire(this.bot)) return 'The bot is no longer on fire.'

    if (this.bot.entity.isInWater) {
      await waitUntil(() => !isBotOnFire(this.bot), Math.min(timeoutMs, 3000), signal)
      return 'Waited in water until the fire went out.'
    }

    const water = this.bot.findBlock({
      matching: block => block && isWaterBlock(block),
      maxDistance: Math.max(1, Number(searchRadius) || 12)
    })

    if (water) {
      await this.gotoPosition({
        x: water.position.x,
        y: water.position.y,
        z: water.position.z,
        range: 0
      }, signal)
      await waitUntil(
        () => !isBotOnFire(this.bot) || this.bot.entity.isInWater,
        Math.min(timeoutMs, 4000),
        signal
      )
      return `Moved into water at ${formatPosition(water.position)}.`
    }

    const waterBucket = this.findInventoryItemOptional('water_bucket')
    if (waterBucket) {
      await raceWithAbort(this.bot.equip(waterBucket, 'hand'), signal)
      const placement = findWaterPlacementSupport(this.bot)
      if (!placement) throw new Error('A water bucket is available, but there is no nearby solid surface to place it on.')

      await raceWithAbort(
        this.bot.activateBlock(placement.block, placement.face),
        signal
      )

      this.bot.setControlState('jump', true)
      try {
        await abortableSleep(250, signal)
      } finally {
        this.bot.setControlState('jump', false)
      }

      await waitUntil(
        () => !isBotOnFire(this.bot) || this.bot.entity.isInWater,
        Math.min(timeoutMs, 4000),
        signal
      )
      return 'Placed water to extinguish the fire.'
    }

    throw new Error('No reachable water or water bucket was available to extinguish the fire.')
  }


  getEquippedItem (destination) {
    const normalizedDestination = normalizeDestination(destination)
    if (typeof this.bot.getEquipmentDestSlot !== 'function') return null
    try {
      const slot = this.bot.getEquipmentDestSlot(normalizedDestination)
      return slot == null ? null : this.bot.inventory.slots[slot]
    } catch (_) {
      return null
    }
  }

  findBestWeapon ({ includeBow = false } = {}) {
    const candidates = this.bot.inventory.items()
      .filter(item => isWeaponItem(item, { includeBow }))
      .sort((a, b) => weaponScore(b) - weaponScore(a))
    return candidates[0] || null
  }

  hasWeapon ({ includeBow = false } = {}) {
    const held = this.bot.heldItem
    return Boolean(isWeaponItem(held, { includeBow }) || this.findBestWeapon({ includeBow }))
  }

  async equipBestWeapon ({ includeBow = false } = {}, signal) {
    this.ensureReady()
    throwIfAborted(signal)
    const held = this.bot.heldItem
    if (isWeaponItem(held, { includeBow })) return held
    const weapon = this.findBestWeapon({ includeBow })
    if (!weapon) return null
    await raceWithAbort(this.bot.equip(weapon, 'hand'), signal)
    return weapon
  }

  async smoothAimAtEntity (entityOrSelector, options = {}, signal) {
    this.ensureReady()
    const entity = this.resolveEntity(entityOrSelector)
    const durationMs = clampDuration(options.durationMs ?? 250, 0, 10000)
    const stepMs = clampDuration(options.stepMs ?? 50, 10, 500)
    const maxRadiansPerStep = Math.max(0.005, Number(options.maxRadiansPerStep) || 0.18)
    const targetHeightRatio = Number.isFinite(options.targetHeightRatio) ? options.targetHeightRatio : 0.65
    const deadline = Date.now() + durationMs

    do {
      throwIfAborted(signal)
      if (entity.isValid === false) throw new Error('The target entity is no longer valid.')
      const point = entity.position.offset(0, (Number(entity.height) || 1.8) * targetHeightRatio, 0)
      const desired = anglesToPoint(this.bot.entity.position.offset(0, this.bot.entity.eyeHeight || 1.62, 0), point)
      const yaw = approachAngle(this.bot.entity.yaw, desired.yaw, maxRadiansPerStep)
      const pitch = approachAngle(this.bot.entity.pitch, desired.pitch, maxRadiansPerStep)
      await raceWithAbort(this.bot.look(yaw, pitch, true), signal)
      if (Date.now() >= deadline) break
      await abortableSleep(Math.min(stepMs, Math.max(0, deadline - Date.now())), signal)
    } while (Date.now() < deadline)

    return entity
  }

  async fireBowAt (entityOrSelector, options = {}, signal) {
    this.ensureReady()
    const entity = this.resolveEntity(entityOrSelector)
    const bow = this.bot.heldItem?.name === 'bow'
      ? this.bot.heldItem
      : this.findInventoryItemOptional('bow')
    if (!bow) throw new Error('No bow is available.')
    if (this.bot.heldItem !== bow) await raceWithAbort(this.bot.equip(bow, 'hand'), signal)

    const chargeMs = clampDuration(options.chargeMs ?? 1000, 100, 3000)
    this.bot.activateItem(false)
    try {
      await this.smoothAimAtEntity(entity, {
        durationMs: chargeMs,
        stepMs: options.stepMs ?? 50,
        maxRadiansPerStep: options.maxRadiansPerStep ?? 0.12,
        targetHeightRatio: options.targetHeightRatio ?? 0.65
      }, signal)
    } finally {
      this.bot.deactivateItem()
    }
    return `Fired a bow at ${describeEntity(entity)}.`
  }

  async blockWithShield (durationMs = 350, signal) {
    this.ensureReady()
    throwIfAborted(signal)
    const shield = this.getEquippedItem('off-hand')?.name === 'shield'
      ? this.getEquippedItem('off-hand')
      : this.findInventoryItemOptional('shield')
    if (!shield) return 'No shield is available.'

    const previous = this.getEquippedItem('off-hand')
    if (previous !== shield) await raceWithAbort(this.bot.equip(shield, 'off-hand'), signal)
    this.bot.activateItem(true)
    try {
      await abortableSleep(clampDuration(durationMs, 50, 5000), signal)
    } finally {
      this.bot.deactivateItem()
      if (previous && previous.name !== 'shield') {
        try { await this.bot.equip(previous, 'off-hand') } catch (_) {}
      } else if (!previous && typeof this.bot.unequip === 'function') {
        try { await this.bot.unequip('off-hand') } catch (_) {}
      }
    }
    return 'Blocked with a shield.'
  }

  async spamSocialAction (action, options = {}, signal) {
    const repetitions = Math.max(1, Math.min(12, Math.floor(Number(options.repetitions) || 3)))
    const pulseMs = clampDuration(options.pulseMs ?? 180, 50, 1500)
    const gapMs = clampDuration(options.gapMs ?? 100, 0, 1000)
    const normalized = String(action || '').toLowerCase()

    for (let index = 0; index < repetitions; index += 1) {
      throwIfAborted(signal)
      if (normalized === 'sneak') {
        this.bot.setControlState('sneak', true)
        try { await abortableSleep(pulseMs, signal) } finally { this.bot.setControlState('sneak', false) }
      } else if (normalized === 'jump') {
        this.bot.setControlState('jump', true)
        try { await abortableSleep(Math.min(pulseMs, 350), signal) } finally { this.bot.setControlState('jump', false) }
      } else if (normalized === 'shield') {
        await this.blockWithShield(pulseMs, signal)
      } else {
        throw new Error(`Unknown social action "${action}".`)
      }
      if (index + 1 < repetitions && gapMs > 0) await abortableSleep(gapMs, signal)
    }

    return `Mirrored ${normalized} ${repetitions} time(s).`
  }

  async moveAwayFromPosition (positionLike, options = {}, signal) {
    this.ensureReady()
    const origin = toVec3(positionLike)
    let direction = this.bot.entity.position.minus(origin)
    direction.y = 0
    if (direction.norm() < 0.05) direction = chooseOpenDirection(this.bot)
    direction = direction.normalize()
    const target = this.bot.entity.position.plus(direction.scaled(Number(options.lookDistance) || 6))
    await raceWithAbort(this.bot.lookAt(target.offset(0, this.bot.entity.eyeHeight || 1.62, 0), true), signal)

    const durationMs = clampDuration(options.durationMs ?? 1200, 100, 10000)
    this.bot.setControlState('forward', true)
    this.bot.setControlState('sprint', options.sprint !== false)
    this.bot.setControlState('jump', options.jump !== false)
    try {
      await abortableSleep(durationMs, signal)
    } finally {
      this.bot.setControlState('forward', false)
      this.bot.setControlState('sprint', false)
      this.bot.setControlState('jump', false)
    }
    return 'Moved away from the hazard.'
  }

  async retreatFromEntity (entityOrSelector, options = {}, signal) {
    const entity = this.resolveEntity(entityOrSelector)
    await this.moveAwayFromPosition(entity.position, options, signal)
    return `Retreated from ${describeEntity(entity)}.`
  }

  async dodgeFallingBlock (entity, options = {}, signal) {
    if (!entity?.position) throw new Error('A falling-block entity is required.')
    await this.moveAwayFromPosition(entity.position, {
      durationMs: options.durationMs ?? 1000,
      sprint: true,
      jump: true
    }, signal)
    return 'Dodged a falling block.'
  }

  async escapeLavaOrFire (hazardPosition, options = {}, signal) {
    this.ensureReady()
    throwIfAborted(signal)
    if (this.bot.entity.isInLava || isLavaBlock(this.bot.blockAt(this.bot.entity.position.floored()))) {
      await this.moveAwayFromPosition(hazardPosition || this.bot.entity.position.offset(0, -1, 0), {
        durationMs: options.escapeDurationMs ?? 1800,
        sprint: true,
        jump: true
      }, signal)
    } else if (hazardPosition) {
      await this.moveAwayFromPosition(hazardPosition, {
        durationMs: options.escapeDurationMs ?? 900,
        sprint: true,
        jump: true
      }, signal)
    }

    if (isBotOnFire(this.bot)) {
      return this.extinguishFire({
        searchRadius: options.waterSearchRadius ?? 12,
        timeoutMs: options.extinguishTimeoutMs ?? 8000
      }, signal)
    }
    return 'Escaped the lava or fire hazard.'
  }

  async lootChest (blockOrPosition, rules = {}, signal) {
    this.ensureReady()
    const block = this.resolveBlock(blockOrPosition)
    if (!isChestBlock(block)) throw new Error(`${block.name} is not a supported chest block.`)
    await this.moveIntoBlockReach(block, signal)
    throwIfAborted(signal)

    const openContainer = typeof this.bot.openContainer === 'function'
      ? this.bot.openContainer(block)
      : this.bot.openChest(block)
    const chest = await raceWithAbort(openContainer, signal)
    const looted = []
    try {
      const items = [...chest.containerItems()]
      for (const item of items) {
        throwIfAborted(signal)
        if (!matchesItemRules(item, rules)) continue
        if (this.bot.inventory.emptySlotCount() === 0 && !canStackInInventory(this.bot, item)) break
        const count = rules.maxPerStack == null
          ? item.count
          : Math.min(item.count, Math.max(1, Math.floor(Number(rules.maxPerStack) || 1)))
        await raceWithAbort(chest.withdraw(item.type, item.metadata ?? null, count, item.nbt), signal)
        looted.push(`${count} ${item.name}`)
      }
    } finally {
      try { chest.close() } catch (_) {}
    }
    return looted.length > 0 ? `Looted ${looted.join(', ')}.` : 'No configured loot was found.'
  }

  async tossConfiguredItems (rules = {}, signal) {
    this.ensureReady()
    const minimumFreeSlots = Math.max(1, Math.floor(Number(rules.minimumFreeSlots) || 1))
    const tossed = []
    for (const item of [...this.bot.inventory.items()]) {
      throwIfAborted(signal)
      if (this.bot.inventory.emptySlotCount() >= minimumFreeSlots) break
      if (!matchesItemRules(item, rules)) continue
      await raceWithAbort(this.bot.tossStack(item), signal)
      tossed.push(`${item.count} ${item.name}`)
    }
    return tossed.length > 0 ? `Tossed ${tossed.join(', ')}.` : 'No configured disposable items were found.'
  }

  resolveBlock (blockOrPosition) {
    if (blockOrPosition?.position && typeof blockOrPosition.name === 'string') {
      return blockOrPosition
    }

    const position = toVec3(blockOrPosition).floored()
    const block = this.bot.blockAt(position)
    if (!block) throw new Error(`Block at ${formatPosition(position)} is not loaded.`)
    if (block.name === 'air' || block.type === 0) throw new Error(`There is no clickable block at ${formatPosition(position)}.`)
    return block
  }

  resolveEntity (entityOrSelector) {
    if (entityOrSelector && typeof entityOrSelector === 'object' && entityOrSelector.position) {
      if (entityOrSelector.isValid === false) throw new Error('The target entity is no longer valid.')
      return entityOrSelector
    }

    const selector = String(entityOrSelector || '').trim()
    if (!selector) throw new Error('An entity selector is required.')
    const normalized = selector.toLowerCase()

    const idMatch = normalized.match(/^id:(\d+)$/) || normalized.match(/^(\d+)$/)
    if (idMatch) {
      const entity = this.bot.entities[Number(idMatch[1])]
      if (!entity || entity.isValid === false) throw new Error(`Entity ${idMatch[1]} is not visible.`)
      return entity
    }

    const requestedPlayer = normalized.startsWith('player:')
      ? normalized.slice('player:'.length)
      : normalized

    const player = Object.values(this.bot.players || {}).find(candidate =>
      candidate?.username?.toLowerCase() === requestedPlayer
    )
    if (player?.entity?.isValid !== false && player?.entity) return player.entity

    const entities = Object.values(this.bot.entities || {}).filter(entity =>
      entity && entity !== this.bot.entity && entity.isValid !== false
    )

    const exact = entities.filter(entity => entityNames(entity).includes(normalized))
    if (exact.length > 0) return nearestToBot(this.bot, exact)

    const partial = entities.filter(entity => entityNames(entity).some(name => name.includes(normalized)))
    if (partial.length > 0) return nearestToBot(this.bot, partial)

    throw new Error(`No visible entity matches "${selector}".`)
  }

  findInventoryItem (query) {
    const matches = this.findInventoryItems(query)
    if (matches.length === 0) throw new Error(`No inventory item matches "${query}".`)
    if (matches.length > 1 && !matches.some(item => item.name === normalizeItemQuery(query))) {
      const names = [...new Set(matches.map(item => item.name))].slice(0, 5)
      throw new Error(`Item "${query}" is ambiguous. Matches: ${names.join(', ')}.`)
    }
    return matches.find(item => item.name === normalizeItemQuery(query)) || matches[0]
  }

  findInventoryItemOptional (query) {
    return this.findInventoryItems(query)[0] || null
  }

  findInventoryItems (query) {
    const normalized = normalizeItemQuery(query)
    if (!normalized) return []
    const items = this.bot.inventory.items()
    const exact = items.filter(item =>
      item.name === normalized || normalizeItemQuery(item.displayName) === normalized
    )
    if (exact.length > 0) return exact
    return items.filter(item =>
      item.name.includes(normalized) || normalizeItemQuery(item.displayName).includes(normalized)
    )
  }

  findBestArmor (destination) {
    const candidates = this.bot.inventory.items()
      .filter(item => getArmorDestination(item.name) === destination)
      .sort((a, b) => armorScore(b) - armorScore(a))

    const best = candidates[0]
    if (!best) return null

    const currentSlot = typeof this.bot.getEquipmentDestSlot === 'function'
      ? this.bot.getEquipmentDestSlot(destination)
      : null
    const current = currentSlot == null ? null : this.bot.inventory.slots[currentSlot]

    return !current || armorScore(best) > armorScore(current) ? best : null
  }

  async moveIntoBlockReach (block, signal) {
    const eye = this.bot.entity.position.offset(0, this.bot.entity.eyeHeight || 1.62, 0)
    const center = block.position.offset(0.5, 0.5, 0.5)
    if (eye.distanceTo(center) <= this.config.interactionReach && this.bot.canSeeBlock(block)) return

    await this.gotoGoal(new GoalLookAtBlock(block.position, this.bot.world, {
      reach: this.config.interactionReach
    }), signal)
  }

  async moveIntoEntityReach (entity, signal) {
    const distance = this.bot.entity.position.distanceTo(entity.position)
    if (distance <= this.config.entityReach) return
    const position = entity.position.clone()
    await this.gotoPosition({ x: position.x, y: position.y, z: position.z, range: 2 }, signal)

    if (entity.isValid === false) throw new Error('The target entity disappeared while approaching it.')
    if (this.bot.entity.position.distanceTo(entity.position) > this.config.interactionReach) {
      throw new Error('The target entity moved out of reach.')
    }
  }

  lookAtEntity (entity) {
    const height = Number(entity.height) || 1
    return this.bot.lookAt(entity.position.offset(0, height * 0.6, 0), true)
  }

  stopManualControls ({ preserveSneak = false } = {}) {
    if (typeof this.bot.setControlState !== 'function') return
    for (const control of ['forward', 'back', 'left', 'right', 'jump', 'sprint']) {
      this.bot.setControlState(control, false)
    }
    if (!preserveSneak) this.bot.setControlState('sneak', false)
  }

  dispose () {
    if (this.disposed) return
    this.disposed = true
    this.stopPathfinding()
  }
}

function normalizeDestination (destination) {
  const normalized = String(destination || 'hand').trim().toLowerCase().replace(/\s+/g, '_')
  const resolved = DESTINATION_ALIASES[normalized] || normalized
  if (!EQUIPMENT_DESTINATIONS.has(resolved)) {
    throw new Error(`Unknown equipment destination "${destination}".`)
  }
  return resolved
}

function normalizeItemQuery (query) {
  return String(query || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
}

function getArmorDestination (itemName) {
  const name = normalizeItemQuery(itemName)
  if (name.endsWith('_helmet') || name === 'turtle_helmet' || name === 'carved_pumpkin') return 'head'
  if (name.endsWith('_chestplate') || name === 'elytra') return 'torso'
  if (name.endsWith('_leggings')) return 'legs'
  if (name.endsWith('_boots')) return 'feet'
  return null
}

function armorScore (item) {
  if (!item) return -Infinity
  const name = normalizeItemQuery(item.name)
  const material = Object.keys(ARMOR_MATERIAL_RANK).find(prefix => name.startsWith(`${prefix}_`))
  let score = material ? ARMOR_MATERIAL_RANK[material] : 0
  if (name === 'turtle_helmet') score = ARMOR_MATERIAL_RANK.turtle
  if (name === 'elytra') score = 10
  score += (item.enchants?.length || 0) * 0.1
  return score
}


function isWeaponItem (item, { includeBow = false } = {}) {
  if (!item?.name) return false
  const name = normalizeItemQuery(item.name)
  if (name.endsWith('_sword') || name.endsWith('_axe') || name === 'trident' || name === 'mace') return true
  return includeBow && name === 'bow'
}

function weaponScore (item) {
  if (!item?.name) return -Infinity
  const name = normalizeItemQuery(item.name)
  const materials = { netherite: 70, diamond: 60, iron: 50, stone: 40, golden: 30, gold: 30, wooden: 20, wood: 20 }
  const material = Object.keys(materials).find(prefix => name.startsWith(`${prefix}_`))
  let score = material ? materials[material] : 0
  if (name.endsWith('_sword')) score += 20
  else if (name.endsWith('_axe')) score += 15
  else if (name === 'trident') score += 65
  else if (name === 'mace') score += 75
  else if (name === 'bow') score += 10
  else if (name === 'crossbow') score += 12
  score += (item.enchants?.length || 0) * 0.25
  return score
}

function anglesToPoint (origin, target) {
  const delta = target.minus(origin)
  const horizontal = Math.sqrt(delta.x * delta.x + delta.z * delta.z)
  return {
    yaw: Math.atan2(-delta.x, -delta.z),
    pitch: Math.atan2(delta.y, horizontal)
  }
}

function approachAngle (current, target, maximumStep) {
  let delta = target - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  if (Math.abs(delta) <= maximumStep) return target
  return current + Math.sign(delta) * maximumStep
}

function chooseOpenDirection (bot) {
  const base = bot.entity.position.floored()
  const directions = [
    new Vec3(1, 0, 0), new Vec3(-1, 0, 0), new Vec3(0, 0, 1), new Vec3(0, 0, -1),
    new Vec3(1, 0, 1), new Vec3(-1, 0, 1), new Vec3(1, 0, -1), new Vec3(-1, 0, -1)
  ]
  const open = directions.find(direction => {
    const feet = bot.blockAt(base.plus(direction))
    const head = bot.blockAt(base.plus(direction).offset(0, 1, 0))
    const floor = bot.blockAt(base.plus(direction).offset(0, -1, 0))
    return isPassableBlock(feet) && isPassableBlock(head) && floor && floor.boundingBox === 'block' && !isLavaBlock(floor)
  })
  return (open || directions[0]).normalize()
}

function isPassableBlock (block) {
  return !block || block.boundingBox === 'empty' || ['air', 'cave_air', 'void_air', 'water', 'flowing_water'].includes(block.name)
}

function isLavaBlock (block) {
  return Boolean(block && (block.name === 'lava' || block.name === 'flowing_lava'))
}

function isFireBlock (block) {
  return Boolean(block && ['fire', 'soul_fire'].includes(block.name))
}

function isChestBlock (block) {
  return Boolean(block && ['chest', 'trapped_chest'].includes(block.name))
}

function matchesItemRules (item, rules = {}) {
  if (!item?.name) return false
  const include = Array.isArray(rules.include) ? rules.include : (Array.isArray(rules.items) ? rules.items : ['*'])
  const exclude = Array.isArray(rules.exclude) ? rules.exclude : []
  const names = [item.name, item.displayName].filter(Boolean).map(normalizeItemQuery)
  const included = include.length === 0 ? false : include.some(pattern => names.some(name => matchesPattern(name, pattern)))
  const excluded = exclude.some(pattern => names.some(name => matchesPattern(name, pattern)))
  return included && !excluded
}

function matchesPattern (value, pattern) {
  const normalizedPattern = normalizeItemQuery(pattern || '*')
  if (normalizedPattern === '*') return true
  const escaped = normalizedPattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*')
  return new RegExp(`^${escaped}$`, 'i').test(value)
}

function canStackInInventory (bot, item) {
  return bot.inventory.items().some(candidate =>
    candidate.type === item.type &&
    candidate.metadata === item.metadata &&
    candidate.count < candidate.stackSize
  )
}

function isBotOnFire (bot) {
  const entity = bot.entity
  if (!entity) return false
  if (typeof entity.isOnFire === 'boolean') return entity.isOnFire
  if (typeof entity.onFire === 'boolean') return entity.onFire
  const flags = entity.metadata?.[0]
  return typeof flags === 'number' && (flags & 0x01) !== 0
}

function isWaterBlock (block) {
  return block.name === 'water' || block.name === 'flowing_water'
}

function findWaterPlacementSupport (bot) {
  const feet = bot.entity.position.floored()
  const candidates = [
    { offset: new Vec3(0, -1, 0), face: new Vec3(0, 1, 0) },
    { offset: new Vec3(1, 0, 0), face: new Vec3(-1, 0, 0) },
    { offset: new Vec3(-1, 0, 0), face: new Vec3(1, 0, 0) },
    { offset: new Vec3(0, 0, 1), face: new Vec3(0, 0, -1) },
    { offset: new Vec3(0, 0, -1), face: new Vec3(0, 0, 1) }
  ]

  for (const candidate of candidates) {
    const block = bot.blockAt(feet.plus(candidate.offset))
    if (block && block.boundingBox === 'block' && block.name !== 'air') {
      return { block, face: candidate.face }
    }
  }

  return null
}

function getVisibleBlockFace (bot, block) {
  try {
    const eye = bot.entity.position.offset(0, bot.entity.eyeHeight || 1.62, 0)
    const target = block.position.offset(0.5, 0.5, 0.5)
    const direction = target.minus(eye).normalize()
    const hit = bot.world.raycast(eye, direction, 5)
    if (hit?.position?.equals(block.position) && Number.isInteger(hit.face)) return hit.face
  } catch (_) {}
  return 1
}

function entityNames (entity) {
  return [entity.username, entity.name, entity.displayName]
    .filter(Boolean)
    .map(name => String(name).toLowerCase())
}

function nearestToBot (bot, entities) {
  return [...entities].sort((a, b) =>
    bot.entity.position.distanceSquared(a.position) - bot.entity.position.distanceSquared(b.position)
  )[0]
}

function describeEntity (entity) {
  return entity.username || entity.displayName || entity.name || `entity ${entity.id}`
}

function toFinitePosition (x, y, z) {
  const position = { x: Number(x), y: Number(y), z: Number(z) }
  if (![position.x, position.y, position.z].every(Number.isFinite)) {
    throw new TypeError('Coordinates must be finite numbers.')
  }
  return position
}

function toVec3 (value) {
  if (value instanceof Vec3) return value
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

function raceWithAbort (operation, signal, onAbort = () => {}) {
  const promise = Promise.resolve(operation)
  if (!signal) return promise
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    let settled = false

    function cleanup () {
      signal.removeEventListener('abort', aborted)
    }

    function finish (callback, value) {
      if (settled) return
      settled = true
      cleanup()
      callback(value)
    }

    function aborted () {
      try {
        onAbort()
      } catch (_) {}
      finish(reject, signal.reason instanceof Error ? signal.reason : new TaskCancelledError())
    }

    signal.addEventListener('abort', aborted, { once: true })
    promise.then(
      value => finish(resolve, value),
      error => finish(reject, error)
    )
  })
}

async function waitUntil (predicate, timeoutMs, signal, intervalMs = 100) {
  const deadline = Date.now() + Math.max(0, timeoutMs)
  while (!predicate()) {
    throwIfAborted(signal)
    if (Date.now() >= deadline) throw new Error('Timed out waiting for the condition to become true.')
    await abortableSleep(intervalMs, signal)
  }
}

module.exports = {
  ActionService,
  normalizeDestination,
  normalizeItemQuery,
  getArmorDestination,
  armorScore,
  isWeaponItem,
  weaponScore,
  anglesToPoint,
  approachAngle,
  matchesItemRules,
  isLavaBlock,
  isFireBlock,
  isChestBlock,
  isBotOnFire,
  raceWithAbort
}
