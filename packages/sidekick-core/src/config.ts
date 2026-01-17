/**
 * Configuration Service Module
 *
 * Implements Phase 2 of the Sidekick Node runtime per docs/design/CONFIG-SYSTEM.md.
 *
 * Provides a multi-layer configuration cascade with YAML domain files:
 * - config.yaml (core: paths, logging)
 * - llm.yaml (provider settings, model selection)
 * - transcript.yaml (watchDebounceMs, metricsPersistIntervalMs)
 * - features.yaml (feature flags and feature-specific settings)
 *
 * Cascade order (lowest to highest priority):
 * 1. Internal defaults (hardcoded in Zod schemas)
 * 2. Environment variables (SIDEKICK_* plus .env files)
 * 3. User unified config (~/.sidekick/sidekick.config)
 * 4. User domain config (~/.sidekick/{domain}.yaml)
 * 5. Project unified config (.sidekick/sidekick.config)
 * 6. Project domain config (.sidekick/{domain}.yaml)
 * 7. Project-local overrides (.sidekick/{domain}.yaml.local)
 *
 * Key features per LLD requirements:
 * - Deep-merge semantics for nested objects (arrays are replaced)
 * - Zod schema validation with strict mode (rejects unknown keys per §6.4)
 * - Config immutability after loading (Object.freeze per §2)
 * - Sensible defaults applied via Zod transforms
 * - sidekick.config dot-notation parsing for quick overrides
 *
 * @see docs/design/CONFIG-SYSTEM.md
 * @see docs/design/SCHEMA-CONTRACTS.md §6.4 (strict mode)
 * @see docs/ARCHITECTURE.md §3.3 Configuration Cascade
 */

import { config as loadDotenv } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { z } from 'zod/v4'
import type { AssetResolver } from './assets'
import type { Logger } from '@sidekick/types'

// =============================================================================
// Deep Freeze Utility
// =============================================================================

/**
 * Recursively freezes an object and all nested objects/arrays.
 * Per design/CONFIG-SYSTEM.md §2: Config object is immutable after loading.
 */
function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== 'object') {
    return obj
  }

  Object.freeze(obj)

  for (const key of Object.keys(obj)) {
    const value = (obj as Record<string, unknown>)[key]
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value)
    }
  }

  return obj
}

// =============================================================================
// Domain Names and File Mappings
// =============================================================================

/**
 * Configuration domains as defined in docs/design/CONFIG-SYSTEM.md §3
 */
export type ConfigDomain = 'core' | 'llm' | 'transcript' | 'features'

const DOMAIN_FILES: Record<ConfigDomain, string> = {
  core: 'config.yaml',
  llm: 'llm.yaml',
  transcript: 'transcript.yaml',
  features: 'features.yaml',
}

// =============================================================================
// Zod Schemas - Per docs/design/CONFIG-SYSTEM.md §5
// =============================================================================

// --- Core Config Schema (§5.1) ---

const LoggingSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
    format: z.enum(['pretty', 'json']).default('pretty'),
    consoleEnabled: z.boolean().default(false), // Enable console output (in addition to file)
  })
  .strict()

const PathsSchema = z
  .object({
    state: z.string().default('.sidekick'),
    assets: z.string().optional(),
  })
  .strict()

const DAEMON_DEFAULTS = {
  idleTimeoutMs: 300000, // 5 minutes
  shutdownTimeoutMs: 30000, // 30 seconds
}

const DaemonSchema = z
  .object({
    idleTimeoutMs: z.number().min(0).optional(),
    shutdownTimeoutMs: z.number().min(0).optional(),
  })
  .strict()
  .transform((val) => ({
    idleTimeoutMs: val.idleTimeoutMs ?? DAEMON_DEFAULTS.idleTimeoutMs,
    shutdownTimeoutMs: val.shutdownTimeoutMs ?? DAEMON_DEFAULTS.shutdownTimeoutMs,
  }))

const IPC_DEFAULTS = {
  connectTimeoutMs: 5000,
  requestTimeoutMs: 30000,
  maxRetries: 3,
  retryDelayMs: 100,
}

const DEVELOPMENT_DEFAULTS = {
  enabled: false,
}

