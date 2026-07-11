'use strict'

const { createCommandService } = require('../commands')
const { registerBuiltInCommands } = require('./commands')

module.exports = {
  name: 'commands',

  setup (context) {
    const tasks = context.requireService('tasks')
    const actions = context.requireService('actions')
    const commands = createCommandService(
      context.bot,
      context.config,
      context.logger,
      tasks,
      context.pluginConfig
    )

    context.provideService('commands', commands)
    context.addCleanup(() => commands.dispose())

    registerBuiltInCommands(commands, tasks, actions, {
      statusEffects: context.getService('statusEffects'),
      teams: context.getService('teams'),
      pvp: context.getService('pvp'),
      follow: context.getService('follow')
    })
  }
}
