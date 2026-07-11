'use strict'

const { ScaffoldingActionService } = require('../scaffolding-action-service')

module.exports = {
  name: 'actions',

  setup (context) {
    const actions = new ScaffoldingActionService(context.bot, context.pluginConfig, context.logger)

    context.on(context.bot, 'spawn', () => {
      actions.configureMovements()
    })

    if (context.bot.entity) actions.configureMovements()

    context.provideService('actions', actions)
    context.addCleanup(() => actions.dispose())
  }
}