const IpcSchema = z
  .object({
    connectTimeoutMs: z.number().min(0).optional(),
    requestTimeoutMs: z.number().min(0).optional(),
    maxRetries: z.number().min(0).optional(),
    retryDelayMs: z.number().min(0).optional(),
  })
  .strict()
  .transform((val) => ({
    connectTimeoutMs: val.connectTimeoutMs ?? IPC_DEFAULTS.connectTimeoutMs,
    requestTimeoutMs: val.requestTimeoutMs ?? IPC_DEFAULTS.requestTimeoutMs,
    maxRetries: val.maxRetries ?? IPC_DEFAULTS.maxRetries,
    retryDelayMs: val.retryDelayMs ?? IPC_DEFAULTS.retryDelayMs,
  }))

const DevelopmentSchema = z
  .object({
    enabled: z.boolean().default(false),
  })
  .strict()

export const CoreConfigSchema = z
  .object({
    logging: LoggingSchema.optional(),
    paths: PathsSchema.optional(),
    daemon: DaemonSchema.optional(),
    ipc: IpcSchema.optional(),
    development: DevelopmentSchema.optional(),
  })
  .strict()
  .transform((val) => ({
    logging: val.logging ?? { level: 'info' as const, format: 'pretty' as const, consoleEnabled: false },
    paths: val.paths ?? { state: '.sidekick' },
    daemon: val.daemon ?? DAEMON_DEFAULTS,
    ipc: val.ipc ?? IPC_DEFAULTS,
    development: val.development ?? DEVELOPMENT_DEFAULTS,
  }))

export type CoreConfig = z.infer<typeof CoreConfigSchema>

// --- LLM Config Schema (§5.2) ---

const LlmProviderSchema = z.enum(['claude-cli', 'openai', 'openrouter', 'custom', 'emulator'])

const EmulatedProviderSchema = z.enum(['claude-cli', 'openai', 'openrouter'])

/**
 * LLM Profile Schema - complete standalone configuration for an LLM.
 * Profiles are referenced by ID from features.
 */
const LlmProfileSchema = z.object({
  provider: LlmProviderSchema.default('openrouter'),
  model: z.string().default('x-ai/grok-4-fast'),
  temperature: z.number().min(0).max(2).default(0),
  maxTokens: z.number().positive().default(4096),
  timeout: z.number().min(1).max(300).default(30),
  timeoutMaxRetries: z.number().min(0).max(10).default(3),
})

export type LlmProfile = z.infer<typeof LlmProfileSchema>

const LLM_PROFILE_DEFAULTS = {
  'fast-lite': {
    provider: 'openrouter' as const,
    model: 'google/gemini-2.0-flash-lite-001',
    temperature: 0,
    maxTokens: 1000,
    timeout: 15,
    timeoutMaxRetries: 2,
  },
}

const LLM_DEFAULTS = {
  defaultProfile: 'fast-lite',
  debugDumpEnabled: false,
}

