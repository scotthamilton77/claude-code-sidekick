/**
 * Staging Service Types
 *
 * Interfaces for reminder file staging.
 * Used by Supervisor for atomic file operations.
 *
 * @see docs/design/flow.md §2.2 Staging Pattern
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { Logger } from '../logger.js'

/**
 * P&R baseline state stored after VC consumption.
 * Used to reset P&R threshold after verify-completion is injected.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */
export interface PRBaselineState {
  /** Turn count when VC was consumed */
  turnCount: number
  /** Tools in turn when VC was consumed (new P&R baseline) */
  toolsThisTurn: number
  /** Unix timestamp when baseline was set */
  timestamp: number
}

/**
 * Verify-completion unverified state.
 * Tracks when source code changes haven't been verified due to non-blocking classification.
 * Used to re-stage verify-completion on next UserPromptSubmit.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */
export interface VCUnverifiedState {
  /** Whether there are unverified source code changes */
  hasUnverifiedChanges: boolean
  /** Number of non-blocking classification cycles */
  cycleCount: number
  /** Metrics snapshot when state was set */
  setAt: StagingMetrics
  /** Last classification result */
  lastClassification: {
    category: string
    confidence: number
  }
}

/**
 * Metrics snapshot captured when a reminder is staged.
 * Used by Supervisor to determine reactivation after consumption.
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.3
 */
export interface StagingMetrics {
  /** Unix timestamp in milliseconds when reminder was staged */
  timestamp: number
  /** Turn count at staging time */
  turnCount: number
  /** Tool count within the turn at staging time */
  toolsThisTurn: number
  /** Total tool count at staging time */
  toolCount: number
}

/**
 * Staged reminder data structure.
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.3
 */
export interface StagedReminder {
  /** Reminder name */
  name: string
  /** Whether this reminder blocks the action */
  blocking: boolean
  /** Priority (higher = more important) */
  priority: number
  /** Whether reminder persists across turns */
  persistent: boolean
  /** User-facing message */
  userMessage?: string
  /** Additional context for the agent */
  additionalContext?: string
  /** Reason for blocking (blocking reminders) */
  reason?: string
  /** Metrics snapshot at staging time (for reactivation decisions) */
  stagedAt?: StagingMetrics
}

/**
 * Staging service interface.
 * Handles atomic file staging for the reminder system.
 *
 * @see docs/design/flow.md §2.2 Staging Pattern
 */
export interface StagingService {
  /**
   * Stage a reminder for a specific hook.
   * Uses atomic writes (temp file + rename).
   */
  stageReminder(hookName: string, reminderName: string, data: StagedReminder): Promise<void>

  /**
   * Read a staged reminder.
   */
  readReminder(hookName: string, reminderName: string): Promise<StagedReminder | null>

  /**
   * Clear all staged reminders for a hook (or all hooks).
   * @param hookName - Optional hook name to clear (clears all if omitted)
   * @param options - Optional options including request-scoped logger
   */
  clearStaging(hookName?: string, options?: { logger?: Logger }): Promise<void>

  /**
   * List all staged reminders for a hook, sorted by priority (highest first).
   */
  listReminders(hookName: string): Promise<StagedReminder[]>

  /**
   * Delete a specific staged reminder.
   */
  deleteReminder(hookName: string, reminderName: string): Promise<void>

  /**
   * List consumed reminder files for a specific reminder ID.
   * Consumed files have pattern: {reminderName}.{timestamp}.json
   * Returns reminders sorted by timestamp (newest first).
   */
  listConsumedReminders(hookName: string, reminderName: string): Promise<StagedReminder[]>

  /**
   * Get the most recently consumed reminder for a specific reminder ID.
   * Used by staging handlers to determine if reactivation is needed.
   */
  getLastConsumed(hookName: string, reminderName: string): Promise<StagedReminder | null>
}
