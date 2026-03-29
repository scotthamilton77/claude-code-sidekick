// packages/sidekick-core/src/api-key-detector.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Logger } from '@sidekick/types'
import type { ApiKeyHealth, ScopeStatus, UserApiKeyStatus, ProjectApiKeyStatus } from '@sidekick/types'
import { validateOpenRouterKey, validateOpenAIKey } from '@sidekick/shared-providers'

/** Default doctor timeout values in milliseconds. */
export const DOCTOR_TIMEOUTS = {
  apiKeyValidation: 10_000,
  pluginDetection: 10_000,
  pluginLiveness: 30_000,
} as const

/**
 * Get a doctor timeout value, respecting the DISABLE_DOCTOR_TIMEOUTS kill switch.
 * When DISABLE_DOCTOR_TIMEOUTS=1, returns undefined (no timeout / infinite wait).
 */
export function getDoctorTimeout(defaultMs: number): number | undefined {
  return process.env.DISABLE_DOCTOR_TIMEOUTS === '1' ? undefined : defaultMs
}

export type ApiKeyName = 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY'

/**
 * Source where an API key was found.
 * - 'env-var': Environment variable
 * - 'user-env': User-level ~/.sidekick/.env file
 * - 'project-env': Project-level .sidekick/.env file
 */
export type ApiKeySource = 'env-var' | 'user-env' | 'project-env'

/**
 * Result of detecting an API key, including where it was found.
 */
export interface ApiKeyDetectionResult {
  key: string | null
  source: ApiKeySource | null
}

/**
 * Detection result for a single scope.
 */
export interface ScopeDetectionResult {
  found: boolean
  key: string | null
  status: ScopeStatus
}

/**
 * Result of detecting an API key across all scopes.
 * Priority order: project → user → env
 */