export const LlmConfigSchema = z
  .object({
    defaultProfile: z.string().default(LLM_DEFAULTS.defaultProfile),
    profiles: z.record(z.string(), LlmProfileSchema).default(LLM_PROFILE_DEFAULTS),
    fallbacks: z.record(z.string(), LlmProfileSchema).optional(),
    global: z
      .object({
        debugDumpEnabled: z.boolean().optional(),
        emulatedProvider: EmulatedProviderSchema.optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((data, ctx) => {
    // Validate defaultProfile references an existing profile
    if (!data.profiles[data.defaultProfile]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `defaultProfile "${data.defaultProfile}" not found in profiles`,
        path: ['defaultProfile'],
      })
    }
  })
  .transform((val) => ({
    defaultProfile: val.defaultProfile,
    profiles: val.profiles,
    fallbacks: val.fallbacks ?? {},
    global: {
      debugDumpEnabled: val.global?.debugDumpEnabled ?? LLM_DEFAULTS.debugDumpEnabled,
      emulatedProvider: val.global?.emulatedProvider,
    },
  }))

export type LlmConfig = z.infer<typeof LlmConfigSchema>

// --- Transcript Config Schema (§5.3) ---

const TRANSCRIPT_DEFAULTS = {
  watchDebounceMs: 100,
  metricsPersistIntervalMs: 5000,
}

export const TranscriptConfigSchema = z
  .object({
    watchDebounceMs: z.number().min(0).optional(),
    metricsPersistIntervalMs: z.number().optional(),
  })
  .strict()
  .transform((val) => ({
    watchDebounceMs: val.watchDebounceMs ?? TRANSCRIPT_DEFAULTS.watchDebounceMs,
    metricsPersistIntervalMs: val.metricsPersistIntervalMs ?? TRANSCRIPT_DEFAULTS.metricsPersistIntervalMs,
  }))

export type TranscriptConfig = z.infer<typeof TranscriptConfigSchema>

// --- Features Config Schema (§5.4) ---

const FeatureSettingsSchema = z.record(z.string(), z.unknown())

const FeatureEntrySchema = z
  .object({
    enabled: z.boolean().optional(),
    settings: FeatureSettingsSchema.optional(),
  })
  .strict()
  .transform((val) => ({
    enabled: val.enabled ?? true,
    settings: val.settings ?? {},
  }))

export const FeaturesConfigSchema = z
  .record(z.string(), FeatureEntrySchema)
  .optional()
  .transform((val) => val ?? {})

export type FeatureConfig = z.infer<typeof FeatureEntrySchema>
export type FeaturesConfig = z.infer<typeof FeaturesConfigSchema>

// --- Unified Config Type (§5.5) ---

export interface SidekickConfig {
  core: CoreConfig
  llm: LlmConfig
  transcript: TranscriptConfig
  features: FeaturesConfig
}

// Combined schema for full validation
export const SidekickConfigSchema = z.object({
  core: CoreConfigSchema.optional().transform(
    (val) =>
      val ?? {
        logging: { level: 'info' as const, format: 'pretty' as const, consoleEnabled: false },
        paths: { state: '.sidekick' },
        daemon: DAEMON_DEFAULTS,
        ipc: IPC_DEFAULTS,
        development: DEVELOPMENT_DEFAULTS,
      }
  ),
  llm: LlmConfigSchema.optional().transform(
    (val) =>
      val ?? {
        defaultProfile: LLM_DEFAULTS.defaultProfile,
        profiles: LLM_PROFILE_DEFAULTS,
        fallbacks: {},
        global: {
          debugDumpEnabled: LLM_DEFAULTS.debugDumpEnabled,
          emulatedProvider: undefined,
        },
      }
  ),
  transcript: TranscriptConfigSchema.optional().transform((val) => val ?? TRANSCRIPT_DEFAULTS),
  features: FeaturesConfigSchema,
})

// =============================================================================
// Deep Merge Utility
// =============================================================================

/**
 * Deep merge two objects. Per CONFIG-SYSTEM.md §4.1:
 * - Objects: Deep merged
 * - Arrays: Replaced (higher priority replaces lower)
 * - Primitives: Replaced
 */
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

// =============================================================================
// Unified Config (sidekick.config) Parser
// =============================================================================

/**
 * Result of parsing a unified config file.
 */
interface ParsedUnifiedConfig {
  config: Record<string, Record<string, unknown>>
  /** Parsed key-value pairs for logging */
  overrides: Array<{ key: string; value: unknown }>
  /** Warnings about malformed lines */
  warnings: string[]
}

/**
 * Parse a sidekick.config file with bash-style dot-notation.
 * Per docs/design/CONFIG-SYSTEM.md §4.2
 *
 * Format:
 * - Lines starting with # are comments
 * - Format: domain.path.to.key=value
 * - Values are coerced to appropriate types (number, boolean, string)
 * - Arrays use JSON syntax: some.array=["a","b","c"]
 */
function parseUnifiedConfig(content: string, sourcePath?: string): ParsedUnifiedConfig {
  const result: Record<string, Record<string, unknown>> = {}
  const overrides: Array<{ key: string; value: unknown }> = []
  const warnings: string[] = []
  const sourceLabel = sourcePath ?? 'sidekick.config'

  const lines = content.split('\n')
  for (let lineNum = 0; lineNum < lines.length; lineNum++) {
    const line = lines[lineNum]
    const trimmed = line.trim()

    // Skip empty lines and comments
    if (!trimmed || trimmed.startsWith('#')) {
      continue
    }

    // Find delimiter (= or :)
    const eqIndex = trimmed.indexOf('=')
    const colonIndex = trimmed.indexOf(':')

    // Use whichever comes first, preferring = if both present
    if (eqIndex === -1 && colonIndex === -1) {
      warnings.push(`${sourceLabel}:${lineNum + 1}: malformed line (missing '=' or ':'): ${trimmed}`)
      continue
    }
    const delimIndex = eqIndex === -1 ? colonIndex : colonIndex === -1 ? eqIndex : Math.min(eqIndex, colonIndex)

    const key = trimmed.substring(0, delimIndex).trim()
    const rawValue = trimmed.substring(delimIndex + 1).trim()

    // Parse the key path (e.g., "llm.provider" -> ["llm", "provider"])
    const parts = key.split('.')
    if (parts.length < 2) {
      // Invalid format - need at least domain.key
      warnings.push(`${sourceLabel}:${lineNum + 1}: invalid key format (need domain.key): ${key}`)
      continue
    }

    // First part is the domain
    const domain = parts[0]
    const path = parts.slice(1)

    // Coerce value to appropriate type
    const value = coerceValue(rawValue)

    // Build nested structure
    if (!result[domain]) {
      result[domain] = {}
    }

    setNestedValue(result[domain], path, value)
    overrides.push({ key, value })
  }

  return { config: result, overrides, warnings }
}

/**
 * Coerce a string value to its appropriate type.
 * Supports: boolean, number, JSON arrays/objects, string
 */
function coerceValue(raw: string): unknown {
  // Boolean
  if (raw === 'true') return true
  if (raw === 'false') return false

  // Number
  const num = Number(raw)
  if (!isNaN(num) && raw !== '') return num

  // JSON array or object
  if ((raw.startsWith('[') && raw.endsWith(']')) || (raw.startsWith('{') && raw.endsWith('}'))) {
    try {
      return JSON.parse(raw)
    } catch {
      // Fall through to string
    }
  }

  // String (remove quotes if present)
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }

  return raw
}

/**
 * Set a nested value in an object given a path array.
 */
function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
  let current = obj
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    if (!(key in current) || typeof current[key] !== 'object' || current[key] === null) {
      current[key] = {}
    }
    current = current[key] as Record<string, unknown>
  }
  current[path[path.length - 1]] = value
}

