/**
 * Session Summary Task Handler
 *
 * Generates/updates session summary. Placeholder for Phase 6.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 * @see docs/ROADMAP.md Phase 5.2, 6.2
 */

import { Logger, SessionSummaryPayloadSchema } from '@sidekick/core'
import fs from 'fs/promises'
import path from 'path'
import { TaskContext, TaskHandler } from '../task-engine.js'
import { TaskRegistry, validateSessionId } from '../task-registry.js'

export interface SessionSummaryHandlerDeps {
  taskRegistry: TaskRegistry
  projectDir: string
  logger: Logger
}

export function createSessionSummaryHandler(deps: SessionSummaryHandlerDeps): TaskHandler {
  return async (payload, ctx: TaskContext) => {
    // Validate payload
    const result = SessionSummaryPayloadSchema.safeParse(payload)
    if (!result.success) {
      ctx.logger.error('Invalid payload', { errors: result.error.issues })
      throw new Error('Invalid task payload')
    }
    const p = result.data

    ctx.logger.info('Session summary task started', {
      sessionId: p.sessionId,
      reason: p.reason,
    })

    // Validate session ID before path construction
    validateSessionId(p.sessionId)

    // Track task start
    await deps.taskRegistry.markTaskStarted(ctx.taskId)

    if (ctx.signal.aborted) {
      ctx.logger.info('Session summary task cancelled')
      return
    }

    // Placeholder: actual summary generation will be implemented in Phase 6
    // For now, just log and create a minimal summary file
    const summaryPath = path.join(
      deps.projectDir,
      '.sidekick',
      'sessions',
      p.sessionId,
      'state',
      'session-summary.json'
    )

    try {
      await fs.mkdir(path.dirname(summaryPath), { recursive: true })
      await fs.writeFile(
        summaryPath,
        JSON.stringify(
          {
            sessionId: p.sessionId,
            generatedAt: Date.now(),
            reason: p.reason,
            summary: 'Session summary placeholder - full implementation in Phase 6',
          },
          null,
          2
        ),
        'utf-8'
      )
      ctx.logger.info('Session summary task completed', { sessionId: p.sessionId })
    } catch (err) {
      ctx.logger.error('Failed to write session summary', {
        sessionId: p.sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
