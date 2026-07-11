'use strict'

const { EventEmitter } = require('node:events')

class TaskQueueError extends Error {
  constructor (message, code) {
    super(message)
    this.name = this.constructor.name
    this.code = code
  }
}

class TaskCancelledError extends TaskQueueError {
  constructor (message = 'Task cancelled.') {
    super(message, 'TASK_CANCELLED')
  }
}

class TaskInterruptedError extends TaskQueueError {
  constructor (message = 'Task interrupted by a higher-priority task.') {
    super(message, 'TASK_INTERRUPTED')
  }
}

class TaskQueue extends EventEmitter {
  constructor ({ logger = console } = {}) {
    super()
    this.logger = logger
    this.pending = []
    this.current = null
    this.nextId = 1
    this.nextSequence = 1
    this.running = false
    this.disposed = false
  }

  enqueue (spec) {
    if (this.disposed) throw new Error('Cannot enqueue tasks after the queue has been disposed.')

    const task = createTaskRecord(spec, this.nextId++, this.nextSequence++)
    this.pending.push(task)
    this.sortPending()
    this.emit('queued', summarizeTask(task))
    this.schedulePump()

    const handle = Object.freeze({
      id: task.id,
      promise: task.promise,
      cancel: (reason) => this.cancel(task.id, reason),
      get status () { return task.status }
    })

    return handle
  }

  interrupt (spec, options = {}) {
    const priority = Number.isFinite(spec.priority) ? spec.priority : 1000
    const handle = this.enqueue({
      ...spec,
      priority,
      source: spec.source || 'system',
      interruptible: spec.interruptible === true,
      resumeOnInterrupt: false
    })

    const current = this.current
    const shouldInterrupt = current &&
      current.interruptible &&
      priority > current.priority &&
      options.interruptCurrent !== false

    if (shouldInterrupt) {
      current.requeueAfterInterrupt = options.resumeCurrent !== false && current.resumeOnInterrupt
      current.controller.abort(new TaskInterruptedError(
        options.reason || `Interrupted by task #${handle.id}.`
      ))
    }

    return handle
  }

  cancel (taskId, reason = 'Task cancelled.') {
    const numericId = Number(taskId)

    if (this.current?.id === numericId) {
      if (!this.current.interruptible) return false
      this.current.requeueAfterInterrupt = false
      this.current.controller.abort(asCancellationError(reason))
      return true
    }

    const index = this.pending.findIndex(task => task.id === numericId)
    if (index === -1) return false

    const [task] = this.pending.splice(index, 1)
    task.status = 'cancelled'
    const error = asCancellationError(reason)
    task.reject(error)
    this.emit('cancelled', summarizeTask(task), error)
    return true
  }

  cancelCurrent (reason = 'Current task cancelled.', predicate = () => true) {
    if (!this.current || !predicate(this.current) || !this.current.interruptible) return false
    this.current.requeueAfterInterrupt = false
    this.current.controller.abort(asCancellationError(reason))
    return true
  }

  cancelPending (predicate = () => true, reason = 'Pending task cancelled.') {
    const error = asCancellationError(reason)
    const cancelled = []
    const kept = []

    for (const task of this.pending) {
      if (predicate(task)) {
        task.status = 'cancelled'
        task.reject(error)
        cancelled.push(task.id)
        this.emit('cancelled', summarizeTask(task), error)
      } else {
        kept.push(task)
      }
    }

    this.pending = kept
    return cancelled
  }

  cancelAll ({ includeSystem = false, reason = 'Task queue cleared.' } = {}) {
    const predicate = includeSystem ? () => true : task => task.source === 'user'
    const pendingIds = this.cancelPending(predicate, reason)
    const currentCancelled = this.cancelCurrent(reason, predicate)
    return { pendingIds, currentCancelled }
  }

  list () {
    return {
      current: this.current ? summarizeTask(this.current) : null,
      pending: this.pending.map(summarizeTask)
    }
  }

  async dispose () {
    if (this.disposed) return
    this.disposed = true
    this.cancelPending(() => true, 'Task queue disposed.')

    if (this.current) {
      this.current.requeueAfterInterrupt = false
      this.current.controller.abort(new TaskCancelledError('Task queue disposed.'))
    }

    const deadline = Date.now() + 1000
    while (this.running && Date.now() < deadline) {
      await new Promise(resolve => setTimeout(resolve, 5))
    }

    if (this.running) {
      const warn = this.logger.warn || this.logger.log
      warn.call(this.logger, 'Task queue disposal timed out; a task ignored its abort signal.')
    }

    this.removeAllListeners()
  }

