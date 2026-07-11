'use strict'

const { TaskQueue } = require('../task-queue')

module.exports = {
  name: 'tasks',

  setup (context) {
    const queue = new TaskQueue({ logger: context.logger })
    context.provideService('tasks', queue)
    context.addCleanup(() => queue.dispose())
  }
}
