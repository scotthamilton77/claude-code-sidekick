/**
 * Configuration Service Module
 *
 * Implements the configuration service per docs/design/CONFIG-SYSTEM.md.
 *
 * Provides a multi-layer configuration cascade with YAML domain files:
 * - core.yaml (core: paths, logging)
 * - llm.yaml (provider settings, model selection)
 * - transcript.yaml (watchDebounceMs, metricsPersistIntervalMs)
 * - features.yaml (feature flags and feature-specific settings)
 *
 * Cascade order (lowest to highest priority):
 * 1. External YAML defaults (from assets)
 * 2. Internal defaults (Zod)
 * 3. Environment variables (SIDEKICK_* plus .env files)
 * 4. User domain config (~/.sidekick/{domain}.yaml)
 * 5. Project domain config (.sidekick/{domain}.yaml)
 * 6. Project-local overrides (.sidekick/{domain}.local.yaml)
 *
 * Key features per LLD requirements:
 * - Deep-merge semantics for nested objects (arrays are replaced)
 * - Zod schema validation with strict mode (rejects unknown keys per §6.4)
 * - Config immutability after loading (Object.freeze per §2)
 * - Sensible defaults applied via Zod transforms
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

export const DOMAIN_FILES: Record<ConfigDomain, string> = {
  core: 'core.yaml',
  llm: 'llm.yaml',
  transcript: 'transcript.yaml',
  features: 'features.yaml',
}

// =============================================================================
// Zod Schemas - Per docs/design/CONFIG-SYSTEM.md §5
// =============================================================================

// --- Core Config Schema (§5.1) ---

const LogLevelSchema = z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal'])

const LoggingSchema = z
  .object({
    level: z.enum(['debug', 'info', 'warn', 'error']),
    format: z.enum(['pretty', 'json']),
    consoleEnabled: z.boolean(),
    /** Per-component log level overrides. Keys are component names (e.g., 'reminders', 'statusline'). */
    components: z.record(z.string(), LogLevelSchema).optional(),
    /** Log rotation settings. Defaults to 10MB/5 files if not specified. */
    rotation: z
      .object({
        maxSizeBytes: z.number().min(1),
        maxFiles: z.number().min(1),
      })
      .optional(),
  })
  .strict()
  .transform((val) => ({
    ...val,
    components: val.components ?? {},
  }))

const PathsSchema = z
  .object({
    state: z.string(),
    assets: z.string().optional(),
  })
  .strict()

// Daemon and IPC defaults now come from assets/sidekick/defaults/core.defaults.yaml

const ProjectsSchema = z
  .object({
    retentionDays: z.number().min(1),
  })
  .strict()

const DaemonSchema = z
  .object({
    idleTimeoutMs: z.number().min(0),
    shutdownTimeoutMs: z.number().min(0),
    projects: ProjectsSchema.default({ retentionDays: 30 }),
  })
  .strict()

const IpcSchema = z
  .object({
    connectTimeoutMs: z.number().min(0),
    requestTimeoutMs: z.number().min(0),
    maxRetries: z.number().min(0),
    retryDelayMs: z.number().min(0),
  })
  .strict()

const DevelopmentSchema = z
  .object({
    enabled: z.boolean(),
  })
  .strict()

export const CoreConfigSchema = z
  .object({
    logging: LoggingSchema,
    paths: PathsSchema,
    daemon: DaemonSchema,
    ipc: IpcSchema,
    development: DevelopmentSchema,
  })
  .strict()

export type CoreConfig = z.infer<typeof CoreConfigSchema>

// --- LLM Config Schema (§5.2) ---

const LlmProviderSchema = z.enum(['claude-cli', 'openai', 'openrouter', 'custom', 'emulator'])

const EmulatedProviderSchema = z.enum(['claude-cli', 'openai', 'openrouter'])

/**
 * LLM Profile Schema - complete standalone configuration for an LLM.
 * Profiles are referenced by ID from features.
 * All fields are required - defaults come from YAML in assets/sidekick/defaults/llm.defaults.yaml
 */
