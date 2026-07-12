'use strict'

// Shared service provider example.
// The filename sorts before example-service-user.js, so it loads first when both
// examples are enabled. Real dependent plugins should document the same ordering.
module.exports = {
  name: 'example-service-provider',

  setup (context) {
    const startedAt = Date.now()
    const clock = Object.freeze({
      now: () => new Date(),
      uptimeMs: () => Date.now() - startedAt
    })

    // Other plugins can retrieve this value with getService or requireService.
    // The manager automatically removes an owned service during plugin cleanup.
    context.provideService('exampleClock', clock)
    context.logger.info('Providing the exampleClock service.')
  }
}
