/**
 * Type definitions for Reminders feature
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { z } from 'zod'

// ============================================================================
// Verification Tool Configuration
// ============================================================================

/** Scope of a verification tool invocation */
export const ToolPatternScopeSchema = z.enum(['project', 'package', 'file'])
export type ToolPatternScope = z.infer<typeof ToolPatternScopeSchema>

/** Zod schema for a structured tool pattern */
export const ToolPatternSchema = z.object({
  tool_id: z.string(),
  tool: z.string().nullable(),
  scope: ToolPatternScopeSchema.default('project'),
})

export type ToolPattern = z.infer<typeof ToolPatternSchema>

/** Zod schema for a single verification tool config */
export const VerificationToolConfigSchema = z.object({
  enabled: z.boolean(),
  patterns: z.array(ToolPatternSchema).min(1),
  clearing_threshold: z.number().int().positive(),
  clearing_patterns: z.array(z.string()).min(1),
})

export type VerificationToolConfig = z.infer<typeof VerificationToolConfigSchema>

/** Zod schema for the full verification_tools map */
export const VerificationToolsMapSchema = z.record(z.string(), VerificationToolConfigSchema)

export type VerificationToolsMap = z.infer<typeof VerificationToolsMapSchema>

/** Zod schema for a command runner prefix */
export const CommandRunnerSchema = z.object({
  prefix: z.string().min(1),
})

export type CommandRunner = z.infer<typeof CommandRunnerSchema>

