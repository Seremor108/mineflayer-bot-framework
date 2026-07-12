'use strict'

// Shared service consumer example. Enable example-service-provider as well.
module.exports = {
  name: 'example-service-user',

  setup (context) {
    const commands = context.requireService('commands')

    // requireService fails setup with a clear message when a required dependency
    // is absent. Use getService(name) instead when a dependency is optional.
    const clock = context.requireService('exampleClock')

    const unregister = commands.register('example-time', {
      description: 'Read state from another user plugin\'s shared service.',
      usage: '!example-time',
      statusReport: true,
      async run () {
        return `Time: ${clock.now().toISOString()}; provider uptime: ${clock.uptimeMs()} ms.`
      }
    })

    context.addCleanup(unregister)
  }
}
