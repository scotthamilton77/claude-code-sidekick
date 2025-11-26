/**
 * Configuration Service Module
 *
 * Implements Phase 2 of the Sidekick Node runtime per LLD-CONFIG-SYSTEM.md.
 *
 * Provides a multi-layer configuration cascade with:
 * - Environment variables (SIDEKICK_* prefixed)
 * - .env file loading (~/.sidekick/.env, project .env, .sidekick/.env)
 * - User JSONC config (~/.sidekick/config.jsonc)
 * - Project JSONC config (.sidekick/config.jsonc)
 * - Project-local JSONC config (.sidekick/config.jsonc.local)
 *
 * Key features per LLD requirements:
 * - Deep-merge semantics for nested objects
 * - Zod schema validation with strict mode (rejects unknown keys per §6.4)
 * - Config immutability after loading (Object.freeze per §2)
 * - Sensible defaults applied via Zod transforms
 *
 * @see LLD-CONFIG-SYSTEM.md
 * @see LLD-SCHEMA-CONTRACTS.md §6.4 (strict mode)
 * @see TARGET-ARCHITECTURE.md §3.3 Configuration Cascade
 */

import { config as loadDotenv } from 'dotenv'
import { parse as parseJsonc } from 'jsonc-parser'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { z } from 'zod/v4'

// =============================================================================
// Deep Freeze Utility
// =============================================================================

