/**
 * Cleanup Task Handler
 *
 * Prunes old session data based on configured max age.
 *
 * @see docs/design/SUPERVISOR.md §4.3
 * @see docs/ROADMAP.md Phase 5.2
 */

import { CleanupPayloadSchema, Logger } from '@sidekick/core'
import fs from 'fs/promises'
import path from 'path'
import { TaskContext, TaskHandler } from '../task-engine.js'
import { TaskRegistry } from '../task-registry.js'

/** Default max age for session cleanup: 7 days */
const DEFAULT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

export interface CleanupHandlerDeps {
  taskRegistry: TaskRegistry
  projectDir: string
  logger: Logger
}

export function createCleanupHandler(deps: CleanupHandlerDeps): TaskHandler {
  return async (payload, ctx: TaskContext) => {
    // Validate payload
    const result = CleanupPayloadSchema.safeParse(payload)
    if (!result.success) {
      ctx.logger.error('Invalid payload', { errors: result.error.issues })
      throw new Error('Invalid task payload')
    }
    const p = result.data

    const maxAgeMs = p.maxAgeMs ?? DEFAULT_MAX_AGE_MS
    const dryRun = p.dryRun ?? false

    ctx.logger.info('Cleanup task started', { maxAgeMs, dryRun })

    // Track task start
    await deps.taskRegistry.markTaskStarted(ctx.taskId)

    if (ctx.signal.aborted) {
      ctx.logger.info('Cleanup task cancelled')
      return
    }

    const sessionsDir = path.join(deps.projectDir, '.sidekick', 'sessions')
    const now = Date.now()
    let cleaned = 0
    let skipped = 0

    try {
      const entries = await fs.readdir(sessionsDir, { withFileTypes: true })

      for (const entry of entries) {
        if (ctx.signal.aborted) {
          ctx.logger.info('Cleanup task cancelled mid-execution')
          break
        }

        if (!entry.isDirectory()) continue

        const sessionPath = path.join(sessionsDir, entry.name)
        try {
          const stats = await fs.stat(sessionPath)
          const age = now - stats.mtimeMs

          if (age > maxAgeMs) {
            if (dryRun) {
              ctx.logger.debug('Would clean session (dry-run)', {
                session: entry.name,
                ageMs: age,
              })
            } else {
              await fs.rm(sessionPath, { recursive: true, force: true })
              ctx.logger.debug('Cleaned session', { session: entry.name, ageMs: age })
            }
            cleaned++
          } else {
            skipped++
          }
        } catch (statErr) {
          ctx.logger.warn('Failed to stat session directory', {
            session: entry.name,
            error: statErr instanceof Error ? statErr.message : String(statErr),
          })
        }
      }

      // Only update lastCleanup if cleanup completed fully (not cancelled mid-execution)
      if (ctx.signal.aborted) {
        ctx.logger.info('Cleanup task cancelled mid-execution, not updating lastCleanup')
        return
      }

      // Update last cleanup timestamp
      await deps.taskRegistry.updateLastCleanup()

      ctx.logger.info('Cleanup task completed', { cleaned, skipped, dryRun })
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Sessions directory doesn't exist yet - nothing to clean
        ctx.logger.debug('Sessions directory does not exist, nothing to clean')
        return
      }
      ctx.logger.error('Cleanup task failed', {
        error: err instanceof Error ? err.message : String(err),
      })
      throw err
    }
  }
}