const LlmProfileSchema = z.object({
  provider: LlmProviderSchema,
  model: z.string(),
  temperature: z.number().min(0).max(2),
  maxTokens: z.number().positive(),
  timeout: z.number().min(1).max(300),
  timeoutMaxRetries: z.number().min(0).max(10),
  // Optional fallback profile ID from fallbackProfiles namespace
  fallbackProfileId: z.string().optional(),
  // OpenRouter-specific provider routing (ignored for other providers)
  providerAllowlist: z.array(z.string()).optional(),
  providerBlocklist: z.array(z.string()).optional(),
})

export type LlmProfile = z.infer<typeof LlmProfileSchema>

// LLM defaults now come from assets/sidekick/defaults/llm.defaults.yaml

export const LlmConfigSchema = z
  .object({
    defaultProfile: z.string(),
    defaultFallbackProfileId: z.string().optional(),
    profiles: z.record(z.string(), LlmProfileSchema),
    fallbackProfiles: z.record(z.string(), LlmProfileSchema).optional(),
    global: z
      .object({
        debugDumpEnabled: z.boolean(),
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
        code: 'custom',
        message: `defaultProfile "${data.defaultProfile}" not found in profiles`,
        path: ['defaultProfile'],
        input: data.defaultProfile,
      })
    }
    // Validate defaultFallbackProfileId references an existing fallback profile
    if (data.defaultFallbackProfileId && !data.fallbackProfiles?.[data.defaultFallbackProfileId]) {
      ctx.addIssue({
        code: 'custom',
        message: `defaultFallbackProfileId "${data.defaultFallbackProfileId}" not found in fallbackProfiles`,
        path: ['defaultFallbackProfileId'],
        input: data.defaultFallbackProfileId,
      })
    }
    // Validate per-profile fallbackProfileId references
    for (const [profileName, profile] of Object.entries(data.profiles)) {
      if (profile.fallbackProfileId && !data.fallbackProfiles?.[profile.fallbackProfileId]) {
        ctx.addIssue({
          code: 'custom',
          message: `Profile "${profileName}" fallbackProfileId "${profile.fallbackProfileId}" not found in fallbackProfiles`,
          path: ['profiles', profileName, 'fallbackProfileId'],
          input: profile.fallbackProfileId,
        })
      }
    }
  })
  .transform((val) => ({
    defaultProfile: val.defaultProfile,
    defaultFallbackProfileId: val.defaultFallbackProfileId,
    profiles: val.profiles,
    fallbackProfiles: val.fallbackProfiles ?? {},
    global: val.global ?? { debugDumpEnabled: false, emulatedProvider: undefined },
  }))

export type LlmConfig = z.infer<typeof LlmConfigSchema>

// --- Transcript Config Schema (§5.3) ---

// Transcript defaults now come from assets/sidekick/defaults/transcript.defaults.yaml

