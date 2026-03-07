/**
 * Type definitions for Reminders feature
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { z } from 'zod'

// ============================================================================
// Verification Tool Configuration
// ============================================================================

/** Zod schema for a single verification tool config */
export const VerificationToolConfigSchema = z.object({
  enabled: z.boolean(),
  patterns: z.array(z.string()).min(1),
  clearing_threshold: z.number().int().positive(),
  clearing_patterns: z.array(z.string()).min(1),
})

export type VerificationToolConfig = z.infer<typeof VerificationToolConfigSchema>

/** Zod schema for the full verification_tools map */
export const VerificationToolsMapSchema = z.record(z.string(), VerificationToolConfigSchema)

export type VerificationToolsMap = z.infer<typeof VerificationToolsMapSchema>

/** Default verification tools (fat defaults for all ecosystems) */
export const DEFAULT_VERIFICATION_TOOLS: VerificationToolsMap = {
  build: {
    enabled: true,
    patterns: [
      'pnpm build',
      'npm run build',
      'yarn build',
      'tsc',
      'esbuild',
      'python setup.py build',
      'pip install',
      'poetry build',
      'mvn compile',
      'mvn package',
      'gradle build',
      'gradlew build',
      'go build',
      'cargo build',
      'make build',
      'cmake --build',
      'docker build',
    ],
    clearing_threshold: 3,
    clearing_patterns: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.java',
      '**/*.kt',
      '**/*.go',
      '**/*.rs',
      '**/*.c',
      '**/*.cpp',
      '**/*.cs',
    ],
  },
  typecheck: {
    enabled: true,
    patterns: ['pnpm typecheck', 'tsc --noEmit', 'mypy', 'pyright', 'pytype', 'go vet'],
    clearing_threshold: 3,
    clearing_patterns: ['**/*.ts', '**/*.tsx', '**/*.py', '**/*.go'],
  },
  test: {
    enabled: true,
    patterns: [
      'pnpm test',
      'npm test',
      'yarn test',
      'vitest',
      'jest',
      'pytest',
      'python -m pytest',
      'go test',
      'cargo test',
      'mvn test',
      'gradle test',
      'gradlew test',
      'dotnet test',
      'make test',
    ],
    clearing_threshold: 3,
    clearing_patterns: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.java',
      '**/*.kt',
      '**/*.go',
      '**/*.rs',
      '**/*.test.*',
      '**/*.spec.*',
      '**/test_*',
    ],
  },
  lint: {
    enabled: true,
    patterns: [
      'pnpm lint',
      'npm run lint',
      'yarn lint',
      'eslint',
      'ruff check',
      'flake8',
      'pylint',
      'golangci-lint',
      'cargo clippy',
      'ktlint',
      'dotnet format',
    ],
    clearing_threshold: 5,
    clearing_patterns: [
      '**/*.ts',
      '**/*.tsx',
      '**/*.js',
      '**/*.jsx',
      '**/*.py',
      '**/*.java',
      '**/*.kt',
      '**/*.go',
      '**/*.rs',
    ],
  },
}

// ============================================================================
// Reminder Settings
// ============================================================================

/**
 * Reminder settings (the inner settings object from features.yaml)
 */
export interface RemindersSettings {
  pause_and_reflect_threshold: number
  source_code_patterns: string[]
  completion_detection?: CompletionDetectionSettings
  /** Max re-evaluation cycles for non-blocking verification (-1 = unlimited, 0 = disabled) */
  max_verification_cycles?: number
  /** Per-tool verification configuration */
  verification_tools?: VerificationToolsMap
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
 * Completion classification categories for smart verify-completion detection
 */
export type CompletionCategory = 'CLAIMING_COMPLETION' | 'ASKING_QUESTION' | 'ANSWERING_QUESTION' | 'OTHER'

/**
 * Result of LLM classification for completion intent
 */
export interface CompletionClassification {
  category: CompletionCategory
  confidence: number
  reasoning?: string
}

/**
 * LLM sub-feature configuration (profile + optional fallback)
 */
export interface LlmSubFeatureConfig {
  profile: string
  fallback_profile?: string
}

/**
 * Settings for smart completion detection
 */
export interface CompletionDetectionSettings {
  enabled: boolean
  confidence_threshold: number
  llm?: LlmSubFeatureConfig
}

/**
 * Default completion detection settings
 */
export const DEFAULT_COMPLETION_DETECTION_SETTINGS: CompletionDetectionSettings = {
  enabled: true,
  confidence_threshold: 0.7,
  llm: { profile: 'fast-lite', fallback_profile: 'cheap-fallback' },
}

/**
 * Default reminder settings values
 */
export const DEFAULT_REMINDERS_SETTINGS: RemindersSettings = {
  pause_and_reflect_threshold: 60,
  source_code_patterns: DEFAULT_SOURCE_CODE_PATTERNS,
  max_verification_cycles: -1, // -1 = unlimited, 0 = disabled
  verification_tools: DEFAULT_VERIFICATION_TOOLS,
}

/**
 * Reminder IDs (matches YAML filenames)
 */
export const ReminderIds = {
  USER_PROMPT_SUBMIT: 'user-prompt-submit',
  PAUSE_AND_REFLECT: 'pause-and-reflect',
  VERIFY_COMPLETION: 'verify-completion',
  VC_BUILD: 'vc-build',
  VC_TYPECHECK: 'vc-typecheck',
  VC_TEST: 'vc-test',
  VC_LINT: 'vc-lint',
  REMEMBER_YOUR_PERSONA: 'remember-your-persona',
  PERSONA_CHANGED: 'persona-changed',
  USER_PROFILE: 'user-profile',
} as const

/** All per-tool VC reminder IDs */
export const VC_TOOL_REMINDER_IDS = [
  ReminderIds.VC_BUILD,
  ReminderIds.VC_TYPECHECK,
  ReminderIds.VC_TEST,
  ReminderIds.VC_LINT,
] as const

/** All VC-related reminder IDs (wrapper + per-tool) */
export const ALL_VC_REMINDER_IDS = [ReminderIds.VERIFY_COMPLETION, ...VC_TOOL_REMINDER_IDS] as const

export type ReminderId = (typeof ReminderIds)[keyof typeof ReminderIds]
