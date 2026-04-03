// packages/sidekick-core/src/doctor-engine.ts
import type { Logger } from '@sidekick/types'
import type { UserSetupStatus, ProjectSetupStatus, ApiKeyHealth, StatuslineStatus, ScopeStatus } from '@sidekick/types'
import {
  type ApiKeyName,
  toScopeStatus,
  detectAllApiKeys,
  buildProjectApiKeyStatus,
  buildUserApiKeyStatus,
} from './api-key-detector.js'
import { detectActualStatusline } from './plugin-detector.js'

export interface DoctorCheckOptions {
  /** Skip API key validation (for faster checks or when offline) */
  skipValidation?: boolean
}

export interface DoctorItemResult {
  actual: string
  cached: string
  fixed: boolean
}

export interface DoctorApiKeyResult extends DoctorItemResult {
  /** Which scope's key is being used (first valid in priority order) */
  used: 'project' | 'user' | 'env' | null
  /** Per-scope status breakdown */
  scopes: {
    project: ScopeStatus
    user: ScopeStatus
    env: ScopeStatus
  }
}

export interface DoctorCheckResult {
  userSetupExists: boolean
  statusline: DoctorItemResult
  apiKeys: Record<ApiKeyName, DoctorApiKeyResult>
  overallHealth: 'healthy' | 'unhealthy'
  fixes: string[]
}

/**
 * Status file I/O interface used by the doctor engine.
 * Decouples doctor reconciliation from the specific file-management implementation.
 */
export interface StatusFileIO {
  getUserStatus(): Promise<UserSetupStatus | null>
  getProjectStatus(): Promise<ProjectSetupStatus | null>
  writeUserStatus(status: UserSetupStatus): Promise<void>
  writeProjectStatus(status: ProjectSetupStatus): Promise<void>
  updateUserStatus(updates: Partial<Omit<UserSetupStatus, 'version'>>): Promise<void>
  updateProjectStatus(updates: Partial<Omit<ProjectSetupStatus, 'version'>>): Promise<void>
  getEffectiveApiKeyHealth(key: ApiKeyName): Promise<ApiKeyHealth>
  getStatuslineStatus(): Promise<StatuslineStatus>
}

/**
 * Run a doctor check that compares actual config state with cache,
 * updates cache if mismatched, and reports what was fixed.
 */
