/**
 * Type definitions for Reminders feature
 * @see docs/design/FEATURE-REMINDERS.md
 */

/**
 * Reminder configuration from features.yaml
 */
export interface ReminderConfig {
  enabled: boolean
  turn_cadence: number
  update_threshold: number
  stuck_threshold: number
}

/**
 * Reminder definition from YAML asset file
 */
export interface ReminderDefinition {
  id: string
  blocking: boolean
  priority: number
  persistent: boolean
  userMessage?: string
  additionalContext?: string
  stopReason?: string
}

/**
 * Template context for variable interpolation
 */
export interface TemplateContext {
  toolsThisTurn?: number
  turnCount?: number
  toolCount?: number
  [key: string]: unknown
}

/**
 * Default reminder configuration values
 */
export const DEFAULT_REMINDER_CONFIG: ReminderConfig = {
  enabled: true,
  turn_cadence: 4,
  update_threshold: 15,
  stuck_threshold: 20,
}

/**
 * Reminder IDs (matches YAML filenames)
 */
export const ReminderIds = {
  USER_PROMPT_SUBMIT: 'user-prompt-submit',
  ARE_YOU_STUCK: 'are-you-stuck',
  TIME_FOR_USER_UPDATE: 'time-for-user-update',
  VERIFY_COMPLETION: 'verify-completion',
} as const

export type ReminderId = (typeof ReminderIds)[keyof typeof ReminderIds]
