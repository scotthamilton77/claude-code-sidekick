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
} from '@sidekick/types'
import { isSupervisorContext } from '@sidekick/types'
import { resolveReminder, stageReminder, suppressHook } from '../../reminder-utils.js'
import type { TemplateContext } from '../../types.js'

export interface StagingAction {
  /** Reminder ID to stage */
  reminderId: string
  /** Target hook for the reminder */
  targetHook: HookName
  /** Template context for interpolation */
  templateContext?: TemplateContext
  /** Hooks to suppress after staging */
  suppressHooks?: HookName[]
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

    const supervisorCtx = ctx as unknown as SupervisorContext
    const action = await execute(event, supervisorCtx)

    if (!action) return

    // Idempotency check (default: skip if exists)
    if (action.skipIfExists !== false) {
      const existing = await supervisorCtx.staging.listReminders(action.targetHook)
      if (existing.some((r) => r.name === action.reminderId)) return
    }

    // Resolve reminder
    const reminder = resolveReminder(action.reminderId, action.templateContext ?? {})
    if (!reminder) {
      supervisorCtx.logger.warn('Failed to resolve reminder', { reminderId: action.reminderId })
      return
    }

    // Stage reminder
    await stageReminder(supervisorCtx, action.targetHook, reminder)

    // Suppress hooks if requested
    if (action.suppressHooks) {
      for (const hook of action.suppressHooks) {
        await suppressHook(supervisorCtx, hook)
      }
    }
  }

  context.handlers.register({ id, priority, filter, handler })
}
