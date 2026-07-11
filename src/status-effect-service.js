'use strict'

class StatusEffectService {
  constructor (bot) {
    if (!bot) throw new Error('StatusEffectService requires a bot instance.')
    this.bot = bot
  }

  resolve (effectQuery) {
    if (effectQuery && typeof effectQuery === 'object' && Number.isInteger(effectQuery.id)) {
      return effectQuery
    }

    const numericId = Number(effectQuery)
    if (Number.isInteger(numericId) && numericId >= 0) {
      return this.bot.registry?.effects?.[numericId] || { id: numericId, name: String(numericId), displayName: String(numericId) }
    }

    const normalized = normalizeEffectName(effectQuery)
    if (!normalized) throw new Error('A status effect name or id is required.')

    const effect = (this.bot.registry?.effectsArray || []).find(candidate => {
      return [candidate.name, candidate.displayName]
        .filter(Boolean)
        .some(value => normalizeEffectName(value) === normalized)
    })

    if (!effect) throw new Error(`Unknown status effect "${effectQuery}".`)
    return effect
  }

  get (effectQuery, entity = this.bot.entity) {
    if (!entity) return null
    const effect = this.resolve(effectQuery)
    return entity.effects?.[effect.id] || null
  }

  has (effectQuery, entity = this.bot.entity, minimumAmplifier = 0) {
    const active = this.get(effectQuery, entity)
    return Boolean(active && Number(active.amplifier) >= Number(minimumAmplifier || 0))
  }

  list (entity = this.bot.entity) {
    if (!entity) return []
    return Object.values(entity.effects || {}).map(active => {
      const descriptor = this.bot.registry?.effects?.[active.id]
      return {
        ...active,
        name: descriptor?.name || String(active.id),
        displayName: descriptor?.displayName || descriptor?.name || String(active.id),
        level: Number(active.amplifier) + 1
      }
    })
  }
}

function normalizeEffectName (value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/^minecraft:/, '')
    .replace(/[^a-z0-9]+/g, '')
}

module.exports = { StatusEffectService, normalizeEffectName }
