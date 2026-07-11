'use strict'

const { CombatService } = require('../combat-service')

module.exports = {
  name: 'pvp',

  setup (context) {
    const tasks = context.requireService('tasks')
    const actions = context.requireService('actions')
    const teams = context.requireService('teams')
    const combat = new CombatService({
      bot: context.bot,
      tasks,
      actions,
      teams,
      config: context.pluginConfig,
      logger: context.logger
    })

    actions.setEntityAttackPolicy(entity => combat.canAttack(entity))
    context.addCleanup(() => actions.setEntityAttackPolicy(null))

    const recentSwings = new Map()
    let lastHurtHandledAt = 0

    context.on(context.bot, 'entitySwingArm', entity => {
      if (!entity || entity === context.bot.entity) return
      recentSwings.set(entity.id, Date.now())
    })

    context.on(context.bot, 'entityGone', entity => {
      if (entity) recentSwings.delete(entity.id)
    })

    context.on(context.bot, 'entityHurt', (entity, source) => {
      if (entity !== context.bot.entity) return
      const now = Date.now()
      if (now - lastHurtHandledAt < 75) return
      lastHurtHandledAt = now
      const attacker = source || inferRecentAttacker(context.bot, recentSwings, context.pluginConfig)
      if (attacker) combat.onAttacked(attacker)
    })

    const interval = setInterval(() => combat.tick(), Math.max(50, Number(context.pluginConfig.tickIntervalMs) || 100))
    context.addCleanup(() => clearInterval(interval))
    context.addCleanup(() => combat.dispose())
    context.provideService('pvp', combat)
  }
}

function inferRecentAttacker (bot, recentSwings, config = {}) {
  if (!bot.entity) return null
  const windowMs = Math.max(100, Number(config.attackerInferenceWindowMs) || 900)
  const radius = Math.max(1, Number(config.attackerInferenceRadius) || 4.5)
  const now = Date.now()
  return Object.values(bot.entities || {})
    .filter(entity => entity && entity !== bot.entity && entity.isValid !== false)
    .filter(entity => now - (recentSwings.get(entity.id) || 0) <= windowMs)
    .filter(entity => bot.entity.position.distanceTo(entity.position) <= radius)
    .sort((a, b) => bot.entity.position.distanceSquared(a.position) - bot.entity.position.distanceSquared(b.position))[0] || null
}

module.exports.inferRecentAttacker = inferRecentAttacker
