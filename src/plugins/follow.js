'use strict'

const { FollowService } = require('../follow-service')

module.exports = {
  name: 'follow',

  setup (context) {
    const follow = new FollowService({
      bot: context.bot,
      tasks: context.requireService('tasks'),
      actions: context.requireService('actions'),
      pvp: context.getService('pvp'),
      config: context.pluginConfig,
      logger: context.logger
    })

    context.provideService('follow', follow)
    context.addCleanup(() => follow.dispose())
  }
}
