'use strict'

const { StatusEffectService } = require('../status-effect-service')

module.exports = {
  name: 'status-effects',

  setup (context) {
    context.provideService('statusEffects', new StatusEffectService(context.bot))
  }
}