// =============================================================================
// YAML File Loading
// =============================================================================

/**
 * Try to read and parse a YAML file. Returns null if file doesn't exist.
 * Throws on parse errors.
 */
function tryReadYaml(filePath: string): Record<string, unknown> | null {
  if (!existsSync(filePath)) {
    return null
  }

  const content = readFileSync(filePath, 'utf8')

  try {
    const parsed = parseYaml(content) as Record<string, unknown> | null
    // YAML.parse returns undefined/null for empty files
    return parsed ?? {}
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new Error(`Failed to parse YAML at ${filePath}: ${message}`)
  }
}

/**
 * Try to read a unified config file. Returns null if file doesn't exist.
 */
function tryReadUnifiedConfig(filePath: string): ParsedUnifiedConfig | null {
  if (!existsSync(filePath)) {
    return null
  }

  const content = readFileSync(filePath, 'utf8')
  return parseUnifiedConfig(content, filePath)
}

// =============================================================================
// Environment Variable Loading
// =============================================================================

/**
 * Load environment files in cascade order.
 * Per docs/design/CONFIG-SYSTEM.md §4: env is layer 2.
 */
function loadEnvFiles(homeDir: string, projectRoot?: string): void {
  const envPaths: string[] = []

  // User env (~/.sidekick/.env)
  const userEnv = join(homeDir, '.sidekick', '.env')
  if (existsSync(userEnv)) {
    envPaths.push(userEnv)
  }

  if (projectRoot) {
    // Project .sidekick/.env
    const projectEnv = join(projectRoot, '.sidekick', '.env')
    if (existsSync(projectEnv)) {
      envPaths.push(projectEnv)
    }

    // Project .sidekick/.env.local (highest env priority)
    const projectLocalEnv = join(projectRoot, '.sidekick', '.env.local')
    if (existsSync(projectLocalEnv)) {
      envPaths.push(projectLocalEnv)
    }
  }

  // Load in order (each subsequent file overrides previous values)
  for (const envPath of envPaths) {
    loadDotenv({ path: envPath, override: true, quiet: true })
  }
}