export const TranscriptConfigSchema = z
  .object({
    watchDebounceMs: z.number().min(0),
    metricsPersistIntervalMs: z.number(),
  })
  .strict()

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
// All domains are required - defaults come from YAML in assets/sidekick/defaults/
export const SidekickConfigSchema = z.object({
  core: CoreConfigSchema,
  llm: LlmConfigSchema,
  transcript: TranscriptConfigSchema,
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
export function deepMerge<T extends Record<string, unknown>>(base: T, override: Record<string, unknown>): T {
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

/**
 * Coerce a string value to its appropriate type.
 * Supports: boolean, number, JSON arrays/objects, string
 */
export function coerceValue(raw: string): unknown {
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
export function setNestedValue(obj: Record<string, unknown>, path: string[], value: unknown): void {
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
export function tryReadYaml(filePath: string): Record<string, unknown> | null {
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
    throw new Error(`Failed to parse YAML at ${filePath}: ${message}`, { cause: err })
  }
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
export const EXTERNAL_DEFAULTS_FILES: Record<ConfigDomain, string> = {
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
 * 1. External YAML defaults (from assets)
 * 2. Internal defaults (via Zod)
 * 3. Environment variables
 * 4. User domain config (~/.sidekick/{domain}.yaml)
 * 5. Project domain config (.sidekick/{domain}.yaml)
 * 6. Project-local override (.sidekick/{domain}.local.yaml)
 */
function loadDomainConfig(
  domain: ConfigDomain,
  envConfig: Record<string, Record<string, unknown>>,
  userDomainPath: string,
  projectDomainPath: string | null,
  projectLocalPath: string | null,
  assets?: AssetResolver
): { config: Record<string, unknown>; sources: LoadedSource[] } {
  const sources: LoadedSource[] = []
  let merged: Record<string, unknown> = {}

  // 1. External YAML defaults (lowest priority)
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

  // 4. Project domain YAML
  if (projectDomainPath) {
    const projectDomain = tryReadYaml(projectDomainPath)
    if (projectDomain) {
      merged = deepMerge(merged, projectDomain)
      sources.push({ source: projectDomainPath, domain })
    }
  }

  // 5. Project-local override
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
  const validFallbacks = new Set(Object.keys(config.llm.fallbackProfiles))
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

  // Step 3: Build paths for domain files
  const userSidekick = join(homeDir, '.sidekick')
  const projectSidekick = projectRoot ? join(projectRoot, '.sidekick') : null

  // Step 4: Load each domain with full cascade
  const domains: ConfigDomain[] = ['core', 'llm', 'transcript', 'features']
  const domainConfigs: Record<string, Record<string, unknown>> = {}

  for (const domain of domains) {
    const filename = DOMAIN_FILES[domain]
    const userDomainPath = join(userSidekick, filename)
    const projectDomainPath = projectSidekick ? join(projectSidekick, filename) : null
    const projectLocalPath = projectSidekick
      ? join(projectSidekick, `${filename.replace('.yaml', '.local.yaml')}`)
      : null

    const { config } = loadDomainConfig(
      domain,
      envConfig,
      userDomainPath,
      projectDomainPath,
      projectLocalPath,
      options.assets
    )

    domainConfigs[domain] = config
  }

  // Step 4b: Warn about legacy sidekick.config files (no longer read)
  const legacyDirs = [userSidekick, projectSidekick].filter(Boolean) as string[]
  for (const dir of legacyDirs) {
    const legacyPath = join(dir, 'sidekick.config')
    if (existsSync(legacyPath)) {
      options.logger?.warn(
        `Legacy sidekick.config found at "${legacyPath}" — this file is no longer read. Migrate settings to .sidekick/{domain}.yaml files (core.yaml, llm.yaml, transcript.yaml, features.yaml).`
      )
    }

    // Warn about renamed config.yaml -> core.yaml
    const oldConfigPath = join(dir, 'config.yaml')
    if (existsSync(oldConfigPath)) {
      options.logger?.warn(
        `Renamed config file found at "${oldConfigPath}" — "config.yaml" has been renamed to "core.yaml". Please rename your file.`
      )
    }
    const oldConfigLocalPath = join(dir, 'config.local.yaml')
    if (existsSync(oldConfigLocalPath)) {
      options.logger?.warn(
        `Renamed config file found at "${oldConfigLocalPath}" — "config.local.yaml" has been renamed to "core.local.yaml". Please rename your file.`
      )
    }
  }

  // Step 5: Validate with Zod (applies defaults)
  const result = SidekickConfigSchema.safeParse(domainConfigs)
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')
    options.logger?.error('Configuration validation failed', { issues })
    throw new Error(`Configuration validation failed: ${issues}`)
  }

  // Step 6: Validate profile references in feature configs
  try {
    validateProfileReferences(result.data)
  } catch (err) {
    options.logger?.error('Profile reference validation failed', { error: (err as Error).message })
    throw err
  }

  // Step 7: Freeze config for immutability
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

      const projectLocalPath = join(projectSidekick, `${filename.replace('.yaml', '.local.yaml')}`)
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
