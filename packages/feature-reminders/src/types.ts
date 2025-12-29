/**
 * Type definitions for Reminders feature
 * @see docs/design/FEATURE-REMINDERS.md
 */

/**
 * Reminder settings (the inner settings object from features.yaml)
 */
export interface RemindersSettings {
  pause_and_reflect_threshold: number
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
 * Default reminder settings values
 */
export const DEFAULT_REMINDERS_SETTINGS: RemindersSettings = {
  pause_and_reflect_threshold: 15,
}

/**
 * Reminder IDs (matches YAML filenames)
 */
export const ReminderIds = {
  USER_PROMPT_SUBMIT: 'user-prompt-submit',
  PAUSE_AND_REFLECT: 'pause-and-reflect',
  VERIFY_COMPLETION: 'verify-completion',
} as const

export type ReminderId = (typeof ReminderIds)[keyof typeof ReminderIds]
