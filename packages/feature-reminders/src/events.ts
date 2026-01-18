/**
 * Event factory functions for reminders feature.
 *
 * Creates properly-typed logging events for reminder operations.
 * These events are logged for observability but don't trigger handlers.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.4-3.5
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { ReminderConsumedEvent, RemindersClearedEvent } from '@sidekick/types'

/**
 * Context for logging events.
 */
export interface EventLogContext {
  sessionId: string
  scope?: 'project' | 'user'
  correlationId?: string
  traceId?: string
  hook?: string
  taskId?: string
}

/**
 * Factory functions for creating reminder-related logging events.
 */
/* v8 ignore start -- pure data factories with deterministic structure */
export const ReminderEvents = {
  /**
   * Create a ReminderConsumed event (logged when CLI returns a staged reminder).
   */
  reminderConsumed(
    context: EventLogContext,
    state: {
      reminderName: string
      reminderReturned: boolean
      blocking?: boolean
      priority?: number
      persistent?: boolean
    },
    metadata?: { stagingPath?: string }
  ): ReminderConsumedEvent {
    return {
      type: 'ReminderConsumed',
      time: Date.now(),
      source: 'cli',
      context: {
        sessionId: context.sessionId,
        scope: context.scope,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
      },
      payload: {
        state,
        metadata,
      },
    }
  },

  // Note: reminderStaged stays in @sidekick/core (used by staging-service.ts, circular dep)

  /**
   * Create a RemindersCleared event (logged when staging directory is cleaned).
   */
  remindersCleared(
    context: EventLogContext,
    state: { clearedCount: number; hookNames?: string[] },
    reason: 'session_start' | 'manual'
  ): RemindersClearedEvent {
    return {
      type: 'RemindersCleared',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        scope: context.scope,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        state,
        reason,
      },
    }
  },
}
/* v8 ignore stop */