/**
 * Map environment variables to config structure.
 * Uses SIDEKICK_* prefix with underscore-to-path mapping.
 */
function envToConfig(env: NodeJS.ProcessEnv): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {}

  // Define explicit mappings for environment variables
  const mappings: Record<string, { domain: ConfigDomain; path: string[] }> = {
    // Core domain
    SIDEKICK_LOG_LEVEL: { domain: 'core', path: ['logging', 'level'] },
    SIDEKICK_LOG_FORMAT: { domain: 'core', path: ['logging', 'format'] },
    SIDEKICK_STATE_PATH: { domain: 'core', path: ['paths', 'state'] },
    SIDEKICK_ASSETS_PATH: { domain: 'core', path: ['paths', 'assets'] },
    SIDEKICK_DEVELOPMENT_ENABLED: { domain: 'core', path: ['development', 'enabled'] },

    // LLM domain (profile-based - limited env var support)
    SIDEKICK_EMULATED_PROVIDER: { domain: 'llm', path: ['global', 'emulatedProvider'] },
    SIDEKICK_LLM_DEBUG_DUMP: { domain: 'llm', path: ['global', 'debugDumpEnabled'] },

    // Transcript domain
    SIDEKICK_TRANSCRIPT_WATCH_DEBOUNCE: { domain: 'transcript', path: ['watchDebounceMs'] },
    SIDEKICK_TRANSCRIPT_METRICS_INTERVAL: { domain: 'transcript', path: ['metricsPersistIntervalMs'] },
  }

  for (const [envKey, mapping] of Object.entries(mappings)) {
    const val = env[envKey]
    if (val !== undefined) {
      if (!result[mapping.domain]) {
        result[mapping.domain] = {}
      }
      setNestedValue(result[mapping.domain], mapping.path, coerceValue(val))
    }
  }

  return result
}

// =============================================================================
// Config Loading
// =============================================================================

export interface ConfigServiceOptions {
  projectRoot?: string
  homeDir?: string
  /** AssetResolver for loading external defaults from YAML files */
  assets?: AssetResolver
  /** Logger for config loading diagnostics (overrides, warnings) */
  logger?: Logger
}

interface LoadedSource {
  source: string
  domain?: ConfigDomain
}

/**
 * External YAML defaults file paths by domain.
 * These are loaded from assets as Layer 0 of the cascade.
 */
const EXTERNAL_DEFAULTS_FILES: Record<ConfigDomain, string> = {
  core: 'defaults/core.defaults.yaml',
  llm: 'defaults/llm.defaults.yaml',
  transcript: 'defaults/transcript.defaults.yaml',
  features: 'defaults/features.defaults.yaml',
}

/**
 * Load external defaults from YAML asset files.
 * Returns null if no asset resolver provided or file not found.
 */
function loadExternalDefaults(domain: ConfigDomain, assets?: AssetResolver): Record<string, unknown> | null {
  if (!assets) {
    return null
  }

  const filePath = EXTERNAL_DEFAULTS_FILES[domain]
  return assets.resolveYaml<Record<string, unknown>>(filePath) ?? null
}

/**
 * Load domain configuration with full cascade.
 *
 * Cascade order per docs/design/CONFIG-SYSTEM.md §4:
 * 0. External YAML defaults (from assets)
 * 1. Internal defaults (via Zod)
 * 2. Environment variables
 * 3. User domain config (~/.sidekick/{domain}.yaml)
 * 4. User unified config (~/.sidekick/sidekick.config) - overrides domain YAML
 * 5. Project domain config (.sidekick/{domain}.yaml)
 * 6. Project unified config (.sidekick/sidekick.config) - overrides domain YAML
 * 7. Project-local override (.sidekick/{domain}.yaml.local)
 */
