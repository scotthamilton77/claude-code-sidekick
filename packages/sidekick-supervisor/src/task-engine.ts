import { Logger } from '@sidekick/core'
import crypto from 'crypto'

export interface Task {
  id: string
  type: string
  payload: Record<string, unknown>
  priority?: number // Higher is better
  timestamp: number
}

export type TaskHandler = (payload: Record<string, unknown>, logger: Logger) => Promise<void>

/**
 * Simple priority task queue with bounded concurrency.
 *
 * Thread-safety: This class relies on Node.js's single-threaded event loop model.
 * All state mutations (queue operations, counter increments) occur in synchronous
 * code blocks. Async task handlers schedule microtasks that execute sequentially,
 * never concurrently. This class is NOT safe for Worker Threads with shared memory.
 */
export class TaskEngine {
  private queue: Task[] = []
  private handlers = new Map<string, TaskHandler>()
  private running = 0
  private readonly maxConcurrency: number
  private logger: Logger
  private isShuttingDown = false
  private shutdownResolve: (() => void) | null = null

  constructor(logger: Logger, maxConcurrency = 2) {
    this.logger = logger
    this.maxConcurrency = maxConcurrency
  }

  registerHandler(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler)
  }

  enqueue(type: string, payload: Record<string, unknown>, priority = 0): string {
    if (this.isShuttingDown) {
      throw new Error('TaskEngine is shutting down, cannot enqueue new tasks')
    }

    const id = crypto.randomUUID()
    const task: Task = {
      id,
      type,
      payload,
      priority,
      timestamp: Date.now(),
    }

    this.queue.push(task)
    // Sort by priority (desc) then timestamp (asc)
    this.queue.sort((a, b) => {
      const pA = a.priority ?? 0
      const pB = b.priority ?? 0
      if (pA !== pB) return pB - pA
      return a.timestamp - b.timestamp
    })

    this.logger.debug('Task enqueued', { type, id, priority })
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

    this.logger.info('Starting task', { type: task.type, id: task.id })
    const start = Date.now()

    try {
      await handler(task.payload, this.logger)
      this.logger.info('Task completed', {
        type: task.type,
        id: task.id,
        durationMs: Date.now() - start,
      })
    } catch (err) {
      this.logger.error('Task failed', {
        type: task.type,
        id: task.id,
        error: err,
        durationMs: Date.now() - start,
      })
    }
  }

  /**
   * Gracefully shutdown the task engine.
   * Prevents new enqueues, clears pending queue, waits for running tasks to complete.
   */
  async shutdown(): Promise<void> {
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

    // Wait for running tasks to complete
    return new Promise((resolve) => {
      this.shutdownResolve = resolve
    })
  }

  private checkShutdownComplete(): void {
    if (this.isShuttingDown && this.running === 0 && this.shutdownResolve) {
      this.logger.info('TaskEngine shutdown complete')
      this.shutdownResolve()
      this.shutdownResolve = null
    }
  }
}
