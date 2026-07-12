'use strict'

// Mineflayer events, timers, logging, and cleanup.
module.exports = {
  name: 'example-events',

  setup (context) {
    // context.bot is the live Mineflayer bot. context.on/once track listeners and
    // automatically remove them when this plugin unloads or the bot disconnects.
    context.on(context.bot, 'spawn', () => {
      const position = context.bot.entity?.position
      context.logger.info('Spawn event received at', position || 'an unknown position')
    })

    context.once(context.bot, 'kicked', reason => {
      context.logger.warn('The server kicked the bot:', reason)
    })

    // Timers are not EventEmitter listeners, so register their cleanup manually.
    const heartbeatMs = Math.max(1000, Number(context.pluginConfig.heartbeatMs) || 30000)
    const timer = setInterval(() => {
      context.logger.debug('Example heartbeat; connected:', Boolean(context.bot.entity))
    }, heartbeatMs)
    timer.unref?.()
    context.addCleanup(() => clearInterval(timer))
  }
}
