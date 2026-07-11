'use strict'

const { AutonomyService } = require('../autonomy-service')

module.exports = {
  name: 'autonomy',

  setup (context) {
    const autonomy = new AutonomyService({
      bot: context.bot,
      tasks: context.requireService('tasks'),
      actions: context.requireService('actions'),
      commands: context.requireService('commands'),
      config: context.pluginConfig,
      logger: context.logger
    })
    const interval = setInterval(() => autonomy.tick(), Math.max(100, Number(context.pluginConfig.tickIntervalMs) || 250))
    context.addCleanup(() => clearInterval(interval))
    context.addCleanup(() => autonomy.dispose())
    context.provideService('autonomy', autonomy)
  }
}
