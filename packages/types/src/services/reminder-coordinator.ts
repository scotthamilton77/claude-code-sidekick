/**
 * Reminder Coordinator Service Interface
 *
 * Minimal interface for cross-reminder coordination.
 * Implemented by ReminderOrchestrator in feature-reminders.
 *
 * @see docs/plans/2026-01-18-reminder-orchestrator-design.md
 */

import type { HookName } from '../events.js'

/**
 * Reference to a reminder for coordination.
 */
export interface ReminderRef {
  /** Reminder name (e.g., 'pause-and-reflect', 'verify-completion') */
  name: string
  /** Hook where the reminder was staged/consumed */
  hook: HookName
}

/**
 * Metrics snapshot for coordination decisions.
 */
export interface CoordinationMetrics {
  turnCount: number
  toolsThisTurn: number
  toolCount: number
}

/**
 * Reminder coordinator handles cross-reminder coordination rules.
 * Handlers call coordinator methods after their primary action.
 */
export interface ReminderCoordinator {
  /**
   * Called after a reminder is staged (daemon context).
   * Triggers cascade prevention rules.
   */
  onReminderStaged(reminder: ReminderRef, sessionId: string): Promise<void>

  /**
   * Called after a reminder is consumed (via IPC from CLI).
   * Triggers baseline reset and unstage rules.
   */
  onReminderConsumed(reminder: ReminderRef, sessionId: string, metrics: CoordinationMetrics): Promise<void>

  /**
   * Called on UserPromptSubmit (daemon context).
   * Clears coordination state for new user prompt.
   */
  onUserPromptSubmit(sessionId: string): Promise<void>

  /**
   * Called when Stop hook fires. Cleans up reminders that are moot when agent stops.
   * P&R is designed to interrupt runaway execution — once the agent stops, it's irrelevant.
   */
  onStop(sessionId: string): Promise<void>
}
