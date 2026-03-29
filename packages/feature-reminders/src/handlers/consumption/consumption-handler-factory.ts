/**
 * Factory for creating consumption handlers with minimal boilerplate
 *
 * All consumption handlers follow the same pattern:
 * 1. CLI context guard
 * 2. Create staging reader
 * 3. Get all reminders sorted by priority (highest first)
 * 4. Rename all non-persistent reminders (preserves consumption history)
 * 5. Build HookResponse from primary (highest priority) reminder
 * 6. Append additionalContext from secondary reminders
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

/** Enrichment metadata that can be attached to the reminder:consumed event */
export interface ConsumedEventEnrichment {
  classificationResult?: {
    category: string
    confidence: number
    shouldBlock: boolean
  }
}

/** Result from a response builder, optionally including event enrichment metadata */
export interface ResponseBuilderResult {
  response: HookResponse
  enrichment?: ConsumedEventEnrichment
}

/** Response builder strategy function */
export type ResponseBuilder = (params: ResponseBuilderParams) => Promise<HookResponse | ResponseBuilderResult>

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

      // Get all reminders sorted by priority (highest first)
      const reminders = reader.listReminders(hook)
      if (reminders.length === 0) {
        return { response: {} }
      }

      // Primary reminder (highest priority) determines blocking and userMessage
      const primary = reminders[0]

      // Rename all non-persistent reminders (preserves consumption history for reactivation)
      for (const reminder of reminders) {
        if (!reminder.persistent) {
          reader.renameReminder(hook, reminder.name)
        }
      }

      // Build response using strategy or default (primary reminder for backward compat)
      let enrichment: ConsumedEventEnrichment | undefined
      let response: HookResponse
      if (buildResponse) {
        const result = await buildResponse({ reminder: primary, reader, cliCtx, sessionId, event, supportsBlocking })
        if ('response' in result && typeof result.response === 'object') {
          // ResponseBuilderResult with enrichment
          response = result.response
          enrichment = result.enrichment
        } else {
          // Plain HookResponse (backward compatible)
          response = result as HookResponse
        }
      } else {
        response = buildDefaultResponse(primary, supportsBlocking)
      }

      // Append additionalContext from secondary reminders (primary is already in response)
      const secondaryContexts = reminders
        .slice(1)
        .map((r) => r.additionalContext)
        .filter((ctx): ctx is string => !!ctx)
      if (secondaryContexts.length > 0) {
        const existing = response.additionalContext
        const combined = existing ? [existing, ...secondaryContexts] : secondaryContexts
        response = { ...response, additionalContext: combined.join('\n\n') }
      }

      // Call optional onConsume callback with primary reminder
      if (onConsume) {
        await onConsume({ reminder: primary, reader, cliCtx, sessionId })
      }

      // Build rendered text from the response fields that were injected
      const renderedParts: string[] = []
      if (response.userMessage) renderedParts.push(response.userMessage)
      if (response.additionalContext) renderedParts.push(response.additionalContext)
      const renderedText = renderedParts.length > 0 ? renderedParts.join('\n\n') : undefined

      // Log ReminderConsumed event
      logEvent(
        cliCtx.logger,
        ReminderEvents.reminderConsumed(
          {
            sessionId,
            hook,
          },
          {
            reminderName: primary.name,
            reminderReturned: true,
            blocking: response.blocking ?? false,
            priority: primary.priority,
            persistent: primary.persistent,
            renderedText,
            ...enrichment,
          }
        )
      )

      return { response }
    },
  })
}