/** Default verification tools (fat defaults for all ecosystems) */
export const DEFAULT_VERIFICATION_TOOLS: VerificationToolsMap = {
  build: {
    enabled: true,
    patterns: [
      // TypeScript/JavaScript
      { tool_id: 'tsc', tool: 'tsc', scope: 'project' },
      { tool_id: 'esbuild', tool: 'esbuild', scope: 'file' },
      { tool_id: 'pnpm-filter-build', tool: 'pnpm --filter * build', scope: 'package' },
      { tool_id: 'pnpm-build', tool: 'pnpm build', scope: 'project' },
      { tool_id: 'npm-build', tool: 'npm run build', scope: 'project' },
      { tool_id: 'yarn-workspace-build', tool: 'yarn workspace * build', scope: 'package' },
      { tool_id: 'yarn-build', tool: 'yarn build', scope: 'project' },
      // Python
      { tool_id: 'python-setup-build', tool: 'python setup.py build', scope: 'project' },
      { tool_id: 'pip-install', tool: 'pip install', scope: 'project' },
      { tool_id: 'poetry-build', tool: 'poetry build', scope: 'project' },
      // JVM
      { tool_id: 'mvn-compile', tool: 'mvn compile', scope: 'project' },
      { tool_id: 'mvn-package', tool: 'mvn package', scope: 'project' },
      { tool_id: 'gradle-build', tool: 'gradle build', scope: 'project' },
      { tool_id: 'gradlew-build', tool: './gradlew build', scope: 'project' },
      // Go
      { tool_id: 'go-build', tool: 'go build', scope: 'project' },
      // Rust
      { tool_id: 'cargo-build', tool: 'cargo build', scope: 'project' },
      // C/C++
      { tool_id: 'make-build', tool: 'make build', scope: 'project' },
      { tool_id: 'make-default', tool: 'make', scope: 'project' },
      { tool_id: 'cmake-build', tool: 'cmake --build', scope: 'project' },
      // Containers
      { tool_id: 'docker-build', tool: 'docker build', scope: 'project' },
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
    patterns: [
      { tool_id: 'tsc-noEmit', tool: 'tsc --noEmit', scope: 'project' },
      { tool_id: 'pnpm-filter-typecheck', tool: 'pnpm --filter * typecheck', scope: 'package' },
      { tool_id: 'pnpm-typecheck', tool: 'pnpm typecheck', scope: 'project' },
      { tool_id: 'npm-typecheck', tool: 'npm run typecheck', scope: 'project' },
      { tool_id: 'yarn-workspace-typecheck', tool: 'yarn workspace * typecheck', scope: 'package' },
      { tool_id: 'yarn-typecheck', tool: 'yarn typecheck', scope: 'project' },
      { tool_id: 'mypy', tool: 'mypy', scope: 'project' },
      { tool_id: 'pyright', tool: 'pyright', scope: 'project' },
      { tool_id: 'pytype', tool: 'pytype', scope: 'project' },
      { tool_id: 'go-vet', tool: 'go vet', scope: 'project' },
    ],
    clearing_threshold: 3,
    clearing_patterns: ['**/*.ts', '**/*.tsx', '**/*.py', '**/*.go'],
  },
  test: {
    enabled: true,
    patterns: [
      { tool_id: 'vitest', tool: 'vitest', scope: 'project' },
      { tool_id: 'jest', tool: 'jest', scope: 'project' },
      { tool_id: 'pnpm-filter-test', tool: 'pnpm --filter * test', scope: 'package' },
      { tool_id: 'pnpm-test', tool: 'pnpm test', scope: 'project' },
      { tool_id: 'npm-test', tool: 'npm test', scope: 'project' },
      { tool_id: 'yarn-workspace-test', tool: 'yarn workspace * test', scope: 'package' },
      { tool_id: 'yarn-test', tool: 'yarn test', scope: 'project' },
      { tool_id: 'pytest', tool: 'pytest', scope: 'project' },
      { tool_id: 'python-pytest', tool: 'python -m pytest', scope: 'project' },
      { tool_id: 'python-unittest', tool: 'python -m unittest', scope: 'project' },
      { tool_id: 'mvn-test', tool: 'mvn test', scope: 'project' },
      { tool_id: 'gradle-test', tool: 'gradle test', scope: 'project' },
      { tool_id: 'gradlew-test', tool: './gradlew test', scope: 'project' },
      { tool_id: 'go-test', tool: 'go test', scope: 'project' },
      { tool_id: 'cargo-test', tool: 'cargo test', scope: 'project' },
      { tool_id: 'dotnet-test', tool: 'dotnet test', scope: 'project' },
      { tool_id: 'make-test', tool: 'make test', scope: 'project' },
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
      { tool_id: 'eslint', tool: 'eslint', scope: 'project' },
      { tool_id: 'pnpm-filter-lint', tool: 'pnpm --filter * lint', scope: 'package' },
      { tool_id: 'pnpm-lint', tool: 'pnpm lint', scope: 'project' },
      { tool_id: 'npm-lint', tool: 'npm run lint', scope: 'project' },
      { tool_id: 'yarn-workspace-lint', tool: 'yarn workspace * lint', scope: 'package' },
      { tool_id: 'yarn-lint', tool: 'yarn lint', scope: 'project' },
      { tool_id: 'ruff', tool: 'ruff', scope: 'project' },
      { tool_id: 'flake8', tool: 'flake8', scope: 'project' },
      { tool_id: 'pylint', tool: 'pylint', scope: 'project' },
      { tool_id: 'golangci-lint', tool: 'golangci-lint', scope: 'project' },
      { tool_id: 'cargo-clippy', tool: 'cargo clippy', scope: 'project' },
      { tool_id: 'ktlint', tool: 'ktlint', scope: 'project' },
      { tool_id: 'dotnet-format', tool: 'dotnet format', scope: 'project' },
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
  /** Per-reminder throttle thresholds: reminder ID → message count between injections */
  reminder_thresholds?: Record<string, number>
  /** Command runner prefixes that trigger unanchored pattern matching */
  command_runners?: CommandRunner[]
}

/**
 * Reminder definition from YAML asset file
 */
export interface ReminderDefinition {
  id: string
  blocking: boolean
  priority: number
  persistent: boolean
  /** Whether this reminder participates in message-count throttling */
  throttle?: boolean
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
  reminder_thresholds: {
    'user-prompt-submit': 10,
    'remember-your-persona': 5,
  },
  command_runners: [
    // Python
    { prefix: 'uv run' },
    { prefix: 'poetry run' },
    { prefix: 'pipx run' },
    { prefix: 'pdm run' },
    { prefix: 'hatch run' },
    { prefix: 'conda run' },
    // Node.js
    { prefix: 'npx' },
    { prefix: 'pnpx' },
    { prefix: 'bunx' },
    { prefix: 'pnpm dlx' },
    { prefix: 'pnpm exec' },
    { prefix: 'bun run' },
    { prefix: 'yarn dlx' },
    { prefix: 'yarn exec' },
    { prefix: 'npm exec' },
    // Ruby
    { prefix: 'bundle exec' },
    // .NET
    { prefix: 'dotnet tool run' },
  ],
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

/** Maps verification tool config names to their reminder IDs */
export const TOOL_REMINDER_MAP: Record<string, string> = {
  build: ReminderIds.VC_BUILD,
  typecheck: ReminderIds.VC_TYPECHECK,
  test: ReminderIds.VC_TEST,
  lint: ReminderIds.VC_LINT,
}

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
