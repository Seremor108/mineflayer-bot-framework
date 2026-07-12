'use strict'

// Minimal immediate command example.
//
// Copy this file, change both names, and enable the matching config entry.
// The commands service is provided by the built-in commands plugin, which loads
// before user plugins in plugins/.
module.exports = {
  name: 'example-command',

  setup (context) {
    const commands = context.requireService('commands')

    const unregister = commands.register('example-echo', {
      aliases: ['example-say'],
      description: 'Echo text back to the player who sent the command.',
      usage: '!example-echo <text>',

      // Immediate commands receive the sending player, parsed arguments, reply
      // function, bot, channel, prefix, and task queue in this command context.
      async run ({ args, username }) {
        if (args.length === 0) throw new Error('Usage: example-echo <text>')

        // Returning text automatically replies through the same channel that
        // received the command. Use reply(text) when more than one reply is needed.
        return `${username} said: ${args.join(' ')}`
      }
    })

    // Command registration returns an unregister function. Always add it to the
    // plugin lifecycle so reconnects do not leave duplicate commands behind.
    context.addCleanup(unregister)
  }
}