function loadDomainConfig(
  domain: ConfigDomain,
  envConfig: Record<string, Record<string, unknown>>,
  userUnified: Record<string, Record<string, unknown>> | null,
  userDomainPath: string,
  projectUnified: Record<string, Record<string, unknown>> | null,
  projectDomainPath: string | null,
  projectLocalPath: string | null,
  assets?: AssetResolver
): { config: Record<string, unknown>; sources: LoadedSource[] } {
  const sources: LoadedSource[] = []
  let merged: Record<string, unknown> = {}

  // 0. External YAML defaults (Layer 0 - lowest priority)
  const externalDefaults = loadExternalDefaults(domain, assets)
  if (externalDefaults) {
    merged = deepMerge(merged, externalDefaults)
    sources.push({ source: `assets:${EXTERNAL_DEFAULTS_FILES[domain]}`, domain })
  }

  // 2. Environment variables for this domain
  if (envConfig[domain]) {
    merged = deepMerge(merged, envConfig[domain])
    sources.push({ source: 'environment', domain })
  }

  // 3. User domain YAML
  const userDomain = tryReadYaml(userDomainPath)
  if (userDomain) {
    merged = deepMerge(merged, userDomain)
    sources.push({ source: userDomainPath, domain })
  }

  // 4. User unified config (sidekick.config overrides domain YAML)
  if (userUnified?.[domain]) {
    merged = deepMerge(merged, userUnified[domain])
    sources.push({ source: 'user:sidekick.config', domain })
  }

  // 5. Project domain YAML
  if (projectDomainPath) {
    const projectDomain = tryReadYaml(projectDomainPath)
    if (projectDomain) {
      merged = deepMerge(merged, projectDomain)
      sources.push({ source: projectDomainPath, domain })
    }
  }

  // 6. Project unified config (sidekick.config overrides domain YAML)
  if (projectUnified?.[domain]) {
    merged = deepMerge(merged, projectUnified[domain])
    sources.push({ source: 'project:sidekick.config', domain })
  }

  // 7. Project-local override
  if (projectLocalPath) {
    const projectLocal = tryReadYaml(projectLocalPath)
    if (projectLocal) {
      merged = deepMerge(merged, projectLocal)
      sources.push({ source: projectLocalPath, domain })
    }
  }

  return { config: merged, sources }
}

/**
 * Validate that all profile references in feature configs point to valid profiles.
 * Called after Zod parsing to ensure referential integrity.
 */
function validateProfileReferences(config: SidekickConfig): void {
  const validProfiles = new Set(Object.keys(config.llm.profiles))
  const validFallbacks = new Set(Object.keys(config.llm.fallbacks))
  const errors: string[] = []

  for (const [featureName, featureConfig] of Object.entries(config.features)) {
    const llmConfig = featureConfig.settings?.llm
    if (!llmConfig || typeof llmConfig !== 'object') continue

    for (const [subFeature, subConfig] of Object.entries(llmConfig as Record<string, unknown>)) {
      if (typeof subConfig !== 'object' || subConfig === null) continue
      const sub = subConfig as Record<string, unknown>

      // profile must reference a primary profile (not a fallback)
      if (typeof sub.profile === 'string') {
        if (!validProfiles.has(sub.profile)) {
          errors.push(`features.${featureName}.settings.llm.${subFeature}.profile: Unknown profile "${sub.profile}"`)
        }
        if (validFallbacks.has(sub.profile)) {
          errors.push(
            `features.${featureName}.settings.llm.${subFeature}.profile: "${sub.profile}" is a fallback profile, not a primary profile`
          )
        }
      }

      // fallbackProfile must reference a fallback profile
      if (typeof sub.fallbackProfile === 'string' && !validFallbacks.has(sub.fallbackProfile)) {
        errors.push(
          `features.${featureName}.settings.llm.${subFeature}.fallbackProfile: Unknown fallback "${sub.fallbackProfile}"`
        )
      }
    }
  }

  if (errors.length > 0) {
    throw new Error(`Invalid profile references:\n${errors.join('\n')}`)
  }
}

/**
 * Load and validate the full Sidekick configuration.
 */