  sortPending () {
    this.pending.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence)
  }

  schedulePump () {
    if (this.running) return
    queueMicrotask(() => void this.pump())
  }

  async pump () {
    if (this.running || this.disposed && this.pending.length === 0) return
    this.running = true

    try {
      while (this.pending.length > 0) {
        const task = this.pending.shift()
        await this.runTask(task)
      }
    } finally {
      this.running = false
      if (this.pending.length > 0) this.schedulePump()
    }
  }

  async runTask (task) {
    task.status = 'running'
    task.attempts += 1
    task.controller = new AbortController()
    task.requeueAfterInterrupt = false
    this.current = task
    this.emit('started', summarizeTask(task))

    const context = Object.freeze({
      id: task.id,
      name: task.name,
      source: task.source,
      metadata: task.metadata,
      attempt: task.attempts,
      signal: task.controller.signal,
      queue: this,
      throwIfAborted: () => throwIfAborted(task.controller.signal),
      sleep: ms => abortableSleep(ms, task.controller.signal)
    })

    try {
      const result = await task.run(context)
      throwIfAborted(task.controller.signal)
      task.status = 'completed'
      task.resolve(result)
      this.emit('completed', summarizeTask(task), result)
    } catch (error) {
      const abortReason = task.controller.signal.aborted
        ? task.controller.signal.reason
        : null
      const failure = normalizeError(abortReason || error)

      if (failure instanceof TaskInterruptedError && task.requeueAfterInterrupt) {
        task.status = 'queued'
        task.controller = null
        this.pending.push(task)
        this.sortPending()
        this.emit('interrupted', summarizeTask(task), failure)
      } else if (failure instanceof TaskCancelledError || failure instanceof TaskInterruptedError) {
        task.status = 'cancelled'
        task.reject(failure)
        this.emit('cancelled', summarizeTask(task), failure)
      } else {
        task.status = 'failed'
        task.reject(failure)
        this.emit('failed', summarizeTask(task), failure)
        this.logger.error(`[task:${task.id}] ${task.name} failed:`, failure)
      }
    } finally {
      if (this.current === task) this.current = null
      task.controller = null
    }
  }
}

function createTaskRecord (spec, id, sequence) {
  if (!spec || typeof spec !== 'object') throw new TypeError('Task specification must be an object.')
  if (typeof spec.run !== 'function') throw new TypeError('Task specification must define run(context).')

  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })

  // Prevent a rejected task from becoming an unhandled rejection when callers only
  // use queue events. The original promise remains awaitable and still rejects.
  promise.catch(() => {})

  return {
    id,
    sequence,
    name: String(spec.name || `task-${id}`),
    priority: Number.isFinite(spec.priority) ? spec.priority : 0,
    source: String(spec.source || 'user'),
    interruptible: spec.interruptible !== false,
    resumeOnInterrupt: spec.resumeOnInterrupt !== false,
    metadata: Object.freeze({ ...(spec.metadata || {}) }),
    run: spec.run,
    attempts: 0,
    status: 'queued',
    controller: null,
    requeueAfterInterrupt: false,
    promise,
    resolve,
    reject
  }
}

function summarizeTask (task) {
  return Object.freeze({
    id: task.id,
    name: task.name,
    priority: task.priority,
    source: task.source,
    status: task.status,
    attempts: task.attempts,
    interruptible: task.interruptible,
    metadata: task.metadata
  })
}

function asCancellationError (reason) {
  if (reason instanceof TaskCancelledError) return reason
  if (reason instanceof Error) return new TaskCancelledError(reason.message)
  return new TaskCancelledError(String(reason))
}

function normalizeError (error) {
  if (error instanceof Error) return error
  return new Error(String(error || 'Unknown task failure.'))
}

function throwIfAborted (signal) {
  if (!signal?.aborted) return
  throw normalizeError(signal.reason || new TaskCancelledError())
}

function abortableSleep (milliseconds, signal) {
  const duration = Math.max(0, Number(milliseconds) || 0)
  throwIfAborted(signal)

  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, duration)

    function done () {
      cleanup()
      resolve()
    }

    function aborted () {
      cleanup()
      reject(normalizeError(signal.reason || new TaskCancelledError()))
    }

    function cleanup () {
      clearTimeout(timer)
      signal?.removeEventListener('abort', aborted)
    }

    signal?.addEventListener('abort', aborted, { once: true })
  })
}

module.exports = {
  TaskQueue,
  TaskQueueError,
  TaskCancelledError,
  TaskInterruptedError,
  abortableSleep,
  throwIfAborted
}
