import { createConsoleLogger } from '@sidekick/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskContext, TaskEngine, TaskTimeoutError } from '../task-engine.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })

// Helper to create a deferred promise for controlled task completion
function createDeferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve!: () => void
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

describe('TaskEngine', () => {
  let engine: TaskEngine

  beforeEach(() => {
    // Use short default timeout for tests (100ms instead of 5 minutes)
    engine = new TaskEngine(logger, 2, 100)
  })

  it('should execute tasks', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    engine.registerHandler('test', handler)

    return new Promise<void>((resolve) => {
      engine.registerHandler('test', async (payload, _ctx: TaskContext) => {
        await handler(payload)
        resolve()
      })
      engine.enqueue('test', { foo: 'bar' })
    }).then(() => {
      expect(handler).toHaveBeenCalledWith({ foo: 'bar' })
    })
  })

  it('should respect priority', async () => {
    // Use maxConcurrency=1 so only one task runs at a time
    // Long timeout so blocking task doesn't timeout
    const singleEngine = new TaskEngine(logger, 1, 60000)
    const executionOrder: string[] = []

    // Use a blocking handler that waits until we release it
    // This allows us to enqueue all tasks before any start processing
    const blocker = createDeferred()

    // First task blocks, allowing queue to fill before other tasks process
    let firstTaskStarted = false
    singleEngine.registerHandler('block', async (_payload, _ctx: TaskContext) => {
      firstTaskStarted = true
      await blocker.promise
    })

    singleEngine.registerHandler('test', (payload: Record<string, unknown>, _ctx: TaskContext): Promise<void> => {
      executionOrder.push(payload.id as string)
      return Promise.resolve()
    })

    // Enqueue blocking task first (takes the only concurrency slot)
    singleEngine.enqueue('block', {}, 0)

    // Wait for blocking task to start
    await vi.waitFor(() => expect(firstTaskStarted).toBe(true))

    // Now enqueue prioritized tasks - they queue up and get sorted
    singleEngine.enqueue('test', { id: 'low' }, 1)
    singleEngine.enqueue('test', { id: 'high' }, 10)
    singleEngine.enqueue('test', { id: 'medium' }, 5)

    // Queue should now be sorted: high(10), medium(5), low(1)
    // Release the blocker to let processing continue
    blocker.resolve()

    // Wait for all tasks to complete
    await vi.waitFor(() => expect(executionOrder.length).toBe(3))

    // Verify priority order: high first, then medium, then low
    expect(executionOrder).toEqual(['high', 'medium', 'low'])
  })

  it('should reject enqueue after shutdown', async () => {
    engine.registerHandler('test', () => Promise.resolve())
    await engine.shutdown()
    expect(() => engine.enqueue('test', {})).toThrow('TaskEngine is shutting down')
  })

  it('should wait for running tasks on shutdown', async () => {
    // Use longer timeout for shutdown test
    const slowEngine = new TaskEngine(logger, 2, 60000)
    const taskDeferred = createDeferred()
    let taskCompleted = false

    slowEngine.registerHandler('slow', async (_payload, _ctx: TaskContext) => {
      await taskDeferred.promise
      taskCompleted = true
    })

    slowEngine.enqueue('slow', {})

    // Start shutdown (should wait for task)
    const shutdownPromise = slowEngine.shutdown()

    // Task should still be running
    expect(taskCompleted).toBe(false)

    // Complete the task
    taskDeferred.resolve()

    // Now shutdown should complete
    await shutdownPromise
    expect(taskCompleted).toBe(true)
  })

  describe('timeout enforcement', () => {
    it('should timeout tasks exceeding default timeout', async () => {
      // Engine with 50ms default timeout
      const timeoutEngine = new TaskEngine(logger, 2, 50)
      let taskTimedOut = false

      // Handler that runs forever (until aborted)
      timeoutEngine.registerHandler('slow', async (_payload, ctx: TaskContext) => {
        // Simulate long-running work
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 10000) // Would take 10s
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            taskTimedOut = true
            reject(new Error('Aborted'))
          })
        })
      })

      timeoutEngine.enqueue('slow', {})

      // Wait for timeout to trigger
      await vi.waitFor(() => expect(taskTimedOut).toBe(true), { timeout: 200 })
    })

    it('should respect per-task timeout override', async () => {
      // Engine with long default timeout
      const engine = new TaskEngine(logger, 2, 60000)
      let taskTimedOut = false

      engine.registerHandler('slow', async (_payload, ctx: TaskContext) => {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 10000)
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            taskTimedOut = true
            reject(new Error('Aborted'))
          })
        })
      })

      // Enqueue with short per-task timeout
      engine.enqueue('slow', {}, { priority: 0, timeoutMs: 50 })

      // Wait for timeout to trigger
      await vi.waitFor(() => expect(taskTimedOut).toBe(true), { timeout: 200 })
    })

    it('should provide TaskContext with AbortSignal to handlers', async () => {
      let receivedContext: TaskContext | null = null
      const completed = createDeferred()

      engine.registerHandler('test', (_payload, ctx: TaskContext) => {
        receivedContext = ctx
        completed.resolve()
        return Promise.resolve()
      })

      engine.enqueue('test', {})
      await completed.promise

      expect(receivedContext).not.toBeNull()
      expect(receivedContext!.signal).toBeInstanceOf(AbortSignal)
      expect(receivedContext!.logger).toBeDefined()
    })

    it('should cancel task via cancelTask method', async () => {
      // Engine with long timeout so we can test manual cancellation
      const engine = new TaskEngine(logger, 2, 60000)
      let wasCancelled = false
      const taskStarted = createDeferred()

      engine.registerHandler('cancellable', async (_payload, ctx: TaskContext) => {
        taskStarted.resolve()
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 10000)
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            wasCancelled = true
            reject(new Error('Cancelled'))
          })
        })
      })

      const taskId = engine.enqueue('cancellable', {})
      await taskStarted.promise

      // Cancel the task
      const cancelled = engine.cancelTask(taskId)
      expect(cancelled).toBe(true)

      // Wait for cancellation to be processed
      await vi.waitFor(() => expect(wasCancelled).toBe(true), { timeout: 200 })
    })

    it('should return false when cancelling non-existent task', () => {
      const result = engine.cancelTask('non-existent-task-id')
      expect(result).toBe(false)
    })
  })

  describe('TaskTimeoutError', () => {
    it('should have correct properties', () => {
      const error = new TaskTimeoutError('task-123', 'summary', 5000)
      expect(error.name).toBe('TaskTimeoutError')
      expect(error.taskId).toBe('task-123')
      expect(error.taskType).toBe('summary')
      expect(error.timeoutMs).toBe(5000)
      expect(error.message).toContain('task-123')
      expect(error.message).toContain('summary')
      expect(error.message).toContain('5000ms')
    })
  })
})
