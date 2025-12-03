/**
 * Resume Generation Task Handler
 *
 * Generates resume message for session continuation. Placeholder for Phase 6.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 * @see docs/ROADMAP.md Phase 5.2, 6.2
 */

import { Logger, ResumeGenerationPayloadSchema } from '@sidekick/core'
import fs from 'fs/promises'
import path from 'path'
import { TaskContext, TaskHandler } from '../task-engine.js'
import { TaskRegistry, validateSessionId } from '../task-registry.js'

export interface ResumeGenerationHandlerDeps {
  taskRegistry: TaskRegistry
  projectDir: string
  logger: Logger
}

export function createResumeGenerationHandler(deps: ResumeGenerationHandlerDeps): TaskHandler {
  return async (payload, ctx: TaskContext) => {
    // Validate payload
    const result = ResumeGenerationPayloadSchema.safeParse(payload)
    if (!result.success) {
      ctx.logger.error('Invalid payload', { errors: result.error.issues })
      throw new Error('Invalid task payload')
    }
    const p = result.data

    ctx.logger.info('Resume generation task started', { sessionId: p.sessionId })

    // Validate session ID before path construction
    validateSessionId(p.sessionId)

    // Track task start
    await deps.taskRegistry.markTaskStarted(ctx.taskId)

    if (ctx.signal.aborted) {
      ctx.logger.info('Resume generation task cancelled')
      return
    }

    // Placeholder: actual resume generation will be implemented in Phase 6
    const resumePath = path.join(deps.projectDir, '.sidekick', 'sessions', p.sessionId, 'state', 'resume-message.json')

    try {
      await fs.mkdir(path.dirname(resumePath), { recursive: true })
      await fs.writeFile(
        resumePath,
        JSON.stringify(
          {
            sessionId: p.sessionId,
            generatedAt: Date.now(),
            message: 'Resume message placeholder - full implementation in Phase 6',
          },
          null,
          2
        ),
        'utf-8'
      )
      ctx.logger.info('Resume generation task completed', { sessionId: p.sessionId })
    } catch (err) {
      ctx.logger.error('Failed to write resume message', {
        sessionId: p.sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
