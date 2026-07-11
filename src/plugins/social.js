'use strict'

const { SocialService } = require('../social-service')

module.exports = {
  name: 'social',

  setup (context) {
    const social = new SocialService({
      bot: context.bot,
      tasks: context.requireService('tasks'),
      actions: context.requireService('actions'),
      pvp: context.getService('pvp'),
      commands: context.requireService('commands'),
      config: context.pluginConfig,
      logger: context.logger
    })

    context.on(context.bot, 'entityCrouch', entity => social.onCrouch(entity))
    context.on(context.bot, 'entityGone', entity => social.forgetEntity(entity))
    const interval = setInterval(() => social.tick(), Math.max(50, Number(context.pluginConfig.tickIntervalMs) || 150))
    context.addCleanup(() => clearInterval(interval))
    context.addCleanup(() => social.dispose())
    context.provideService('social', social)
  }
}
