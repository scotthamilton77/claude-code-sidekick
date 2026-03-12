/**
 * Event factory functions for session-summary feature.
 *
 * Creates properly-typed logging events for session summary operations.
 * These events are logged for observability but don't trigger handlers.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.4-3.5
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.4
 */

import type {
  SessionSummaryStartEvent,
  SessionSummaryFinishEvent,
  SessionTitleChangedEvent,
  IntentChangedEvent,
  SummarySkippedEvent,
  DecisionRecordedEvent,
  EventLogContext,
  SessionSummaryStartPayload,
  SessionSummaryFinishPayload,
  SessionTitleChangedPayload,
  IntentChangedPayload,
  DecisionRecordedPayload,
} from '@sidekick/types'

// Re-export for consumers
export type { EventLogContext } from '@sidekick/types'

/**
 * Factory functions for creating session-summary-related logging events.
 */
/* v8 ignore start -- pure data factories with deterministic structure */
export const SessionSummaryEvents = {
  /** Emitted when summary generation begins. */
  summaryStart(context: EventLogContext, payload: SessionSummaryStartPayload): SessionSummaryStartEvent {
    return {
      type: 'session-summary:start',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload,
    }
  },

  /** Emitted when summary generation completes. */
  summaryFinish(context: EventLogContext, payload: SessionSummaryFinishPayload): SessionSummaryFinishEvent {
    return {
      type: 'session-summary:finish',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload,
    }
  },

  /** Emitted when session title changes. */
  titleChanged(context: EventLogContext, payload: SessionTitleChangedPayload): SessionTitleChangedEvent {
    return {
      type: 'session-title:changed',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload,
    }
  },

  /** Emitted when latest intent changes. */
  intentChanged(context: EventLogContext, payload: IntentChangedPayload): IntentChangedEvent {
    return {
      type: 'intent:changed',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload,
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
      type: 'session-summary:skipped',
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
        countdown: metadata.countdown,
        countdown_threshold: metadata.countdown_threshold,
        reason: 'countdown_active',
      },
    }
  },
}

/**
 * Factory functions for creating decision:recorded logging events.
 * Captures LLM call decisions (calling, skipped) with reasoning.
 */
export const DecisionEvents = {
  /** Emitted when an LLM decision is recorded. */
  decisionRecorded(context: EventLogContext, payload: DecisionRecordedPayload): DecisionRecordedEvent {
    return {
      type: 'decision:recorded',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload,
    }
  },
}
/* v8 ignore stop */