export function loadConfig(options: ConfigServiceOptions): SidekickConfig {
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot

  // Step 1: Load env files (populates process.env)
  loadEnvFiles(homeDir, projectRoot)

  // Step 2: Parse env vars into domain structure
  const envConfig = envToConfig(process.env)

  // Step 3: Load unified config files
  const userUnifiedPath = join(homeDir, '.sidekick', 'sidekick.config')
  const userUnifiedParsed = tryReadUnifiedConfig(userUnifiedPath)

  const projectUnifiedPath = projectRoot ? join(projectRoot, '.sidekick', 'sidekick.config') : null
  const projectUnifiedParsed = projectUnifiedPath ? tryReadUnifiedConfig(projectUnifiedPath) : null

  // Extract config objects for domain loading
  const userUnified = userUnifiedParsed?.config ?? null
  const projectUnified = projectUnifiedParsed?.config ?? null

  // Step 4: Build paths for domain files
  const userSidekick = join(homeDir, '.sidekick')
  const projectSidekick = projectRoot ? join(projectRoot, '.sidekick') : null

  // Step 5: Load each domain with full cascade
  const domains: ConfigDomain[] = ['core', 'llm', 'transcript', 'features']
  const domainConfigs: Record<string, Record<string, unknown>> = {}

  for (const domain of domains) {
    const filename = DOMAIN_FILES[domain]
    const userDomainPath = join(userSidekick, filename)
    const projectDomainPath = projectSidekick ? join(projectSidekick, filename) : null
    const projectLocalPath = projectSidekick ? join(projectSidekick, `${filename}.local`) : null

    const { config } = loadDomainConfig(
      domain,
      envConfig,
      userUnified,
      userDomainPath,
      projectUnified,
      projectDomainPath,
      projectLocalPath,
      options.assets
    )

    domainConfigs[domain] = config
  }

  // Step 6: Validate with Zod (applies defaults)
  const result = SidekickConfigSchema.safeParse(domainConfigs)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    options.logger?.error('Configuration validation failed', { issues })
    throw new Error(`Configuration validation failed: ${issues}`)
  }

  // Step 7: Validate profile references in feature configs
  try {
    validateProfileReferences(result.data)
  } catch (err) {
    options.logger?.error('Profile reference validation failed', { error: (err as Error).message })
    throw err
  }

  // Step 8: Freeze config for immutability
  return deepFreeze(result.data)
}

// =============================================================================
// ConfigService
// =============================================================================

export interface ConfigService {
  /** Get a specific domain config */
  get core(): CoreConfig
  get llm(): LlmConfig
  get transcript(): TranscriptConfig
  get features(): FeaturesConfig

  /** Get the full config object */
  getAll(): SidekickConfig

  /** Get a specific feature's config */
  getFeature<T = Record<string, unknown>>(name: string): FeatureConfig & { settings: T }

  /** Sources loaded for debugging */
  sources: string[]
}

/**
 * Load feature defaults from YAML.
 * The YAML file is expected to have nested structure: { enabled, settings }.
 */
function loadFeatureDefaults(
  featureName: string,
  assets?: AssetResolver,
  logger?: Logger
): { enabled: boolean; settings: Record<string, unknown> } | null {
  if (!assets) {
    logger?.debug('loadFeatureDefaults: no assets resolver', { featureName })
    return null
  }

  const filePath = `defaults/features/${featureName}.defaults.yaml`
  const resolvedPath = assets.resolvePath(filePath)
  logger?.debug('loadFeatureDefaults: resolving YAML', {
    featureName,
    filePath,
    resolvedPath,
    cascadeLayers: assets.cascadeLayers,
  })

  const defaults = assets.resolveYaml<Record<string, unknown>>(filePath)

  if (!defaults) {
    logger?.debug('loadFeatureDefaults: YAML not found or empty', { featureName, filePath })
    return null
  }

  // Expect YAML to already have { enabled, settings } structure
  const validated = FeatureEntrySchema.parse(defaults)
  logger?.debug('loadFeatureDefaults: loaded and validated', {
    featureName,
    enabled: validated.enabled,
    settingsKeys: Object.keys(validated.settings),
    settings: validated.settings,
  })
  return validated
}

