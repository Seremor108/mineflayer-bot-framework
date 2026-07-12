'use strict'

// Queued, interruptible command example.
module.exports = {
  name: 'example-queued-task',

  setup (context) {
    const commands = context.requireService('commands')

    const unregister = commands.register('example-wait', {
      description: 'Queue a cancellable wait without blocking other command parsing.',
      usage: '!example-wait [milliseconds]',

      // createTask runs when the command is accepted. It returns work for the
      // shared serialized task queue instead of doing long-running work here.
      createTask ({ args, username }) {
        const durationMs = args[0] == null ? 1000 : Number(args[0])
        if (!Number.isFinite(durationMs) || durationMs < 0 || durationMs > 60000) {
          throw new Error('Duration must be between 0 and 60000 milliseconds.')
        }

        return {
          name: `example wait for ${Math.floor(durationMs)} ms`,
          priority: 0,
          interruptible: true,
          resumeOnInterrupt: false,
          metadata: { requestedBy: username },

          // The task context includes an AbortSignal and an abort-aware sleep.
          // Use these instead of a bare timeout so emergencies can cancel work.
          async run ({ signal, sleep, attempt }) {
            context.logger.debug(`Example task attempt ${attempt}.`)
            await sleep(Math.floor(durationMs))
            if (signal.aborted) throw signal.reason
            return `Waited ${Math.floor(durationMs)} ms.`
          }
        }
      }
    })

    context.addCleanup(unregister)
  }
}