/**
 * Recursively freezes an object and all nested objects/arrays.
 * Per LLD-CONFIG-SYSTEM §2: Config object is immutable after loading.
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  // Freeze the object itself first
  Object.freeze(obj)

  // Then recursively freeze all properties
  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key]
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value)
    }
  }

  return obj
}

// =============================================================================
// Zod Schemas
// =============================================================================

const LogLevelSchema = z.enum(['debug', 'info', 'warn', 'error'])

const LlmProviderSchema = z.enum(['claude-cli', 'openai-api', 'openrouter', 'custom'])

// Default values as constants for reuse
const FEATURES_DEFAULTS = {
  statusline: true,
  sessionSummary: true,
  resume: true,
  sleeper: true,
  snarkyComment: true,
  reminders: true,
  reminderUserPrompt: true,
  reminderToolCadence: true,
  reminderStuckCheckpoint: true,
  reminderPreCompletion: true,
  cleanup: true,
} as const

const CIRCUIT_BREAKER_DEFAULTS = {
  enabled: true,
  failureThreshold: 3,
  backoffInitial: 60,
  backoffMax: 3600,
  backoffMultiplier: 2,
} as const

const LLM_DEFAULTS = {
  provider: 'openrouter' as const,
  timeout: 10,
  timeoutMaxRetries: 3,
  circuitBreaker: CIRCUIT_BREAKER_DEFAULTS,
  debugDumpEnabled: false,
}

const SESSION_SUMMARY_DEFAULTS = {
  excerptLines: 80,
  filterToolMessages: true,
  keepHistory: false,
  countdownLow: 5,
  countdownMed: 20,
  countdownHigh: 10000,
  bookmarkConfidenceThreshold: 0.8,
  bookmarkResetThreshold: 0.7,
  minUserMessages: 5,
  minRecentLines: 50,
  titleMaxWords: 8,
  intentMaxWords: 12,
} as const

const REMINDER_DEFAULTS = {
  userPromptCadence: 1,
  toolUseCadence: 60,
  stuckThreshold: 40,
} as const

const CLEANUP_DEFAULTS = {
  enabled: true,
  minCount: 5,
  ageDays: 2,
  dryRun: false,
} as const

// Per LLD-SCHEMA-CONTRACTS §6.4: Use .strict() to reject unknown config keys
const FeaturesSchema = z
  .object({
    statusline: z.boolean().optional(),
    sessionSummary: z.boolean().optional(),
    resume: z.boolean().optional(),
    sleeper: z.boolean().optional(),
    snarkyComment: z.boolean().optional(),
    reminders: z.boolean().optional(),
    reminderUserPrompt: z.boolean().optional(),
    reminderToolCadence: z.boolean().optional(),
    reminderStuckCheckpoint: z.boolean().optional(),
    reminderPreCompletion: z.boolean().optional(),
    cleanup: z.boolean().optional(),
  })
  .strict()
  .transform((val) => ({ ...FEATURES_DEFAULTS, ...val }))

const CircuitBreakerSchema = z
  .object({
    enabled: z.boolean().optional(),
    failureThreshold: z.number().min(1).optional(),
    backoffInitial: z.number().min(1).optional(),
    backoffMax: z.number().min(1).optional(),
    backoffMultiplier: z.number().min(1).optional(),
  })
  .strict()
  .transform((val) => ({ ...CIRCUIT_BREAKER_DEFAULTS, ...val }))

const LlmConfigSchema = z
  .object({
    provider: LlmProviderSchema.optional(),
    fallbackProvider: LlmProviderSchema.optional(),
    fallbackModel: z.string().optional(),
    timeout: z.number().min(1).max(300).optional(),
    timeoutMaxRetries: z.number().min(0).max(10).optional(),
    circuitBreaker: CircuitBreakerSchema.optional(),
    debugDumpEnabled: z.boolean().optional(),
  })
  .strict()
  .transform((val) => ({
    ...LLM_DEFAULTS,
    ...val,
    circuitBreaker: val.circuitBreaker ?? CIRCUIT_BREAKER_DEFAULTS,
  }))

const SessionSummaryConfigSchema = z
  .object({
    excerptLines: z.number().min(10).optional(),
    filterToolMessages: z.boolean().optional(),
    keepHistory: z.boolean().optional(),
    countdownLow: z.number().min(1).optional(),
    countdownMed: z.number().min(1).optional(),
    countdownHigh: z.number().min(1).optional(),
    bookmarkConfidenceThreshold: z.number().min(0).max(1).optional(),
    bookmarkResetThreshold: z.number().min(0).max(1).optional(),
    minUserMessages: z.number().min(1).optional(),
    minRecentLines: z.number().min(1).optional(),
    titleMaxWords: z.number().min(1).optional(),
    intentMaxWords: z.number().min(1).optional(),
  })
  .strict()
  .transform((val) => ({ ...SESSION_SUMMARY_DEFAULTS, ...val }))

const ReminderConfigSchema = z
  .object({
    userPromptCadence: z.number().min(1).optional(),
    toolUseCadence: z.number().min(1).optional(),
    stuckThreshold: z.number().min(1).optional(),
  })
  .strict()
  .transform((val) => ({ ...REMINDER_DEFAULTS, ...val }))

const CleanupConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    minCount: z.number().min(1).optional(),
    ageDays: z.number().min(1).optional(),
    dryRun: z.boolean().optional(),
  })
  .strict()
  .transform((val) => ({ ...CLEANUP_DEFAULTS, ...val }))

export const SidekickConfigSchema = z
  .object({
    logLevel: LogLevelSchema.optional(),
    consoleLogging: z.boolean().optional(),
    claudeBin: z.string().optional(),
    features: FeaturesSchema.optional(),
    llm: LlmConfigSchema.optional(),
    sessionSummary: SessionSummaryConfigSchema.optional(),
    reminder: ReminderConfigSchema.optional(),
    cleanup: CleanupConfigSchema.optional(),
  })
  .strict()
  .transform((val) => ({
    logLevel: val.logLevel ?? 'info',
    consoleLogging: val.consoleLogging ?? false,
    claudeBin: val.claudeBin,
    features: val.features ?? FEATURES_DEFAULTS,
    llm: val.llm ?? LLM_DEFAULTS,
    sessionSummary: val.sessionSummary ?? SESSION_SUMMARY_DEFAULTS,
    reminder: val.reminder ?? REMINDER_DEFAULTS,
    cleanup: val.cleanup ?? CLEANUP_DEFAULTS,
  }))

export type SidekickConfig = z.infer<typeof SidekickConfigSchema>

// =============================================================================
// Config Loading
// =============================================================================

export interface ConfigServiceOptions {
  projectRoot?: string
  homeDir?: string
}

interface LoadedLayer {
  source: string
  data: Record<string, unknown>
}

function tryReadJsonc(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null
  }

  const content = readFileSync(filePath, 'utf8')
  const errors: { error: number; offset: number; length: number }[] = []
  const parsed = parseJsonc(content, errors) as Record<string, unknown>

  if (errors.length > 0) {
    const firstError = errors[0]
    throw new Error(`Failed to parse JSONC at ${filePath}: syntax error at offset ${firstError.offset}`)
  }

  return parsed
}

function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
  const result = { ...base } as Record<string, unknown>

  for (const key of Object.keys(override)) {
    const baseVal = result[key]
    const overrideVal = override[key]

    if (
      baseVal !== null &&
      typeof baseVal === 'object' &&
      !Array.isArray(baseVal) &&
      overrideVal !== null &&
      typeof overrideVal === 'object' &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(baseVal as Record<string, unknown>, overrideVal as Record<string, unknown>)
    } else {
      result[key] = overrideVal
    }
  }

  return result as T
}

function envToConfig(env: NodeJS.ProcessEnv): Record<string, unknown> {
  const config: Record<string, unknown> = {}

  // Map SIDEKICK_* env vars to config paths
  const mappings: Record<string, (val: string) => void> = {
    SIDEKICK_LOG_LEVEL: (val) => {
      config.logLevel = val
    },
    SIDEKICK_CONSOLE_LOGGING: (val) => {
      config.consoleLogging = val === 'true'
    },
    SIDEKICK_LLM_PROVIDER: (val) => {
      config.llm = config.llm ?? {}
      ;(config.llm as Record<string, unknown>).provider = val
    },
    SIDEKICK_LLM_TIMEOUT: (val) => {
      config.llm = config.llm ?? {}
      ;(config.llm as Record<string, unknown>).timeout = parseInt(val, 10)
    },
  }

  for (const [envKey, setter] of Object.entries(mappings)) {
    const val = env[envKey]
    if (val !== undefined) {
      setter(val)
    }
  }

  return config
}

function loadEnvFiles(homeDir: string, projectRoot?: string): void {
  // Load env files in precedence order (later overrides earlier)
  const envPaths: string[] = []

  // User env
  const userEnv = join(homeDir, '.sidekick', '.env')
  if (existsSync(userEnv)) {
    envPaths.push(userEnv)
  }

  if (projectRoot) {
    // Project root .env (standard location)
    const projectRootEnv = join(projectRoot, '.env')
    if (existsSync(projectRootEnv)) {
      envPaths.push(projectRootEnv)
    }

    // Project .sidekick/.env
    const projectSidekickEnv = join(projectRoot, '.sidekick', '.env')
    if (existsSync(projectSidekickEnv)) {
      envPaths.push(projectSidekickEnv)
    }

    // Project .sidekick/.env.local (highest priority)
    const projectLocalEnv = join(projectRoot, '.sidekick', '.env.local')
    if (existsSync(projectLocalEnv)) {
      envPaths.push(projectLocalEnv)
    }
  }

  // Load in order (each subsequent file overrides previous values in process.env)
  for (const envPath of envPaths) {
    loadDotenv({ path: envPath, override: true })
  }
}

export function loadConfig(options: ConfigServiceOptions): SidekickConfig {
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot

  // Step 1: Load env files first (they go into process.env)
  loadEnvFiles(homeDir, projectRoot)

  // Step 2: Build merged config from layers
  const layers: LoadedLayer[] = []

  // Internal defaults are handled by Zod defaults
  // Start with env-derived config
  const envConfig = envToConfig(process.env)
  if (Object.keys(envConfig).length > 0) {
    layers.push({ source: 'environment', data: envConfig })
  }

  // User global JSONC (~/.sidekick/config.jsonc)
  const userConfigPath = join(homeDir, '.sidekick', 'config.jsonc')
  const userConfig = tryReadJsonc(userConfigPath)
  if (userConfig) {
    layers.push({ source: userConfigPath, data: userConfig })
  }

  if (projectRoot) {
    // Project JSONC (.sidekick/config.jsonc)
    const projectConfigPath = join(projectRoot, '.sidekick', 'config.jsonc')
    const projectConfig = tryReadJsonc(projectConfigPath)
    if (projectConfig) {
      layers.push({ source: projectConfigPath, data: projectConfig })
    }

    // Project-local .local variant (.sidekick/config.jsonc.local)
    const projectLocalConfigPath = join(projectRoot, '.sidekick', 'config.jsonc.local')
    const projectLocalConfig = tryReadJsonc(projectLocalConfigPath)
    if (projectLocalConfig) {
      layers.push({ source: projectLocalConfigPath, data: projectLocalConfig })
    }
  }

  // Step 3: Deep merge all layers
  let merged: Record<string, unknown> = {}
  for (const layer of layers) {
    merged = deepMerge(merged, layer.data)
  }

  // Step 4: Validate with Zod (applies defaults)
  const result = SidekickConfigSchema.safeParse(merged)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    throw new Error(`Configuration validation failed: ${issues}`)
  }

  // Step 5: Freeze config for immutability (per LLD-CONFIG-SYSTEM §2)
  return deepFreeze(result.data)
}

// =============================================================================
// ConfigService
// =============================================================================

export interface ConfigService {
  get<K extends keyof SidekickConfig>(key: K): SidekickConfig[K]
  getAll(): SidekickConfig
  sources: string[]
}

export function createConfigService(options: ConfigServiceOptions): ConfigService {
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot

  // Collect sources for debugging
  const sources: string[] = []

  // Load env files
  loadEnvFiles(homeDir, projectRoot)
  if (Object.keys(envToConfig(process.env)).length > 0) {
    sources.push('environment')
  }

  const userConfigPath = join(homeDir, '.sidekick', 'config.jsonc')
  if (existsSync(userConfigPath)) {
    sources.push(userConfigPath)
  }

  if (projectRoot) {
    const projectConfigPath = join(projectRoot, '.sidekick', 'config.jsonc')
    if (existsSync(projectConfigPath)) {
      sources.push(projectConfigPath)
    }

    const projectLocalConfigPath = join(projectRoot, '.sidekick', 'config.jsonc.local')
    if (existsSync(projectLocalConfigPath)) {
      sources.push(projectLocalConfigPath)
    }
  }

  const config = loadConfig(options)

  return {
    get<K extends keyof SidekickConfig>(key: K): SidekickConfig[K] {
      return config[key]
    },
    getAll(): SidekickConfig {
      return config
    },
    sources,
  }
}
