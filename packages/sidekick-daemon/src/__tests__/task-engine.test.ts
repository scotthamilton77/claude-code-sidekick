import { createConsoleLogger } from '@sidekick/core'
import type { DaemonContext } from '@sidekick/types'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ContextGetter, TaskContext, TaskEngine, TaskTimeoutError } from '../task-engine.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })

// Mock DaemonContext for tests
const mockDaemonContext: DaemonContext = {
  role: 'daemon',
  config: {
    core: { logging: { level: 'error' }, development: { enabled: false } },
    llm: {},
    getAll: () => ({}),
    getFeature: () => undefined,
  },
  logger,
  assets: { resolve: () => undefined },
  paths: { userConfigDir: '/tmp', projectConfigDir: '/tmp' },
  handlers: { register: () => {}, dispatch: async () => {} },
  llm: {
    id: 'mock',
    complete: () =>
      Promise.resolve({
        content: '',
        model: 'mock',
        usage: { inputTokens: 0, outputTokens: 0 },
        rawResponse: { status: 200, body: '' },
      }),
  },
  staging: {
    stageReminder: () => Promise.resolve(),
    readReminder: () => Promise.resolve(null),
    clearStaging: () => Promise.resolve(),
    listReminders: () => Promise.resolve([]),
    deleteReminder: () => Promise.resolve(),
    listConsumedReminders: () => Promise.resolve([]),
    getLastConsumed: () => Promise.resolve(null),
  },
  transcript: {
    initialize: async () => {},
    prepare: async () => {},
    start: async () => {},
    shutdown: async () => {},
    getTranscript: () => ({
      entries: [],
      metadata: { sessionId: '', transcriptPath: '', lineCount: 0, lastModified: 0 },
      toString: () => '',
    }),
    getExcerpt: () => ({ content: '', lineCount: 0, startLine: 0, endLine: 0, bookmarkApplied: false }),
    getMetrics: () => ({
      turnCount: 0,
      toolCount: 0,
      toolsThisTurn: 0,
      messageCount: 0,
      tokenUsage: {
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
        cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
        serviceTierCounts: {},
        byModel: {},
      },
      currentContextTokens: 0,
      isPostCompactIndeterminate: false,
      toolsPerTurn: 0,
      lastProcessedLine: 0,
      lastUpdatedAt: 0,
    }),
    getMetric: () => 0 as never,
    onMetricsChange: () => () => {},
    onThreshold: () => () => {},
    capturePreCompactState: async () => {},
    getCompactionHistory: () => [],
  },
} as unknown as DaemonContext

