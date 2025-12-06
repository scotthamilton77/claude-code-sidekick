/**
 * Staging Service Types
 *
 * Interfaces for reminder file staging.
 * Used by Supervisor for atomic file operations.
 *
 * @see docs/design/flow.md §2.2 Staging Pattern
 * @see docs/design/FEATURE-REMINDERS.md
 */

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
  /** Stop reason (for stop reminders) */
  stopReason?: string
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
   */
  clearStaging(hookName?: string): Promise<void>

  /**
   * Suppress a hook (marker file prevents reminder injection).
   */
  suppressHook(hookName: string): Promise<void>

  /**
   * Check if a hook is suppressed.
   */
  isHookSuppressed(hookName: string): Promise<boolean>

  /**
   * Clear suppression for a hook.
   */
  clearSuppression(hookName: string): Promise<void>

  /**
   * List all staged reminders for a hook, sorted by priority (highest first).
   */
  listReminders(hookName: string): Promise<StagedReminder[]>

  /**
   * Delete a specific staged reminder.
   */
  deleteReminder(hookName: string, reminderName: string): Promise<void>
}
