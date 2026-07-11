'use strict'

class AutonomyService {
  constructor ({ bot, tasks, actions, commands, config = {}, logger = console }) {
    this.bot = bot
    this.tasks = tasks
    this.actions = actions
    this.commands = commands
    this.logger = logger
    this.config = {
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
      },
      ...config
    }
    this.config.chestLooting = { enabled: false, searchRadius: 16, checkIntervalMs: 1500, revisitCooldownMs: 300000, blockNames: ['chest', 'trapped_chest'], include: ['*'], exclude: [], maxPerStack: null, ...(config.chestLooting || {}) }
    this.config.inventoryToss = { enabled: false, checkIntervalMs: 500, minimumFreeSlots: 1, include: ['rotten_flesh', 'poisonous_potato', 'spider_eye'], exclude: [], ...(config.inventoryToss || {}) }

    this.lastLootCheckAt = 0
    this.lastTossCheckAt = 0
    this.visitedChests = new Map()
    this.activeLootTask = null
    this.activeTossTask = null
    this.disposed = false

    this.unregisterLoot = commands.register('loot', {
      description: 'Toggle autonomous chest looting.',
      usage: '!loot [on|off|status]',
      run: ({ args }) => this.toggle('chestLooting', args[0])
    })
    this.unregisterToss = commands.register('tossjunk', {
      aliases: ['autotoss'],
      description: 'Toggle automatic configured-item disposal when inventory is full.',
      usage: '!tossjunk [on|off|status]',
      run: ({ args }) => this.toggle('inventoryToss', args[0])
    })
  }

  toggle (section, mode) {
    const target = this.config[section]
    const normalized = String(mode || 'status').toLowerCase()
    const label = section === 'chestLooting' ? 'Autonomous chest looting' : 'Automatic item tossing'
    if (normalized === 'status') return `${label} is ${target.enabled ? 'on' : 'off'}.`
    if (['on', 'true', 'enable', 'enabled'].includes(normalized)) target.enabled = true
    else if (['off', 'false', 'disable', 'disabled'].includes(normalized)) target.enabled = false
    else throw new Error('Mode must be on, off, or status.')
    return `${label} is now ${target.enabled ? 'on' : 'off'}.`
  }

  tick () {
    if (this.disposed || !this.bot.entity) return
    const now = Date.now()
    if (this.config.inventoryToss.enabled && now - this.lastTossCheckAt >= this.config.inventoryToss.checkIntervalMs) {
      this.lastTossCheckAt = now
      this.checkInventoryToss()
    }
    if (this.config.chestLooting.enabled && now - this.lastLootCheckAt >= this.config.chestLooting.checkIntervalMs) {
      this.lastLootCheckAt = now
      this.checkChestLooting()
    }
    this.pruneVisited(now)
  }

  checkInventoryToss () {
    if (this.activeTossTask || this.bot.inventory.emptySlotCount() > 0) return
    const handle = this.tasks.enqueue({
      name: 'discard configured useless items',
      source: 'autonomy',
      priority: -20,
      interruptible: true,
      resumeOnInterrupt: false,
      metadata: { autonomy: 'inventory-toss' },
      run: ({ signal }) => this.actions.tossConfiguredItems(this.config.inventoryToss, signal)
    })
    this.activeTossTask = handle
    handle.promise.catch(error => this.logger.debug?.('Automatic toss ended:', error.message)).finally(() => {
      if (this.activeTossTask === handle) this.activeTossTask = null
    })
  }

  checkChestLooting () {
    if (this.activeLootTask) return
    const state = this.tasks.list()
    if (state.current || state.pending.length > 0) return
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
      metadata: { autonomy: 'chest-loot', position: { x: position.x, y: position.y, z: position.z } },
      run: async ({ signal }) => {
        if (this.bot.inventory.emptySlotCount() === 0 && this.config.inventoryToss.enabled) {
          await this.actions.tossConfiguredItems(this.config.inventoryToss, signal)
        }
        return this.actions.lootChest(position, this.config.chestLooting, signal)
      }
    })
    this.activeLootTask = handle
    handle.promise.catch(error => this.logger.debug?.('Chest looting ended:', error.message)).finally(() => {
      if (this.activeLootTask === handle) this.activeLootTask = null
    })
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
      .filter(position => !this.isRecentlyVisited(position))
      .sort((a, b) => this.bot.entity.position.distanceSquared(a) - this.bot.entity.position.distanceSquared(b))[0] || null
  }

  isRecentlyVisited (position) {
    const visitedAt = this.visitedChests.get(this.chestKey(position)) || 0
    return Date.now() - visitedAt < Math.max(1000, Number(this.config.chestLooting.revisitCooldownMs) || 300000)
  }

  chestKey (position) {
    return `${this.bot.game?.dimension || 'unknown'}:${position.x},${position.y},${position.z}`
  }

  pruneVisited (now = Date.now()) {
    const cooldown = Math.max(1000, Number(this.config.chestLooting.revisitCooldownMs) || 300000)
    for (const [key, visitedAt] of this.visitedChests) {
      if (now - visitedAt >= cooldown) this.visitedChests.delete(key)
    }
  }

  dispose () {
    this.disposed = true
    this.unregisterLoot?.()
    this.unregisterToss?.()
    this.activeLootTask?.cancel('Autonomy service stopped.')
    this.activeTossTask?.cancel('Autonomy service stopped.')
    this.visitedChests.clear()
  }
}

module.exports = { AutonomyService }
