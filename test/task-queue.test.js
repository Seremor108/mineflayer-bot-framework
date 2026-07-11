'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { once } = require('node:events')
const {
  TaskQueue,
  TaskCancelledError,
  abortableSleep
} = require('../src/task-queue')

function createLogger () {
  return { debug () {}, log () {}, info () {}, warn () {}, error () {} }
}

test('runs queued tasks one at a time in priority order', async () => {
  const queue = new TaskQueue({ logger: createLogger() })
  const order = []

  const low = queue.enqueue({
    name: 'low',
    priority: 0,
    run: async () => { order.push('low') }
  })

  const high = queue.enqueue({
    name: 'high',
    priority: 10,
    run: async () => { order.push('high') }
  })

  await Promise.all([low.promise, high.promise])
  assert.deepEqual(order, ['high', 'low'])
  await queue.dispose()
})

test('an emergency task interrupts and then restarts a user task', async () => {
  const queue = new TaskQueue({ logger: createLogger() })
  const order = []

  const userTask = queue.enqueue({
    name: 'walk somewhere',
    source: 'user',
    resumeOnInterrupt: true,
    run: async ({ attempt, signal }) => {
      order.push(`user-${attempt}-start`)
      if (attempt === 1) await abortableSleep(10000, signal)
      order.push(`user-${attempt}-finish`)
    }
  })

  await once(queue, 'started')

  const emergency = queue.interrupt({
    name: 'extinguish fire',
    source: 'safety',
    priority: 1000,
    interruptible: false,
    run: async () => { order.push('emergency') }
  }, { resumeCurrent: true })

  await Promise.all([userTask.promise, emergency.promise])
  assert.deepEqual(order, [
    'user-1-start',
    'emergency',
    'user-2-start',
    'user-2-finish'
  ])
  await queue.dispose()
})

test('cancels pending tasks without running them', async () => {
  const queue = new TaskQueue({ logger: createLogger() })
  let releaseCurrent
  const currentGate = new Promise(resolve => { releaseCurrent = resolve })

  const current = queue.enqueue({
    name: 'current',
    run: async () => currentGate
  })
  await once(queue, 'started')

  let ran = false
  const pending = queue.enqueue({
    name: 'pending',
    run: async () => { ran = true }
  })

  assert.equal(queue.cancel(pending.id, 'No longer needed.'), true)
  await assert.rejects(pending.promise, TaskCancelledError)
  assert.equal(ran, false)

  releaseCurrent()
  await current.promise
  await queue.dispose()
})
