/**
 * Event factory functions for session-summary feature.
 *
 * Creates properly-typed logging events for session summary operations.
 * These events are logged for observability but don't trigger handlers.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.4-3.5
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
 */

import type { SummaryUpdatedEvent, SummarySkippedEvent, EventLogContext } from '@sidekick/types'

// Re-export for consumers
export type { EventLogContext } from '@sidekick/types'

/**
 * Factory functions for creating session-summary-related logging events.
 */
/* v8 ignore start -- pure data factories with deterministic structure */
export const SessionSummaryEvents = {
  /**
   * Create a SummaryUpdated event (logged when session summary is recalculated).
   * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
   */
  summaryUpdated(
    context: EventLogContext,
    state: {
      session_title: string
      session_title_confidence: number
      latest_intent: string
      latest_intent_confidence: number
    },
    metadata: {
      countdown_reset_to: number
      tokens_used?: number
      processing_time_ms?: number
      pivot_detected: boolean
      old_title?: string
      old_intent?: string
    },
    reason: 'user_prompt_forced' | 'countdown_reached' | 'compaction_reset'
  ): SummaryUpdatedEvent {
    return {
      type: 'SummaryUpdated',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        state,
        metadata,
        reason,
      },
    }
  },

  /**
   * Create a SummarySkipped event (logged when summary update is deferred).
   * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
   */
  summarySkipped(
    context: EventLogContext,
    metadata: {
      countdown: number
      countdown_threshold: number
    }
  ): SummarySkippedEvent {
    return {
      type: 'SummarySkipped',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        metadata,
        reason: 'countdown_active',
      },
    }
  },
}
/* v8 ignore stop */