export function createConfigService(options: ConfigServiceOptions): ConfigService {
  const homeDir = options.homeDir ?? homedir()
  const projectRoot = options.projectRoot
  const assets = options.assets
  const logger = options.logger

  // Collect sources for debugging
  const sources: string[] = []

  // Load env files
  loadEnvFiles(homeDir, projectRoot)

  // Check for env config
  const envConfig = envToConfig(process.env)
  if (Object.keys(envConfig).length > 0) {
    sources.push('environment')
  }

  // Check for unified config files and log their contents
  const userUnifiedPath = join(homeDir, '.sidekick', 'sidekick.config')
  const userUnifiedParsed = tryReadUnifiedConfig(userUnifiedPath)
  if (userUnifiedParsed) {
    sources.push(userUnifiedPath)
    // Log warnings about malformed lines
    for (const warning of userUnifiedParsed.warnings) {
      logger?.warn('Config parse warning', { warning })
    }
    // Log overrides at info level
    if (userUnifiedParsed.overrides.length > 0 && logger) {
      logger.info('User config overrides loaded', {
        source: userUnifiedPath,
        overrides: userUnifiedParsed.overrides,
      })
    }
  }

  const projectUnifiedPath = projectRoot ? join(projectRoot, '.sidekick', 'sidekick.config') : null
  const projectUnifiedParsed = projectUnifiedPath ? tryReadUnifiedConfig(projectUnifiedPath) : null
  if (projectUnifiedParsed) {
    sources.push(projectUnifiedPath!)
    // Log warnings about malformed lines
    for (const warning of projectUnifiedParsed.warnings) {
      logger?.warn('Config parse warning', { warning })
    }
    // Log overrides at info level
    if (projectUnifiedParsed.overrides.length > 0 && logger) {
      logger.info('Project config overrides loaded', {
        source: projectUnifiedPath,
        overrides: projectUnifiedParsed.overrides,
      })
    }
  }

  // Check for domain files
  const userSidekick = join(homeDir, '.sidekick')
  const projectSidekick = projectRoot ? join(projectRoot, '.sidekick') : null

  for (const domain of Object.keys(DOMAIN_FILES) as ConfigDomain[]) {
    const filename = DOMAIN_FILES[domain]
    const userDomainPath = join(userSidekick, filename)
    if (existsSync(userDomainPath)) {
      sources.push(userDomainPath)
    }

    if (projectSidekick) {
      const projectDomainPath = join(projectSidekick, filename)
      if (existsSync(projectDomainPath)) {
        sources.push(projectDomainPath)
      }

      const projectLocalPath = join(projectSidekick, `${filename}.local`)
      if (existsSync(projectLocalPath)) {
        sources.push(projectLocalPath)
      }
    }
  }

  const config = loadConfig(options)

  return {
    get core(): CoreConfig {
      return config.core
    },
    get llm(): LlmConfig {
      return config.llm
    },
    get transcript(): TranscriptConfig {
      return config.transcript
    },
    get features(): FeaturesConfig {
      return config.features
    },
    getAll(): SidekickConfig {
      return config
    },
    getFeature<T = Record<string, unknown>>(name: string): FeatureConfig & { settings: T } {
      // Load external feature defaults (if available)
      const externalDefaults = loadFeatureDefaults(name, assets, logger)

      // Get user/project feature config
      const userConfig = config.features[name]

      logger?.debug('getFeature: loaded configs', {
        featureName: name,
        hasExternalDefaults: !!externalDefaults,
        hasUserConfig: !!userConfig,
        externalSettings: externalDefaults?.settings,
        userSettings: userConfig?.settings,
      })

      // If no external defaults and no user config, return standard defaults
      if (!externalDefaults && !userConfig) {
        logger?.debug('getFeature: returning empty defaults (no external, no user)', { featureName: name })
        return { enabled: true, settings: {} } as FeatureConfig & { settings: T }
      }

      // If no external defaults, return user config as-is
      if (!externalDefaults) {
        logger?.debug('getFeature: returning user config only', { featureName: name, settings: userConfig?.settings })
        return userConfig as FeatureConfig & { settings: T }
      }

      // If no user config, return external defaults
      if (!userConfig) {
        logger?.debug('getFeature: returning external defaults only', {
          featureName: name,
          settings: externalDefaults.settings,
        })
        return externalDefaults as FeatureConfig & { settings: T }
      }

      // Deep merge: external defaults as base, user config as override
      const mergedSettings = deepMerge(externalDefaults.settings, userConfig.settings)

      logger?.debug('getFeature: returning merged config', {
        featureName: name,
        mergedSettings,
      })

      return {
        // User enabled takes precedence if explicitly set
        enabled: userConfig.enabled,
        settings: mergedSettings,
      } as FeatureConfig & { settings: T }
    },
    sources,
  }
}

// =============================================================================
// Exported Utilities
// =============================================================================

export { parseUnifiedConfig }
