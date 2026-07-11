'use strict'

const { TeamService } = require('../team-service')

module.exports = {
  name: 'teams',

  setup (context) {
    context.provideService('teams', new TeamService(context.bot, context.pluginConfig))
  }
}
