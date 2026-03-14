/**
 * Event factory functions for reminders feature.
 *
 * Creates properly-typed logging events for reminder operations.
 * These events are logged for observability but don't trigger handlers.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §3.4-3.5
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type {
  ReminderConsumedEvent,
  ReminderUnstagedEvent,
  RemindersClearedEvent,
  EventLogContext,
} from '@sidekick/types'

// Re-export for consumers
export type { EventLogContext } from '@sidekick/types'

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
      classificationResult?: {
        category: string
        confidence: number
        shouldBlock: boolean
      }
    },
    _metadata?: { stagingPath?: string }
  ): ReminderConsumedEvent {
    return {
      type: 'reminder:consumed',
      time: Date.now(),
      source: 'cli',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        reminderName: state.reminderName,
        reminderReturned: state.reminderReturned,
        blocking: state.blocking,
        priority: state.priority,
        persistent: state.persistent,
        ...(state.classificationResult !== undefined && {
          classificationResult: state.classificationResult,
        }),
      },
    }
  },

  // Note: reminderStaged stays in @sidekick/core (used by staging-service.ts, circular dep)

  /**
   * Create a ReminderUnstaged event (logged when a reminder is removed from staging).
   */
  reminderUnstaged(
    context: EventLogContext,
    state: {
      reminderName: string
      hookName: string
      reason: string
      triggeredBy?: string
      toolState?: { status: string; editsSinceVerified: number }
    }
  ): ReminderUnstagedEvent {
    return {
      type: 'reminder:unstaged',
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
        reminderName: state.reminderName,
        hookName: state.hookName,
        reason: state.reason,
        ...(state.triggeredBy !== undefined && { triggeredBy: state.triggeredBy }),
        ...(state.toolState !== undefined && { toolState: state.toolState }),
      },
    }
  },

  /**
   * Create a RemindersCleared event (logged when staging directory is cleaned).
   */
  remindersCleared(
    context: EventLogContext,
    state: { clearedCount: number; hookNames?: string[] },
    reason: 'session_start' | 'manual'
  ): RemindersClearedEvent {
    return {
      type: 'reminder:cleared',
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
        clearedCount: state.clearedCount,
        hookNames: state.hookNames,
        reason,
      },
    }
  },
}
/* v8 ignore stop */
