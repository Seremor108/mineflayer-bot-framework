'use strict'

module.exports = {
  name: 'hello',

  setup (context) {
    const commands = context.requireService('commands')
    const message = context.pluginConfig.message || 'Hello from the plugin system!'

    const unregister = commands.register('hello', {
      description: 'Reply using the example plugin.',
      run: async ({ username, reply }) => {
        reply(`${message} Hi, ${username}.`)
      }
    })

    context.addCleanup(unregister)
  }
}
