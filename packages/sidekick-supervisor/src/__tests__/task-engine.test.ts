import { createConsoleLogger } from '@sidekick/core'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { TaskEngine } from '../task-engine.js'

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
    engine = new TaskEngine(logger, 2)
  })

  it('should execute tasks', async () => {
    const handler = vi.fn().mockResolvedValue(undefined)
    engine.registerHandler('test', handler)

    return new Promise<void>((resolve) => {
      engine.registerHandler('test', async (payload) => {
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
    const singleEngine = new TaskEngine(logger, 1)
    const executionOrder: string[] = []

    // Use a blocking handler that waits until we release it
    // This allows us to enqueue all tasks before any start processing
    const blocker = createDeferred()

    // First task blocks, allowing queue to fill before other tasks process
    let firstTaskStarted = false
    singleEngine.registerHandler('block', async () => {
      firstTaskStarted = true
      await blocker.promise
    })

    singleEngine.registerHandler('test', (payload: Record<string, unknown>): Promise<void> => {
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
    const taskDeferred = createDeferred()
    let taskCompleted = false

    engine.registerHandler('slow', async () => {
      await taskDeferred.promise
      taskCompleted = true
    })

    engine.enqueue('slow', {})

    // Start shutdown (should wait for task)
    const shutdownPromise = engine.shutdown()

    // Task should still be running
    expect(taskCompleted).toBe(false)

    // Complete the task
    taskDeferred.resolve()

    // Now shutdown should complete
    await shutdownPromise
    expect(taskCompleted).toBe(true)
  })
})
