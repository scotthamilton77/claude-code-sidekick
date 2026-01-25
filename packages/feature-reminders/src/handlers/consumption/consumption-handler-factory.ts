/**
 * Factory for creating consumption handlers with minimal boilerplate
 *
 * All consumption handlers follow the same pattern:
 * 1. CLI context guard
 * 2. Create staging reader
 * 3. Get highest priority reminder
 * 4. Rename if not persistent (preserves consumption history)
 * 5. Build HookResponse (via strategy or default)
 *
 * Supports optional response building strategy for custom logic (e.g., smart completion detection).
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import type { RuntimeContext, HookResponse } from '@sidekick/core'
import { logEvent } from '@sidekick/core'
import { ReminderEvents } from '../../events.js'
import type { CLIContext, HookName, StagedReminder, HookEvent } from '@sidekick/types'
import { isCLIContext, isHookEvent } from '@sidekick/types'
import { CLIStagingReader } from '../../cli-staging-reader.js'

/** Parameters passed to the onConsume callback */
export interface OnConsumeParams {
  /** The reminder being consumed */
  reminder: StagedReminder
  /** Staging reader for additional operations */
  reader: CLIStagingReader
  /** CLI context for IPC, logging, etc. */
  cliCtx: CLIContext
  /** Current session ID */
  sessionId: string
}

/** Parameters passed to the buildResponse callback */
export interface ResponseBuilderParams extends OnConsumeParams {
  /** The hook event being processed */
  event: HookEvent
  /** Whether this hook supports blocking */
  supportsBlocking: boolean
}

/** Response builder strategy function */
export type ResponseBuilder = (params: ResponseBuilderParams) => Promise<HookResponse>

/**
 * Build the default response from a reminder's properties.
 * Exported for use by custom response builders that want to delegate to default behavior.
 */
export function buildDefaultResponse(reminder: StagedReminder, supportsBlocking: boolean): HookResponse {
  const response: HookResponse = {}

  if (supportsBlocking && reminder.blocking) {
    response.blocking = true
    response.reason = reminder.reason
  }
  if (reminder.additionalContext) {
    response.additionalContext = reminder.additionalContext
  }
  if (reminder.userMessage) {
    response.userMessage = reminder.userMessage
  }

  return response
}

export interface ConsumptionHandlerConfig {
  /** Handler ID (e.g., 'reminders:inject-user-prompt-submit') */
  id: string
  /** Which hook to consume reminders from */
  hook: HookName
  /** Handler priority (default: 50) */
  priority?: number
  /** Whether this hook can block (PreToolUse, Stop) */
  supportsBlocking?: boolean
  /**
   * Optional custom response builder strategy.
   * When provided, this function builds the response instead of the default logic.
   * Use buildDefaultResponse() to delegate to default behavior when needed.
   */
  buildResponse?: ResponseBuilder
  /** Optional callback invoked after response is built, for side effects */
  onConsume?: (params: OnConsumeParams) => Promise<void>
}

/**
 * Creates and registers a consumption handler for the specified hook
 */
export function createConsumptionHandler(context: RuntimeContext, config: ConsumptionHandlerConfig): void {
  if (!isCLIContext(context)) return

  const { id, hook, priority = 50, supportsBlocking = false, buildResponse, onConsume } = config

  context.handlers.register({
    id,
    priority,
    filter: { kind: 'hook', hooks: [hook] },
    handler: async (event, ctx) => {
      if (!isHookEvent(event)) return Promise.resolve()
      if (!isCLIContext(ctx as unknown as RuntimeContext)) return Promise.resolve()

      const cliCtx = ctx as unknown as CLIContext
      const sessionId = event.context.sessionId

      const reader = new CLIStagingReader({
        paths: cliCtx.paths,
        sessionId,
      })

      // Get highest priority reminder
      const reminders = reader.listReminders(hook)
      if (reminders.length === 0) {
        return { response: {} }
      }

      const reminder = reminders[0]

      // Rename if not persistent (preserves consumption history for reactivation)
      if (!reminder.persistent) {
        reader.renameReminder(hook, reminder.name)
      }

      // Build response using strategy or default
      const response = buildResponse
        ? await buildResponse({ reminder, reader, cliCtx, sessionId, event, supportsBlocking })
        : buildDefaultResponse(reminder, supportsBlocking)

      // Call optional onConsume callback for side effects
      if (onConsume) {
        await onConsume({ reminder, reader, cliCtx, sessionId })
      }

      // Log ReminderConsumed event
      logEvent(
        cliCtx.logger,
        ReminderEvents.reminderConsumed(
          {
            sessionId,
            hook,
          },
          {
            reminderName: reminder.name,
            reminderReturned: true,
            blocking: response.blocking ?? false,
            priority: reminder.priority,
            persistent: reminder.persistent,
          }
        )
      )

      return { response }
    },
  })
}