export async function runDoctorCheck(
  projectDir: string,
  homeDir: string,
  io: StatusFileIO,
  options: DoctorCheckOptions = {},
  logger?: Logger
): Promise<DoctorCheckResult> {
  const fixes: string[] = []

  // Check statusline
  const actualStatusline = await detectActualStatusline(projectDir, homeDir)
  const cachedStatusline = await io.getStatuslineStatus()
  // Fix cache if actual differs from cached and statusline IS configured somewhere
  const statuslineFixed = actualStatusline !== cachedStatusline && actualStatusline !== 'none'

  if (statuslineFixed) {
    fixes.push(`Statusline was actually configured at ${actualStatusline} level (updated cache)`)
    // Update the cache - prefer project status if key is at project level
    if (actualStatusline === 'project' || actualStatusline === 'both') {
      const projectStatus = await io.getProjectStatus()
      if (projectStatus) {
        await io.updateProjectStatus({ statusline: actualStatusline })
      } else {
        // Create new project status (projectStatus is null here)
        await io.writeProjectStatus({
          version: 1,
          lastUpdatedAt: new Date().toISOString(),
          autoConfigured: false,
          statusline: actualStatusline,
          apiKeys: {
            OPENROUTER_API_KEY: 'user',
            OPENAI_API_KEY: 'user',
          },
          gitignore: 'unknown',
        })
      }
    } else {
      // 'user' level - update user status
      const userStatus = await io.getUserStatus()
      if (userStatus) {
        await io.updateUserStatus({ statusline: actualStatusline })
      } else {
        // Create new user status
        await io.writeUserStatus({
          version: 1,
          lastUpdatedAt: new Date().toISOString(),
          preferences: {
            autoConfigureProjects: false,
            defaultStatuslineScope: 'user',
            defaultApiKeyScope: 'user',
          },
          statusline: actualStatusline,
          apiKeys: {
            OPENROUTER_API_KEY: 'missing',
            OPENAI_API_KEY: 'not-required',
          },
        })
      }
    }
  }

  // Check API keys using new all-scopes detection
  const apiKeyResults: Record<ApiKeyName, DoctorApiKeyResult> = {} as Record<ApiKeyName, DoctorApiKeyResult>
  const keysToCheck: ApiKeyName[] = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY']

  // Detect all keys and cached health in parallel (IO-bound operations)
  const [detections, cachedHealthValues] = await Promise.all([
    Promise.all(
      keysToCheck.map((keyName) => detectAllApiKeys(keyName, projectDir, homeDir, options.skipValidation, logger))
    ),
    Promise.all(keysToCheck.map((keyName) => io.getEffectiveApiKeyHealth(keyName))),
  ])

  // Process results and update caches sequentially (writes have ordering dependencies)
  for (let i = 0; i < keysToCheck.length; i++) {
    const keyName = keysToCheck[i]
    const detection = detections[i]
    const cachedHealth = cachedHealthValues[i]
    const projectApiKeyStatus = buildProjectApiKeyStatus(detection)

    const actualHealth = toScopeStatus(projectApiKeyStatus.status) as ApiKeyHealth

    // Fix cache in BOTH directions
    const anyKeyPresent = detection.project.found || detection.user.found || detection.env.found
    const cacheNeedsUpdate =
      (anyKeyPresent && cachedHealth === 'missing') ||
      (!anyKeyPresent && cachedHealth !== 'missing' && cachedHealth !== 'not-required')
    const keyFixed = cacheNeedsUpdate

    if (keyFixed) {
      const state = anyKeyPresent ? 'present' : 'missing'
      fixes.push(`${keyName} was actually ${state} (updated cache)`)

      // Update cache with new comprehensive status
      // Always write to project status since it has more complete info
      const projectStatus = await io.getProjectStatus()
      if (projectStatus) {
        await io.updateProjectStatus({
          apiKeys: { ...projectStatus.apiKeys, [keyName]: projectApiKeyStatus },
        })
      } else {
        // Build user status for user-level file
        const userApiKeyStatus = buildUserApiKeyStatus(detection)

        // Create project status with comprehensive info (projectStatus is null here)
        await io.writeProjectStatus({
          version: 1,
          lastUpdatedAt: new Date().toISOString(),
          autoConfigured: false,
          statusline: actualStatusline,
          apiKeys: {
            OPENROUTER_API_KEY: keyName === 'OPENROUTER_API_KEY' ? projectApiKeyStatus : 'user',
            OPENAI_API_KEY: keyName === 'OPENAI_API_KEY' ? projectApiKeyStatus : 'user',
          },
          gitignore: 'unknown',
        })

        // Also create user status if it doesn't exist
        const userStatus = await io.getUserStatus()
        if (!userStatus) {
          await io.writeUserStatus({
            version: 1,
            lastUpdatedAt: new Date().toISOString(),
            preferences: {
              autoConfigureProjects: false,
              defaultStatuslineScope: 'user',
              defaultApiKeyScope: 'user',
            },
            statusline: actualStatusline,
            apiKeys: {
              OPENROUTER_API_KEY: keyName === 'OPENROUTER_API_KEY' ? userApiKeyStatus : 'missing',
              OPENAI_API_KEY: keyName === 'OPENAI_API_KEY' ? userApiKeyStatus : 'not-required',
            },
          })
        }
      }
    }

    apiKeyResults[keyName] = {
      actual: actualHealth,
      cached: cachedHealth,
      fixed: keyFixed,
      used: projectApiKeyStatus.used,
      scopes: projectApiKeyStatus.scopes,
    }
  }

  // Reconcile user status file independently — the main loop above
  // updates project status but may skip user status when project is already correct
  const currentUserStatus = await io.getUserStatus()
  if (currentUserStatus) {
    let userNeedsUpdate = false
    const updatedUserApiKeys = { ...currentUserStatus.apiKeys }

    for (let i = 0; i < keysToCheck.length; i++) {
      const keyName = keysToCheck[i]
      const detection = detections[i]
      const expectedUserStatus = buildUserApiKeyStatus(detection)
      const currentUserEntry = currentUserStatus.apiKeys[keyName]

      // User status entries may be legacy string format or new object format
      const currentStatus =
        typeof currentUserEntry === 'object' ? currentUserEntry.status : (currentUserEntry ?? 'missing')

      // 'not-required' is a user preference (opt-out), not a detection result — preserve it
      if (
        currentStatus !== 'not-required' &&
        toScopeStatus(currentStatus) !== toScopeStatus(expectedUserStatus.status)
      ) {
        updatedUserApiKeys[keyName] = expectedUserStatus
        userNeedsUpdate = true
      }
    }

    if (userNeedsUpdate) {
      await io.updateUserStatus({
        apiKeys: updatedUserApiKeys,
        lastUpdatedAt: new Date().toISOString(),
      })
      fixes.push('Updated stale user setup-status with current API key status')
    }
  }

  // Check if user setup-status file exists (reuse read from reconciliation block)
  const userSetupExists = currentUserStatus !== null

  // Determine overall health
  // Statusline is healthy if configured anywhere (not 'none')
  const isStatuslineHealthy = actualStatusline !== 'none'
  const openRouterActual = apiKeyResults.OPENROUTER_API_KEY.actual
  const openRouterCached = apiKeyResults.OPENROUTER_API_KEY.cached
  // API key is healthy if: actual key is present OR user opted out (not-required)
  const isApiKeyHealthy = openRouterActual !== 'missing' || openRouterCached === 'not-required'
  const overallHealth: 'healthy' | 'unhealthy' =
    userSetupExists && isStatuslineHealthy && isApiKeyHealthy ? 'healthy' : 'unhealthy'

  return {
    userSetupExists,
    statusline: {
      actual: actualStatusline,
      cached: cachedStatusline,
      fixed: statuslineFixed,
    },
    apiKeys: apiKeyResults,
    overallHealth,
    fixes,
  }
}