export interface AllScopesDetectionResult {
  project: ScopeDetectionResult
  user: ScopeDetectionResult
  env: ScopeDetectionResult
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert an ApiKeyHealth or ScopeStatus string to a ScopeStatus value.
 * Maps 'healthy' and 'invalid' directly; everything else becomes 'missing'.
 */
export function toScopeStatus(health: string): ScopeStatus {
  if (health === 'healthy') return 'healthy'
  if (health === 'invalid') return 'invalid'
  if (health === 'not-required') return 'not-required'
  return 'missing'
}

/**
 * Determine overall status: healthy if any scope is used, invalid if keys found but none healthy, missing otherwise.
 */
export function determineOverallStatus(used: string | null, anyKeyFound: boolean): ScopeStatus {
  if (used) return 'healthy'
  if (anyKeyFound) return 'invalid'
  return 'missing'
}

/**
 * Read API key from a specific .env file.
 * @returns The key value if found, null otherwise.
 */
export async function readKeyFromEnvFile(envPath: string, keyName: ApiKeyName): Promise<string | null> {
  try {
    const content = await fs.readFile(envPath, 'utf-8')
    const match = content.match(new RegExp(`^${keyName}=(.+)$`, 'm'))
    if (!match) return null
    let value = match[1].trim()
    // Strip surrounding quotes (single or double)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    return value
  } catch {
    return null
  }
}

/**
 * Detect actual API key by reading .env files.
 * Priority: project .env → user .env → environment variable.
 * Returns both the key value and where it was found.
 */
export async function detectActualApiKey(
  keyName: ApiKeyName,
  projectDir: string,
  homeDir: string
): Promise<ApiKeyDetectionResult> {
  // Priority: project → user → env
  const projectKey = await readKeyFromEnvFile(path.join(projectDir, '.sidekick', '.env'), keyName)
  if (projectKey) {
    return { key: projectKey, source: 'project-env' }
  }

  const userKey = await readKeyFromEnvFile(path.join(homeDir, '.sidekick', '.env'), keyName)
  if (userKey) {
    return { key: userKey, source: 'user-env' }
  }

  if (process.env[keyName]) {
    return { key: process.env[keyName] ?? null, source: 'env-var' }
  }

  return { key: null, source: null }
}

/**
 * Detect API key across ALL scopes and optionally validate each.
 * New priority order: project → user → env
 *
 * @param keyName - The API key name (OPENROUTER_API_KEY or OPENAI_API_KEY)
 * @param projectDir - Project directory path
 * @param homeDir - Home directory path
 * @param skipValidation - If true, found keys are marked 'healthy' without validation
 * @param logger - Optional logger for debug output
 * @returns Detection results for all three scopes
 */
export async function detectAllApiKeys(
  keyName: ApiKeyName,
  projectDir: string,
  homeDir: string,
  skipValidation = false,
  logger?: Logger
): Promise<AllScopesDetectionResult> {
  const validateFn = keyName === 'OPENROUTER_API_KEY' ? validateOpenRouterKey : validateOpenAIKey

  // Check each scope independently
  const projectEnvPath = path.join(projectDir, '.sidekick', '.env')
  const userEnvPath = path.join(homeDir, '.sidekick', '.env')

  const projectKey = await readKeyFromEnvFile(projectEnvPath, keyName)
  const userKey = await readKeyFromEnvFile(userEnvPath, keyName)

  // process.env may contain keys injected by dotenv from .env files.
  // Only treat it as a real env var if it differs from file-sourced keys.
  const rawEnvKey = process.env[keyName] ?? null
  const envKey = rawEnvKey && rawEnvKey !== projectKey && rawEnvKey !== userKey ? rawEnvKey : null

  // Determine status for each scope
  const getStatus = async (key: string | null): Promise<ScopeStatus> => {
    if (!key) return 'missing'
    if (skipValidation) return 'healthy' // Assume healthy when skipping validation
    const result = await validateFn(key, logger, getDoctorTimeout(DOCTOR_TIMEOUTS.apiKeyValidation))
    return result.valid ? 'healthy' : 'invalid'
  }

  // Validate all found keys in parallel
  const [projectStatus, userStatus, envStatus] = await Promise.all([
    getStatus(projectKey),
    getStatus(userKey),
    getStatus(envKey),
  ])

  return {
    project: { found: projectKey !== null, key: projectKey, status: projectStatus },
    user: { found: userKey !== null, key: userKey, status: userStatus },
    env: { found: envKey !== null, key: envKey, status: envStatus },
  }
}

/**
 * Build UserApiKeyStatus from detection results.
 * User-level status only includes 'user' and 'env' scopes.
 * Priority for 'used': user → env (first valid)
 */
export function buildUserApiKeyStatus(detection: AllScopesDetectionResult): UserApiKeyStatus {
  // Determine which scope's key is being used (first valid in priority order)
  let used: 'user' | 'env' | null = null
  if (detection.user.status === 'healthy') {
    used = 'user'
  } else if (detection.env.status === 'healthy') {
    used = 'env'
  }

  const status = determineOverallStatus(used, detection.user.found || detection.env.found)

  return {
    used,
    status,
    scopes: {
      user: detection.user.status,
      env: detection.env.status,
    },
  }
}

/**
 * Build ProjectApiKeyStatus from detection results.
 * Project-level status includes all three scopes.
 * Priority for 'used': project → user → env (first valid)
 */
export function buildProjectApiKeyStatus(detection: AllScopesDetectionResult): ProjectApiKeyStatus {
  // Determine which scope's key is being used (first valid in priority order)
  let used: 'project' | 'user' | 'env' | null = null
  if (detection.project.status === 'healthy') {
    used = 'project'
  } else if (detection.user.status === 'healthy') {
    used = 'user'
  } else if (detection.env.status === 'healthy') {
    used = 'env'
  }

  const status = determineOverallStatus(used, detection.project.found || detection.user.found || detection.env.found)

  return {
    used,
    status,
    scopes: {
      project: detection.project.status,
      user: detection.user.status,
      env: detection.env.status,
    },
  }
}

/**
 * Build a UserApiKeyStatus from a simple health string.
 * Used when no scope-level detection is available (e.g. force mode, user opted out).
 */
export function userApiKeyStatusFromHealth(health: ApiKeyHealth): UserApiKeyStatus {
  const status = toScopeStatus(health)
  return { used: null, status, scopes: { user: 'missing', env: 'missing' } }
}

/**
 * Build a ProjectApiKeyStatus from a simple health string.
 * Used when no scope-level detection is available (e.g. force mode, user opted out).
 */
export function projectApiKeyStatusFromHealth(health: ApiKeyHealth): ProjectApiKeyStatus {
  const status = toScopeStatus(health)
  return { used: null, status, scopes: { project: 'missing', user: 'missing', env: 'missing' } }
}
