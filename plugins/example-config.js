'use strict'

// Reading plugin-specific configuration.
// Values come from config.plugins['example-config'] and are exposed as a frozen
// object. context.config contains the full root config, but plugins should prefer
// pluginConfig for their own options. Keep defaults so omitted settings stay safe.
module.exports = {
  name: 'example-config',

  setup (context) {
    const commands = context.requireService('commands')
    const greeting = String(context.pluginConfig.greeting || 'Hello')
    const includeUsername = context.pluginConfig.includeUsername !== false

    const unregister = commands.register('example-greet', {
      description: 'Reply using values from this plugin\'s configuration.',
      usage: '!example-greet',
      async run ({ username }) {
        return includeUsername ? `${greeting}, ${username}!` : `${greeting}!`
      }
    })

    context.logger.info('Configured example greeting:', greeting)
    context.addCleanup(unregister)
  }
}
