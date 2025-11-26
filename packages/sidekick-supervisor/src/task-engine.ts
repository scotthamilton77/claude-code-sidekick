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

export class TaskEngine {
  private queue: Task[] = []
  private handlers = new Map<string, TaskHandler>()
  private running = 0
  private readonly maxConcurrency: number
  private logger: Logger
  private isProcessing = false

  constructor(logger: Logger, maxConcurrency = 2) {
    this.logger = logger
    this.maxConcurrency = maxConcurrency
  }

  registerHandler(type: string, handler: TaskHandler): void {
    this.handlers.set(type, handler)
  }

  enqueue(type: string, payload: Record<string, unknown>, priority = 0): string {
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
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      while (this.running < this.maxConcurrency && this.queue.length > 0) {
        const task = this.queue.shift()
        if (!task) break

        this.running++
        void this.runTask(task).finally(() => {
          this.running--
          void this.process()
        })
      }
    } finally {
      this.isProcessing = false
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

  shutdown(): void {
    if (this.running > 0) {
      this.logger.warn('Shutting down with running tasks', { count: this.running })
    }
  }
}
