/**
 * Utilities for staging handlers to reduce boilerplate
 *
 * Staging handlers have varied condition logic, so we can't fully template them.
 * But we can extract common patterns:
 * - Context guard and type narrowing
 * - Idempotency check + resolve + stage
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Staging Handlers
 */

import type { RuntimeContext } from '@sidekick/core'
import type {
  SupervisorContext,
  HookName,
  EventHandler,
  SidekickEvent,
  HandlerContext,
  HandlerFilter,
  StagingMetrics,
} from '@sidekick/types'
import { isSupervisorContext, isTranscriptEvent } from '@sidekick/types'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import type { TemplateContext } from '../../types.js'

export interface StagingAction {
  /** Reminder ID to stage */
  reminderId: string
  /** Target hook for the reminder */
  targetHook: HookName
  /** Template context for interpolation */
  templateContext?: TemplateContext
  /** Skip if reminder already exists for this hook (default: true) */
  skipIfExists?: boolean
}

export interface StagingHandlerConfig {
  /** Handler ID */
  id: string
  /** Handler priority */
  priority: number
  /** Event filter - use proper HandlerFilter type */
  filter: HandlerFilter
  /** Handler logic - receives narrowed SupervisorContext */
  execute: (
    event: SidekickEvent,
    ctx: SupervisorContext
  ) => Promise<StagingAction | undefined> | StagingAction | undefined
}

/**
 * Creates and registers a staging handler with automatic context guards
 */
export function createStagingHandler(context: RuntimeContext, config: StagingHandlerConfig): void {
  if (!isSupervisorContext(context)) return

  const { id, priority, filter, execute } = config

  const handler: EventHandler = async (event: SidekickEvent, ctx: HandlerContext) => {
    if (!isSupervisorContext(ctx as unknown as RuntimeContext)) return

    // Skip staging during bulk transcript reconstruction - staging is a live operation
    // that shouldn't be triggered by historical event replay. Handlers for
    // BulkProcessingComplete can stage reminders needed after reconstruction.
    if (isTranscriptEvent(event) && event.metadata.isBulkProcessing) return

    const supervisorCtx = ctx as unknown as SupervisorContext
    const action = await execute(event, supervisorCtx)

    if (!action) return

    // Idempotency check (default: skip if exists)
    if (action.skipIfExists !== false) {
      const existing = await supervisorCtx.staging.listReminders(action.targetHook)
      if (existing.some((r) => r.name === action.reminderId)) return
    }

    // Resolve reminder using context's asset resolver
    const reminder = resolveReminder(action.reminderId, {
      context: action.templateContext ?? {},
      assets: supervisorCtx.assets,
    })
    if (!reminder) {
      supervisorCtx.logger.warn('Failed to resolve reminder', { reminderId: action.reminderId })
      return
    }

    // Add stagedAt metrics for reactivation decisions (only for transcript events with metrics)
    let stagedAt: StagingMetrics | undefined
    if (isTranscriptEvent(event)) {
      const metrics = event.metadata.metrics
      stagedAt = {
        timestamp: Date.now(),
        turnCount: metrics.turnCount,
        toolsThisTurn: metrics.toolsThisTurn,
        toolCount: metrics.toolCount,
      }
    }

    // Stage reminder with stagedAt metrics
    await stageReminder(supervisorCtx, action.targetHook, { ...reminder, stagedAt })
  }

  context.handlers.register({ id, priority, filter, handler })
}
