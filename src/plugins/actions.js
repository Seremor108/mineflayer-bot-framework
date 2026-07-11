'use strict'

const { ActionService } = require('../action-service')

module.exports = {
  name: 'actions',

  setup (context) {
    const actions = new ActionService(context.bot, context.pluginConfig, context.logger)

    context.on(context.bot, 'spawn', () => {
      actions.configureMovements()
    })

    if (context.bot.entity) actions.configureMovements()

    context.provideService('actions', actions)
    context.addCleanup(() => actions.dispose())
  }
}
