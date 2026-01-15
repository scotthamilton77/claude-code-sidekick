import { Logger } from '@sidekick/core'
import type { DaemonContext, TaskContext } from '@sidekick/types'
import crypto from 'crypto'

/**
 * Default task timeout: 5 minutes per design/DAEMON.md §5.
 * Tasks can override this via their timeoutMs property.
 */
const DEFAULT_TASK_TIMEOUT_MS = 5 * 60 * 1000

export interface Task {
  id: string
  type: string
  payload: Record<string, unknown>
  priority?: number // Higher is better
  timestamp: number
  timeoutMs?: number // Per-task timeout override
}

/**
 * Function to get DaemonContext for a session.
 * If sessionId is provided, returns session-specific context (instrumented provider).
 * If sessionId is undefined, returns base context (shared provider).
 */
export type ContextGetter = (sessionId?: string) => DaemonContext | Promise<DaemonContext>

/**
 * Task handler function signature.
 * Receives payload and full TaskContext (extends DaemonContext with task fields).
 */
export type TaskHandler = (payload: Record<string, unknown>, context: TaskContext) => Promise<void>

// Re-export TaskContext type for convenience
export type { TaskContext } from '@sidekick/types'

/**
 * Custom error class for task timeout.
 */
export class TaskTimeoutError extends Error {
  constructor(
    public taskId: string,
    public taskType: string,
    public timeoutMs: number
  ) {
    super(`Task ${taskType}:${taskId} timed out after ${timeoutMs}ms`)
    this.name = 'TaskTimeoutError'
  }
}

/**
 * Options for task enqueueing.
 */
export interface EnqueueOptions {
  priority?: number
  timeoutMs?: number
}

/**
 * Simple priority task queue with bounded concurrency and timeout enforcement.
 *
 * Thread-safety: This class relies on Node.js's single-threaded event loop model.
 * All state mutations (queue operations, counter increments) occur in synchronous
 * code blocks. Async task handlers schedule microtasks that execute sequentially,
 * never concurrently. This class is NOT safe for Worker Threads with shared memory.
 *
 * @see docs/design/DAEMON.md §4.2, §5
 */
export class TaskEngine {
  private queue: Task[] = []
  private handlers = new Map<string, TaskHandler>()
  private running = 0
  private readonly maxConcurrency: number
  private readonly defaultTimeoutMs: number
  private logger: Logger
  private contextGetter: ContextGetter
  private isShuttingDown = false
  private shutdownResolve: (() => void) | null = null
  private activeAbortControllers = new Map<string, AbortController>()
  private activeTaskMeta = new Map<string, { type: string; startTime: number }>()

  constructor(
    logger: Logger,
    contextGetter: ContextGetter,
    maxConcurrency = 2,
    defaultTimeoutMs = DEFAULT_TASK_TIMEOUT_MS
  ) {
    this.logger = logger
    this.contextGetter = contextGetter
    this.maxConcurrency = maxConcurrency
    this.defaultTimeoutMs = defaultTimeoutMs
  }