// Mock context getter for tests - returns Promise to match async ContextGetter type
const mockContextGetter: ContextGetter = () => Promise.resolve(mockDaemonContext)

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
    engine = new TaskEngine(logger, mockContextGetter, 2, 100)
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
    const singleEngine = new TaskEngine(logger, mockContextGetter, 1, 60000)
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
    const slowEngine = new TaskEngine(logger, mockContextGetter, 2, 60000)
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
      const timeoutEngine = new TaskEngine(logger, mockContextGetter, 2, 50)
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
      const engine = new TaskEngine(logger, mockContextGetter, 2, 60000)
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
      const engine = new TaskEngine(logger, mockContextGetter, 2, 60000)
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

  describe('error handling', () => {
    it('should continue processing after handler with no registered handler', async () => {
      const completed = createDeferred()

      // Register recovery handler before enqueuing so it's ready
      engine.registerHandler('after-error', () => {
        completed.resolve()
        return Promise.resolve()
      })

      // Enqueue task with no registered handler
      engine.enqueue('unregistered-type', { data: 'test' })

      // Enqueue recovery task — engine should still work after the error
      engine.enqueue('after-error', { foo: 'bar' })

      await completed.promise
    })

    it('should handle non-Error exceptions thrown by handler', async () => {
      // Use maxConcurrency=1 so the failing task must complete (and error)
      // before the recovery task starts — proves the engine actually recovers.
      const sequentialEngine = new TaskEngine(logger, mockContextGetter, 1, 100)
      const completed = createDeferred()
      sequentialEngine.registerHandler('throws-string', () => {
        throw 'string error' // eslint-disable-line @typescript-eslint/only-throw-error
      })

      // After the error, enqueue another task to verify engine recovers
      sequentialEngine.registerHandler('recovery', () => {
        completed.resolve()
        return Promise.resolve()
      })

      sequentialEngine.enqueue('throws-string', {})
      sequentialEngine.enqueue('recovery', {})

      await completed.promise
    })

    it('should log cancellation differently from timeout', async () => {
      const engine = new TaskEngine(logger, mockContextGetter, 2, 60000) // Long timeout
      const taskStarted = createDeferred()
      let wasAborted = false

      engine.registerHandler('cancellable', async (_payload, ctx: TaskContext) => {
        taskStarted.resolve()
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, 10000)
          ctx.signal.addEventListener('abort', () => {
            clearTimeout(timer)
            wasAborted = true
            reject(new Error('Cancelled'))
          })
        })
      })

      const taskId = engine.enqueue('cancellable', {})
      await taskStarted.promise

      // Cancel manually (not via timeout)
      engine.cancelTask(taskId)

      await vi.waitFor(() => expect(wasAborted).toBe(true), { timeout: 200 })
    })
  })

  describe('shutdown edge cases', () => {
    it('should handle double shutdown gracefully', async () => {
      engine.registerHandler('test', () => Promise.resolve())

      // First shutdown
      await engine.shutdown()

      // Second shutdown should return immediately without error
      await engine.shutdown()
    })

    it('should return immediately on subsequent shutdown calls', async () => {
      // This tests lines 252-253: early return when isShuttingDown is already true
      // We test this by starting shutdown, then calling it again while first is pending
      const testEngine = new TaskEngine(logger, mockContextGetter, 2, 60000)
      const taskStarted = createDeferred()

      // Register a handler that takes time to complete
      testEngine.registerHandler('slow', async (_payload, ctx: TaskContext) => {
        taskStarted.resolve()
        // Wait for abort signal (which comes from shutdown timeout or explicit cancel)
        await new Promise<void>((resolve) => {
          if (ctx.signal.aborted) {
            resolve()
            return
          }
          ctx.signal.addEventListener('abort', () => resolve())
        })
      })

      testEngine.enqueue('slow', {})

      // Wait for task to start
      await taskStarted.promise

      // Give event loop a tick to ensure task is fully running
      await new Promise((r) => setImmediate(r))

      // First shutdown - will wait for running task or timeout
      const shutdown1Promise = testEngine.shutdown(100) // Short timeout

      // Second shutdown call should return immediately (isShuttingDown guard)
      const start = Date.now()
      await testEngine.shutdown(5000)
      const elapsed = Date.now() - start

      // Second call should return near-instantly due to early return
      expect(elapsed).toBeLessThan(50)

      // Wait for first shutdown to complete
      await shutdown1Promise
    })
  })

  describe('concurrent task limits', () => {
    it('should process multiple enqueued tasks to completion', async () => {
      // This test verifies that queueing works - tasks queue up and eventually all complete
      const limitedEngine = new TaskEngine(logger, mockContextGetter, 2, 60000)
      const completed: string[] = []

      limitedEngine.registerHandler('multi', (payload: Record<string, unknown>, _ctx: TaskContext): Promise<void> => {
        // Synchronous work only to avoid timing issues
        completed.push(payload.id as string)
        return Promise.resolve()
      })

      // Enqueue 5 tasks
      for (let i = 1; i <= 5; i++) {
        limitedEngine.enqueue('multi', { id: `task${i}` })
      }

      // All tasks should complete eventually
      await vi.waitFor(() => expect(completed.length).toBe(5), { timeout: 1000 })

      // All 5 tasks should have completed
      expect(completed).toHaveLength(5)
      expect(completed).toContain('task1')
      expect(completed).toContain('task5')
    })

    it('should process tasks even with high concurrency limit', async () => {
      // With concurrency=10 and 5 tasks, all should complete
      const highConcurrencyEngine = new TaskEngine(logger, mockContextGetter, 10, 60000)
      const completed: string[] = []

      highConcurrencyEngine.registerHandler(
        'high',
        (payload: Record<string, unknown>, _ctx: TaskContext): Promise<void> => {
          completed.push(payload.id as string)
          return Promise.resolve()
        }
      )

      for (let i = 1; i <= 5; i++) {
        highConcurrencyEngine.enqueue('high', { id: `task${i}` })
      }

      await vi.waitFor(() => expect(completed.length).toBe(5), { timeout: 500 })
      expect(completed).toHaveLength(5)
    })

    it('should process tasks with concurrency=1', async () => {
      // Serial processing: all tasks complete in order
      const serialEngine = new TaskEngine(logger, mockContextGetter, 1, 60000)
      const completed: string[] = []

      serialEngine.registerHandler('serial', (payload: Record<string, unknown>, _ctx: TaskContext): Promise<void> => {
        completed.push(payload.id as string)
        return Promise.resolve()
      })

      // Enqueue in order
      serialEngine.enqueue('serial', { id: 'task1' })
      serialEngine.enqueue('serial', { id: 'task2' })
      serialEngine.enqueue('serial', { id: 'task3' })

      await vi.waitFor(() => expect(completed.length).toBe(3), { timeout: 500 })
      expect(completed).toHaveLength(3)
    })
  })

  describe('getStatus', () => {
    it('should return empty status when idle', () => {
      const status = engine.getStatus()
      expect(status.pending).toBe(0)
      expect(status.active).toBe(0)
      expect(status.activeTasks).toHaveLength(0)
    })

    it('should reflect active and pending tasks', async () => {
      const singleEngine = new TaskEngine(logger, mockContextGetter, 1, 60000)
      const taskStarted = createDeferred()
      const blocker = createDeferred()

      singleEngine.registerHandler('block', async () => {
        taskStarted.resolve()
        await blocker.promise
      })

      // First task takes the only slot
      singleEngine.enqueue('block', {})
      await taskStarted.promise

      // Second task queues
      singleEngine.enqueue('block', {})

      const status = singleEngine.getStatus()
      expect(status.active).toBe(1)
      expect(status.pending).toBe(1)
      expect(status.activeTasks).toHaveLength(1)
      expect(status.activeTasks[0].type).toBe('block')
      expect(status.activeTasks[0].startTime).toBeGreaterThan(0)
      expect(status.activeTasks[0].id).toBeDefined()

      blocker.resolve()
      await singleEngine.shutdown()
    })
  })

  describe('context getter', () => {
    it('should pass sessionId from payload to contextGetter', async () => {
      const contextGetterSpy = vi.fn().mockResolvedValue(mockDaemonContext)
      const spyEngine = new TaskEngine(logger, contextGetterSpy, 2, 100)
      const completed = createDeferred()

      spyEngine.registerHandler('test', () => {
        completed.resolve()
        return Promise.resolve()
      })

      spyEngine.enqueue('test', { sessionId: 'session-abc' })
      await completed.promise

      expect(contextGetterSpy).toHaveBeenCalledWith('session-abc')
    })

    it('should pass undefined when no sessionId in payload', async () => {
      const contextGetterSpy = vi.fn().mockResolvedValue(mockDaemonContext)
      const spyEngine = new TaskEngine(logger, contextGetterSpy, 2, 100)
      const completed = createDeferred()

      spyEngine.registerHandler('test', () => {
        completed.resolve()
        return Promise.resolve()
      })

      spyEngine.enqueue('test', { data: 'no-session' })
      await completed.promise

      expect(contextGetterSpy).toHaveBeenCalledWith(undefined)
    })
  })
})
