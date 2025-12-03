/**
 * Metrics Persist Task Handler
 *
 * Periodic flush of TranscriptService metrics. Placeholder for Phase 5.3.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 * @see docs/ROADMAP.md Phase 5.2, 5.3
 */

import { Logger, MetricsPersistPayloadSchema } from '@sidekick/core'
import { TaskContext, TaskHandler } from '../task-engine.js'
import { TaskRegistry } from '../task-registry.js'

export interface MetricsPersistHandlerDeps {
  taskRegistry: TaskRegistry
  projectDir: string
  logger: Logger
}

export function createMetricsPersistHandler(deps: MetricsPersistHandlerDeps): TaskHandler {
  return async (payload, ctx: TaskContext) => {
    // Validate payload
    const result = MetricsPersistPayloadSchema.safeParse(payload)
    if (!result.success) {
      ctx.logger.error('Invalid payload', { errors: result.error.issues })
      throw new Error('Invalid task payload')
    }
    const p = result.data

    ctx.logger.info('Metrics persist task started', { sessionId: p.sessionId })

    // Track task start
    await deps.taskRegistry.markTaskStarted(ctx.taskId)

    if (ctx.signal.aborted) {
      ctx.logger.info('Metrics persist task cancelled')
      return
    }

    // Placeholder: actual metrics persistence will be integrated with TranscriptService in Phase 5.3
    // For now, just acknowledge the task
    ctx.logger.info('Metrics persist task completed (placeholder)', { sessionId: p.sessionId })
  }
}