  registerHandler(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler)
  }

  /**
   * Enqueue a task for execution.
   * @param type - The task type (must have a registered handler)
   * @param payload - Task payload data
   * @param priorityOrOptions - Priority number OR options object
   */
  enqueue(type: string, payload: Record<string, unknown>, priorityOrOptions: number | EnqueueOptions = 0): string {
    if (this.isShuttingDown) {
      throw new Error('TaskEngine is shutting down, cannot enqueue new tasks')
    }

    // Support both legacy (priority number) and new (options object) signatures
    const options: EnqueueOptions =
      typeof priorityOrOptions === 'number' ? { priority: priorityOrOptions } : priorityOrOptions

    const id = crypto.randomUUID()
    const task: Task = {
      id,
      type,
      payload,
      priority: options.priority ?? 0,
      timestamp: Date.now(),
      timeoutMs: options.timeoutMs,
    }

    this.queue.push(task)
    // Sort by priority (desc) then timestamp (asc)
    this.queue.sort((a, b) => {
      const pA = a.priority ?? 0
      const pB = b.priority ?? 0
      if (pA !== pB) return pB - pA
      return a.timestamp - b.timestamp
    })

    this.logger.debug('Task enqueued', { type, id, priority: task.priority, timeoutMs: task.timeoutMs })
    void this.process()
    return id
  }

  private process(): void {
    while (this.running < this.maxConcurrency && this.queue.length > 0) {
      const task = this.queue.shift()
      if (!task) break

      this.running++
      void this.runTask(task).finally(() => {
        this.running--
        this.checkShutdownComplete()
        if (!this.isShuttingDown) {
          void this.process()
        }
      })
    }
  }

  private async runTask(task: Task): Promise<void> {
    const handler = this.handlers.get(task.type)
    if (!handler) {
      this.logger.error('No handler for task type', { type: task.type, id: task.id })
      return
    }

    const timeoutMs = task.timeoutMs ?? this.defaultTimeoutMs
    const abortController = new AbortController()
    this.activeAbortControllers.set(task.id, abortController)
    this.activeTaskMeta.set(task.id, { type: task.type, startTime: Date.now() })

    this.logger.info('Starting task', { type: task.type, id: task.id, timeoutMs })
    const start = Date.now()

    // Extract sessionId from payload if present (most tasks have it)
    const sessionId = typeof task.payload.sessionId === 'string' ? task.payload.sessionId : undefined

    // Get DaemonContext for this session (or base context if no sessionId)
    const daemonContext = await this.contextGetter(sessionId)

    // Build full TaskContext by extending DaemonContext with task-specific fields
    const context: TaskContext = {
      ...daemonContext,
      taskId: task.id,
      signal: abortController.signal,
    }

    try {
      await this.runWithTimeout(handler, task, context, timeoutMs, abortController)
      this.logger.info('Task completed', {
        type: task.type,
        id: task.id,
        durationMs: Date.now() - start,
      })
    } catch (err) {
      const durationMs = Date.now() - start

      if (err instanceof TaskTimeoutError) {
        this.logger.error('Task timed out', {
          type: task.type,
          id: task.id,
          timeoutMs,
          durationMs,
        })
      } else if (abortController.signal.aborted) {
        this.logger.warn('Task was cancelled', {
          type: task.type,
          id: task.id,
          durationMs,
        })
      } else {
        this.logger.error('Task failed', {
          type: task.type,
          id: task.id,
          error: err instanceof Error ? err.message : String(err),
          stack: err instanceof Error ? err.stack : undefined,
          durationMs,
        })
      }
    } finally {
      this.activeAbortControllers.delete(task.id)
      this.activeTaskMeta.delete(task.id)
    }
  }

  /**
   * Run task handler with timeout enforcement.
   * Per design/DAEMON.md §5: Tasks have a strict timeout, defaulting to 5 minutes.
   */
  private async runWithTimeout(
    handler: TaskHandler,
    task: Task,
    context: TaskContext,
    timeoutMs: number,
    abortController: AbortController
  ): Promise<void> {
    // Store timer reference outside the Promise for cleanup
    let timer: ReturnType<typeof setTimeout> | undefined

    // Create timeout promise that rejects and aborts the task
    const timeoutPromise = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        abortController.abort()
        reject(new TaskTimeoutError(task.id, task.type, timeoutMs))
      }, timeoutMs)
    })

    try {
      await Promise.race([handler(task.payload, context), timeoutPromise])
    } finally {
      // Clear the timeout to prevent memory leaks
      if (timer) clearTimeout(timer)
    }
  }

  /**
   * Cancel a running task by ID.
   * Signals abort to the task handler - handler must check signal.aborted.
   */
  cancelTask(taskId: string): boolean {
    const controller = this.activeAbortControllers.get(taskId)
    if (controller) {
      controller.abort()
      this.logger.info('Task cancellation requested', { taskId })
      return true
    }
    return false
  }

  /**
   * Gracefully shutdown the task engine.
   * Prevents new enqueues, clears pending queue, waits for running tasks to complete.
   * Per design/DAEMON.md §2.2: max 30s timeout for running tasks.
   */
  async shutdown(timeoutMs = 30000): Promise<void> {
    if (this.isShuttingDown) {
      return // Already shutting down
    }

    this.isShuttingDown = true
    const pendingCount = this.queue.length
    this.queue = [] // Clear pending tasks

    this.logger.info('TaskEngine shutting down', {
      pendingDropped: pendingCount,
      runningTasks: this.running,
    })

    if (this.running === 0) {
      return
    }

    // Wait for running tasks to complete with timeout
    const waitForTasks = new Promise<void>((resolve) => {
      this.shutdownResolve = resolve
    })

    const timeout = new Promise<void>((resolve) => {
      setTimeout(() => {
        if (this.running > 0) {
          this.logger.warn('Shutdown timeout reached, tasks still running', {
            runningTasks: this.running,
          })
        }
        resolve()
      }, timeoutMs)
    })

    await Promise.race([waitForTasks, timeout])
  }

  private checkShutdownComplete(): void {
    if (this.isShuttingDown && this.running === 0 && this.shutdownResolve) {
      this.logger.info('TaskEngine shutdown complete')
      this.shutdownResolve()
      this.shutdownResolve = null
    }
  }

  /**
   * Get current task engine status for heartbeat/monitoring.
   * Per design/DAEMON.md §4.6: Expose queue depth and active task info.
   */
  getStatus(): TaskEngineStatus {
    const activeTasks: TaskEngineStatus['activeTasks'] = []
    for (const [id, meta] of this.activeTaskMeta) {
      activeTasks.push({
        id,
        type: meta.type,
        startTime: meta.startTime,
      })
    }
    return {
      pending: this.queue.length,
      active: this.running,
      activeTasks,
    }
  }
}

/**
 * Task engine status for heartbeat monitoring.
 */
export interface TaskEngineStatus {
  pending: number
  active: number
  activeTasks: Array<{
    id: string
    type: string
    startTime: number
  }>
}
