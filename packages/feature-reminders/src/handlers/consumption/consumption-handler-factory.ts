/**
 * Factory for creating consumption handlers with minimal boilerplate
 *
 * All consumption handlers follow the same pattern:
 * 1. CLI context guard
 * 2. Create staging reader
 * 3. Check suppression
 * 4. Get highest priority reminder
 * 5. Delete if not persistent
 * 6. Build HookResponse
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import type { RuntimeContext, HookResponse } from '@sidekick/core'
import type { CLIContext, HookName } from '@sidekick/types'
import { isCLIContext, isHookEvent } from '@sidekick/types'
import { CLIStagingReader } from '../../cli-staging-reader.js'

export interface ConsumptionHandlerConfig {
  /** Handler ID (e.g., 'reminders:inject-user-prompt-submit') */
  id: string
  /** Which hook to consume reminders from */
  hook: HookName
  /** Handler priority (default: 50) */
  priority?: number
  /** Whether this hook can block (PreToolUse, Stop) */
  supportsBlocking?: boolean
}

/**
 * Creates and registers a consumption handler for the specified hook
 */
export function createConsumptionHandler(context: RuntimeContext, config: ConsumptionHandlerConfig): void {
  if (!isCLIContext(context)) return

  const { id, hook, priority = 50, supportsBlocking = false } = config

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

      // Check suppression first
      if (reader.checkAndClearSuppression(hook)) {
        cliCtx.logger.debug('Hook suppressed, skipping reminder injection')
        return { response: {} }
      }

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

      // Build response
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

      cliCtx.logger.info('Injected reminder', {
        hook,
        reminder: reminder.name,
        ...(supportsBlocking && { blocking: reminder.blocking }),
      })

      return { response }
    },
  })
}
