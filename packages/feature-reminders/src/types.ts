/**
 * Type definitions for Reminders feature
 * @see docs/design/FEATURE-REMINDERS.md
 */

/**
 * Reminder settings (the inner settings object from features.yaml)
 */
export interface RemindersSettings {
  pause_and_reflect_threshold: number
  source_code_patterns: string[]
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
  reason?: string
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
 * Default source code file patterns for verify-completion triggering.
 * Uses glob patterns matched against file paths.
 */
export const DEFAULT_SOURCE_CODE_PATTERNS = [
  // TypeScript/JavaScript
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  // Python
  '**/*.py',
  // Go
  '**/*.go',
  // Rust
  '**/*.rs',
  // JVM languages
  '**/*.java',
  '**/*.kt',
  '**/*.scala',
  // Swift
  '**/*.swift',
  // C/C++
  '**/*.c',
  '**/*.cpp',
  '**/*.h',
  '**/*.hpp',
  // Ruby
  '**/*.rb',
  // PHP
  '**/*.php',
  // C#
  '**/*.cs',
  // Shell
  '**/*.sh',
  // Config files (commonly edited with code)
  '**/*.yaml',
  '**/*.yml',
  '**/*.toml',
  // Specific important files
  '**/package.json',
  '**/tsconfig.json',
  '**/Dockerfile',
  '**/Makefile',
]

/**
 * Default reminder settings values
 */
export const DEFAULT_REMINDERS_SETTINGS: RemindersSettings = {
  pause_and_reflect_threshold: 15,
  source_code_patterns: DEFAULT_SOURCE_CODE_PATTERNS,
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
