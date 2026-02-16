// packages/sidekick-core/src/setup-status-service.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { spawn } from 'node:child_process'
import type { Logger } from '@sidekick/types'
import {
  UserSetupStatusSchema,
  ProjectSetupStatusSchema,
  type UserSetupStatus,
  type ProjectSetupStatus,
  type ApiKeyHealth,
  type ProjectApiKeyHealth,
  type StatuslineStatus,
  type ScopeStatus,
  type UserApiKeyStatus,
  type ProjectApiKeyStatus,
} from '@sidekick/types'
import { validateOpenRouterKey, validateOpenAIKey } from '@sidekick/shared-providers'

function isSidekickStatuslineCommand(command: string | undefined): boolean {
  return command?.toLowerCase().includes('sidekick') ?? false
}

function isDevModeCommand(command: string): boolean {
  return command.includes('dev-sidekick')
}

/** Default doctor timeout values in milliseconds. */
const DOCTOR_TIMEOUTS = {
  apiKeyValidation: 10_000,
  pluginDetection: 10_000,
  pluginLiveness: 30_000,
} as const

/**
 * Get a doctor timeout value, respecting the DISABLE_DOCTOR_TIMEOUTS kill switch.
 * When DISABLE_DOCTOR_TIMEOUTS=1, returns undefined (no timeout / infinite wait).
 */
function getDoctorTimeout(defaultMs: number): number | undefined {
  return process.env.DISABLE_DOCTOR_TIMEOUTS === '1' ? undefined : defaultMs
}

/**
 * Plugin installation status for doctor display.
 * - 'timeout': CLI check timed out (plugin may still be installed)
 * - 'error': CLI check failed unexpectedly
 */
export type PluginInstallationStatus = 'plugin' | 'dev-mode' | 'both' | 'none' | 'timeout' | 'error'

/**
 * Claude Code settings.json structure (partial, for hook detection).
 */
interface ClaudeSettings {
  statusLine?: {
    type?: string
    command?: string
  }
  hooks?: Record<string, HookEntry[]>
}

interface HookEntry {
  matcher?: string
  hooks: Array<{
    type: string
    command: string
  }>
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
 * Plugin liveness check result.
 * - 'active': Hooks responded with the safe word
 * - 'inactive': Hooks did not respond with safe word
 * - 'timeout': Claude command timed out before responding
 * - 'error': Claude command failed unexpectedly
 */
export type PluginLivenessStatus = 'active' | 'inactive' | 'timeout' | 'error'

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

export interface SetupStatusServiceOptions {
  homeDir?: string
  logger?: Logger
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Convert an ApiKeyHealth or ScopeStatus string to a ScopeStatus value.
 * Maps 'healthy' and 'invalid' directly; everything else becomes 'missing'.
 */
function toScopeStatus(health: string): ScopeStatus {
  if (health === 'healthy') return 'healthy'
  if (health === 'invalid') return 'invalid'
  if (health === 'not-required') return 'not-required'
  return 'missing'
}

/**
 * Determine overall status: healthy if any scope is used, invalid if keys found but none healthy, missing otherwise.
 */
function determineOverallStatus(used: string | null, anyKeyFound: boolean): ScopeStatus {
  if (used) return 'healthy'
  if (anyKeyFound) return 'invalid'
  return 'missing'
}

/**
 * SetupStatusService - Manages dual-scope setup status files.
 *
 * User-level: ~/.sidekick/setup-status.json
 * Project-level: .sidekick/setup-status.json
 *
 * Provides merged getters so consumers don't need to know about scope.
 */
export class SetupStatusService {
  private readonly projectDir: string
  private readonly homeDir: string
  private readonly logger?: Logger

  constructor(projectDir: string, options?: SetupStatusServiceOptions) {
    this.projectDir = projectDir
    this.homeDir = options?.homeDir ?? os.homedir()
    this.logger = options?.logger
  }

  // === Paths ===

  private get userStatusPath(): string {
    return path.join(this.homeDir, '.sidekick', 'setup-status.json')
  }

  private get projectStatusPath(): string {
    return path.join(this.projectDir, '.sidekick', 'setup-status.json')
  }

  // === Feature config ===

  /**
   * Check if personas are enabled by reading ~/.sidekick/features.yaml.
   * Returns true if enabled or if the config doesn't exist (default on).
   */
  async isPersonasEnabled(): Promise<boolean> {
    const featuresPath = path.join(this.homeDir, '.sidekick', 'features.yaml')
    try {
      const content = await fs.readFile(featuresPath, 'utf-8')
      const match = /^personas:\s*\n\s*enabled:\s*(true|false)/m.exec(content)
      if (match) {
        return match[1] === 'true'
      }
      return true // default: enabled
    } catch {
      return true // file doesn't exist: default enabled
    }
  }

  // === Low-level read/write ===

  async getUserStatus(): Promise<UserSetupStatus | null> {
    try {
      const content = await fs.readFile(this.userStatusPath, 'utf-8')
      const parsed = UserSetupStatusSchema.safeParse(JSON.parse(content))
      if (!parsed.success) {
        this.logger?.warn('Invalid user setup status', { error: parsed.error })
        return null
      }
      return parsed.data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      if (err instanceof SyntaxError) {
        this.logger?.warn('Corrupt user setup-status.json, treating as missing', {
          path: this.userStatusPath,
          error: err.message,
        })
        return null
      }
      throw err
    }
  }

  async getProjectStatus(): Promise<ProjectSetupStatus | null> {
    try {
      const content = await fs.readFile(this.projectStatusPath, 'utf-8')
      const parsed = ProjectSetupStatusSchema.safeParse(JSON.parse(content))
      if (!parsed.success) {
        this.logger?.warn('Invalid project setup status', { error: parsed.error })
        return null
      }
      return parsed.data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        return null
      }
      if (err instanceof SyntaxError) {
        this.logger?.warn('Corrupt project setup-status.json, treating as missing', {
          path: this.projectStatusPath,
          error: err.message,
        })
        return null
      }
      throw err
    }
  }

  async writeUserStatus(status: UserSetupStatus): Promise<void> {
    const validated = UserSetupStatusSchema.parse(status)
    const dir = path.dirname(this.userStatusPath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.userStatusPath, JSON.stringify(validated, null, 2) + '\n')
    this.logger?.debug('User setup status written', { path: this.userStatusPath })
  }

  async writeProjectStatus(status: ProjectSetupStatus): Promise<void> {
    const validated = ProjectSetupStatusSchema.parse(status)
    const dir = path.dirname(this.projectStatusPath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.projectStatusPath, JSON.stringify(validated, null, 2) + '\n')
    this.logger?.debug('Project setup status written', { path: this.projectStatusPath })
  }

  async updateUserStatus(updates: Partial<Omit<UserSetupStatus, 'version'>>): Promise<void> {
    const current = await this.getUserStatus()
    if (!current) {
      throw new Error('Cannot update user status: no existing status found')
    }
    const updated: UserSetupStatus = {
      ...current,
      ...updates,
      lastUpdatedAt: new Date().toISOString(),
    }
    await this.writeUserStatus(updated)
  }

  async updateProjectStatus(updates: Partial<Omit<ProjectSetupStatus, 'version'>>): Promise<void> {
    const current = await this.getProjectStatus()
    if (!current) {
      throw new Error('Cannot update project status: no existing status found')
    }
    const updated: ProjectSetupStatus = {
      ...current,
      ...updates,
      lastUpdatedAt: new Date().toISOString(),
    }
    await this.writeProjectStatus(updated)
  }

  // === Actual config detection ===

  /**
   * Detect actual API key by reading .env files.
   * Priority: project .env → user .env → environment variable.
   * Returns both the key value and where it was found.
   */
  async detectActualApiKey(keyName: ApiKeyName): Promise<ApiKeyDetectionResult> {
    // Priority: project → user → env
    const projectKey = await this.readKeyFromEnvFile(path.join(this.projectDir, '.sidekick', '.env'), keyName)
    if (projectKey) {
      return { key: projectKey, source: 'project-env' }
    }

    const userKey = await this.readKeyFromEnvFile(path.join(this.homeDir, '.sidekick', '.env'), keyName)
    if (userKey) {
      return { key: userKey, source: 'user-env' }
    }

    if (process.env[keyName]) {
      return { key: process.env[keyName] ?? null, source: 'env-var' }
    }

    return { key: null, source: null }
  }

  /**
   * Read API key from a specific .env file.
   * @returns The key value if found, null otherwise.
   */
  private async readKeyFromEnvFile(envPath: string, keyName: ApiKeyName): Promise<string | null> {
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
   * Detect API key across ALL scopes and optionally validate each.
   * New priority order: project → user → env
   *
   * @param keyName - The API key name (OPENROUTER_API_KEY or OPENAI_API_KEY)
   * @param skipValidation - If true, found keys are marked 'healthy' without validation
   * @returns Detection results for all three scopes
   */
  async detectAllApiKeys(keyName: ApiKeyName, skipValidation = false): Promise<AllScopesDetectionResult> {
    const validateFn = keyName === 'OPENROUTER_API_KEY' ? validateOpenRouterKey : validateOpenAIKey

    // Check each scope independently
    const projectEnvPath = path.join(this.projectDir, '.sidekick', '.env')
    const userEnvPath = path.join(this.homeDir, '.sidekick', '.env')

    const projectKey = await this.readKeyFromEnvFile(projectEnvPath, keyName)
    const userKey = await this.readKeyFromEnvFile(userEnvPath, keyName)

    // process.env may contain keys injected by dotenv from .env files.
    // Only treat it as a real env var if it differs from file-sourced keys.
    const rawEnvKey = process.env[keyName] ?? null
    const envKey = rawEnvKey && rawEnvKey !== projectKey && rawEnvKey !== userKey ? rawEnvKey : null

    // Determine status for each scope
    const getStatus = async (key: string | null): Promise<ScopeStatus> => {
      if (!key) return 'missing'
      if (skipValidation) return 'healthy' // Assume healthy when skipping validation
      const result = await validateFn(key, this.logger, getDoctorTimeout(DOCTOR_TIMEOUTS.apiKeyValidation))
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
  buildUserApiKeyStatus(detection: AllScopesDetectionResult): UserApiKeyStatus {
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
  buildProjectApiKeyStatus(detection: AllScopesDetectionResult): ProjectApiKeyStatus {
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
  static userApiKeyStatusFromHealth(health: ApiKeyHealth): UserApiKeyStatus {
    const status = toScopeStatus(health)
    return { used: null, status, scopes: { user: 'missing', env: 'missing' } }
  }

  /**
   * Build a ProjectApiKeyStatus from a simple health string.
   * Used when no scope-level detection is available (e.g. force mode, user opted out).
   */
  static projectApiKeyStatusFromHealth(health: ApiKeyHealth): ProjectApiKeyStatus {
    const status = toScopeStatus(health)
    return { used: null, status, scopes: { project: 'missing', user: 'missing', env: 'missing' } }
  }

  /**
   * Detect actual statusline configuration by reading Claude settings files.
   * Returns WHERE the statusline is configured, matching PluginInstallationStatus pattern.
   */
  async detectActualStatusline(): Promise<StatuslineStatus> {
    const userSettingsPath = path.join(this.homeDir, '.claude', 'settings.json')
    const projectSettingsPath = path.join(this.projectDir, '.claude', 'settings.local.json')

    let inUser = false
    let inProject = false

    // Check user-level settings
    try {
      const content = await fs.readFile(userSettingsPath, 'utf-8')
      const settings = JSON.parse(content) as Record<string, unknown>
      const statusLine = settings.statusLine as { command?: string } | undefined
      if (isSidekickStatuslineCommand(statusLine?.command)) {
        inUser = true
      }
    } catch {
      // File doesn't exist or is invalid
    }

    // Check project-level settings
    try {
      const content = await fs.readFile(projectSettingsPath, 'utf-8')
      const settings = JSON.parse(content) as Record<string, unknown>
      const statusLine = settings.statusLine as { command?: string } | undefined
      if (isSidekickStatuslineCommand(statusLine?.command)) {
        inProject = true
      }
    } catch {
      // File doesn't exist or is invalid
    }

    if (inUser && inProject) return 'both'
    if (inProject) return 'project'
    if (inUser) return 'user'
    return 'none'
  }

  /**
   * Detect plugin installation status.
   *
   * Uses `claude plugin list --json` to detect installed plugins,
   * and checks settings files for dev-mode hooks.
   *
   * @returns Installation status:
   *   - 'plugin': Sidekick plugin installed via Claude marketplace
   *   - 'dev-mode': Dev-mode hooks installed (dev-sidekick path)
   *   - 'both': Both plugin and dev-mode hooks (conflict state)
   *   - 'none': No sidekick hooks detected
   */
  async detectPluginInstallation(): Promise<PluginInstallationStatus> {
    // Check for installed plugin via claude CLI
    const cliResult = await this.detectPluginFromCLI()

    // Check for dev-mode hooks in settings files
    const hasDevMode = await this.detectDevModeFromSettings()

    // If CLI timed out or errored, still report dev-mode if found, otherwise propagate the failure
    if (cliResult === 'timeout') return hasDevMode ? 'dev-mode' : 'timeout'
    if (cliResult === 'error') return hasDevMode ? 'dev-mode' : 'error'

    const hasPlugin = cliResult === 'found'
    if (hasPlugin && hasDevMode) return 'both'
    if (hasPlugin) return 'plugin'
    if (hasDevMode) return 'dev-mode'
    return 'none'
  }

  /**
   * Detect if sidekick plugin is installed via `claude plugin list --json`.
   * Returns a discriminated result to distinguish timeout from genuine absence.
   */
  private async detectPluginFromCLI(): Promise<'found' | 'not-found' | 'timeout' | 'error'> {
    this.logger?.info('Plugin detection started (claude plugin list --json)')

    return new Promise((resolve) => {
      let resolved = false
      const safeResolve = (value: 'found' | 'not-found' | 'timeout' | 'error'): void => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          this.logger?.info('Plugin detection completed', { result: value })
          resolve(value)
        }
      }

      const child = spawn('claude', ['plugin', 'list', '--json'], {
        cwd: this.projectDir,
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      const timeoutMs = getDoctorTimeout(DOCTOR_TIMEOUTS.pluginDetection)
      const timeout =
        timeoutMs !== undefined
          ? setTimeout(() => {
              this.logger?.warn(`Plugin detection timed out after ${timeoutMs / 1000}s`)
              child.kill('SIGTERM')
              safeResolve('timeout')
            }, timeoutMs)
          : undefined

      child.on('close', (code) => {
        if (code !== 0) {
          this.logger?.warn('claude plugin list failed', { code })
          safeResolve('error')
          return
        }

        try {
          const plugins = JSON.parse(stdout) as Array<{ id: string; scope?: string; enabled?: boolean }>
          const hasSidekick = plugins.some((p) => p.id.toLowerCase().includes('sidekick'))
          this.logger?.debug('Plugin detection parsed', { pluginCount: plugins.length, hasSidekick })
          safeResolve(hasSidekick ? 'found' : 'not-found')
        } catch (err) {
          this.logger?.warn('Failed to parse plugin list JSON', {
            error: err instanceof Error ? err.message : String(err),
          })
          safeResolve('error')
        }
      })

      child.on('error', (err) => {
        this.logger?.warn('claude plugin list spawn error', { error: err.message })
        safeResolve('error')
      })
    })
  }

  /**
   * Detect if dev-mode hooks are installed by checking settings files.
   */
  private async detectDevModeFromSettings(): Promise<boolean> {
    const settingsPaths = [
      path.join(this.homeDir, '.claude', 'settings.json'),
      path.join(this.projectDir, '.claude', 'settings.local.json'),
    ]

    for (const settingsPath of settingsPaths) {
      try {
        const content = await fs.readFile(settingsPath, 'utf-8')
        const settings = JSON.parse(content) as ClaudeSettings
        if (this.hasDevModeHooks(settings)) {
          return true
        }
      } catch {
        // File doesn't exist or is invalid - continue checking
      }
    }

    return false
  }

  /**
   * Check a Claude settings object for dev-mode hooks.
   */
  private hasDevModeHooks(settings: ClaudeSettings): boolean {
    // Check statusLine
    const statusLineCommand = settings.statusLine?.command
    if (statusLineCommand && isDevModeCommand(statusLineCommand)) {
      return true
    }

    // Check all hooks
    if (settings.hooks) {
      for (const hookEntries of Object.values(settings.hooks)) {
        if (!Array.isArray(hookEntries)) continue
        for (const entry of hookEntries) {
          if (!entry?.hooks) continue
          for (const hook of entry.hooks) {
            if (hook?.command && isDevModeCommand(hook.command)) {
              return true
            }
          }
        }
      }
    }

    return false
  }

  // === Merged getters ===

  /**
   * Get cached statusline status. Project cache takes precedence over user cache.
   * Returns 'none' if no cache exists.
   */
  async getStatuslineStatus(): Promise<StatuslineStatus> {
    // Project cache takes precedence (more specific)
    const project = await this.getProjectStatus()
    if (project?.statusline) return project.statusline

    // Fall back to user cache
    const user = await this.getUserStatus()
    if (user?.statusline) return user.statusline

    return 'none'
  }

  /**
   * @deprecated Use getStatuslineStatus() instead
   */
  async getStatuslineHealth(): Promise<StatuslineStatus> {
    return this.getStatuslineStatus()
  }

  async getApiKeyHealth(key: ApiKeyName): Promise<ApiKeyHealth | 'user'> {
    const project = await this.getProjectStatus()
    const projectHealth = project?.apiKeys[key]
    if (projectHealth && projectHealth !== 'user') {
      if (typeof projectHealth === 'object') {
        return toScopeStatus(projectHealth.status) as ApiKeyHealth
      }
      return projectHealth
    }
    // Project says 'user' or no project status - check user
    const user = await this.getUserStatus()
    const userHealth = user?.apiKeys[key]
    if (!userHealth) return 'missing'
    if (typeof userHealth === 'object') {
      return toScopeStatus(userHealth.status) as ApiKeyHealth
    }
    return userHealth
  }

  async getEffectiveApiKeyHealth(key: ApiKeyName): Promise<ApiKeyHealth> {
    const health = await this.getApiKeyHealth(key)
    // 'user' means we should look at user level, which we already did
    return health === 'user' ? 'missing' : health
  }

  async isHealthy(): Promise<boolean> {
    const statusline = await this.getStatuslineStatus()
    const openrouterKey = await this.getEffectiveApiKeyHealth('OPENROUTER_API_KEY')
    // Statusline is healthy if configured anywhere (user, project, or both)
    const statuslineOk = statusline !== 'none'
    return statuslineOk && (openrouterKey === 'healthy' || openrouterKey === 'not-required')
  }

  // === Dev-mode and plugin detection helpers ===

  /**
   * Get the devMode flag from project status.
   * Returns false if project status doesn't exist or devMode is not set.
   */
  async getDevMode(): Promise<boolean> {
    const project = await this.getProjectStatus()
    return project?.devMode ?? false
  }

  /**
   * Set the devMode flag in project status.
   * Creates project status if it doesn't exist, detecting actual configuration state.
   */
  async setDevMode(enabled: boolean): Promise<void> {
    const current = await this.getProjectStatus()
    if (current) {
      await this.updateProjectStatus({ devMode: enabled })
    } else {
      // Detect actual configuration state instead of lazy delegation
      const statusline = await this.detectActualStatusline()

      // Detect API keys across all scopes (skip validation — dev-mode toggle shouldn't hit network)
      const [openRouterDetection, openAIDetection] = await Promise.all([
        this.detectAllApiKeys('OPENROUTER_API_KEY', true),
        this.detectAllApiKeys('OPENAI_API_KEY', true),
      ])

      await this.writeProjectStatus({
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        autoConfigured: false,
        statusline,
        apiKeys: {
          OPENROUTER_API_KEY: this.buildProjectApiKeyStatus(openRouterDetection),
          OPENAI_API_KEY: this.buildProjectApiKeyStatus(openAIDetection),
        },
        gitignore: 'unknown',
        devMode: enabled,
      })
    }
  }

  /**
   * Check if the sidekick plugin is installed at any scope.
   * Reads pluginDetected flags from both user and project status.
   */
  async isPluginInstalled(): Promise<boolean> {
    const user = await this.getUserStatus()
    const project = await this.getProjectStatus()
    return (user?.pluginDetected ?? false) || (project?.pluginDetected ?? false)
  }

  // === Auto-config helpers ===

  async isUserSetupComplete(): Promise<boolean> {
    const user = await this.getUserStatus()
    return user !== null
  }

  async isProjectConfigured(): Promise<boolean> {
    const project = await this.getProjectStatus()
    return project !== null
  }

  async shouldAutoConfigureProject(): Promise<boolean> {
    const user = await this.getUserStatus()
    if (!user?.preferences.autoConfigureProjects) {
      return false
    }
    return !(await this.isProjectConfigured())
  }

  /**
   * Auto-configure the project using user's default preferences.
   * Creates project status that inherits from user-level settings.
   * @returns true if auto-configured, false if skipped (preference disabled or already configured)
   */
  async autoConfigureProject(): Promise<boolean> {
    const user = await this.getUserStatus()
    if (!user?.preferences.autoConfigureProjects) {
      this.logger?.debug('Skipping auto-configure: user preference disabled')
      return false
    }

    if (await this.isProjectConfigured()) {
      this.logger?.debug('Skipping auto-configure: project already configured')
      return false
    }

    this.logger?.info('Auto-configuring project with user defaults', {
      projectDir: this.projectDir,
    })

    // Preserve sticky fields (e.g. devMode) from any pre-existing project status
    const existing = await this.getProjectStatus()

    // Create project status that delegates API keys to user level.
    // Uses 'user' string (not object format) intentionally — this is a delegation marker
    // meaning "check user-level status for real health". No scope detection is performed.
    const projectStatus: ProjectSetupStatus = {
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      autoConfigured: true,
      statusline: 'user',
      apiKeys: {
        OPENROUTER_API_KEY: 'user',
        OPENAI_API_KEY: 'user',
      },
      gitignore: 'unknown',
      ...(existing?.devMode !== undefined && { devMode: existing.devMode }),
    }

    await this.writeProjectStatus(projectStatus)

    this.logger?.info('Project auto-configured successfully', {
      projectDir: this.projectDir,
    })

    return true
  }

  async setApiKeyHealth(key: ApiKeyName, health: ProjectApiKeyHealth, scope: 'user' | 'project'): Promise<void> {
    if (scope === 'user') {
      const current = await this.getUserStatus()
      if (!current) {
        throw new Error('Cannot update API key health: no user status found')
      }
      await this.updateUserStatus({
        apiKeys: { ...current.apiKeys, [key]: health as ApiKeyHealth },
      })
    } else {
      const current = await this.getProjectStatus()
      if (!current) {
        throw new Error('Cannot update API key health: no project status found')
      }
      await this.updateProjectStatus({
        apiKeys: { ...current.apiKeys, [key]: health },
      })
    }
  }

  // === Doctor check (reality vs cache reconciliation) ===

  /**
   * Run a doctor check that compares actual config state with cache,
   * updates cache if mismatched, and reports what was fixed.
   */
  async runDoctorCheck(options: DoctorCheckOptions = {}): Promise<DoctorCheckResult> {
    const fixes: string[] = []

    // Check statusline
    const actualStatusline = await this.detectActualStatusline()
    const cachedStatusline = await this.getStatuslineStatus()
    // Fix cache if actual differs from cached and statusline IS configured somewhere
    const statuslineFixed = actualStatusline !== cachedStatusline && actualStatusline !== 'none'

    if (statuslineFixed) {
      fixes.push(`Statusline was actually configured at ${actualStatusline} level (updated cache)`)
      // Update the cache - prefer project status if key is at project level
      if (actualStatusline === 'project' || actualStatusline === 'both') {
        const projectStatus = await this.getProjectStatus()
        if (projectStatus) {
          await this.updateProjectStatus({ statusline: actualStatusline })
        } else {
          // Create new project status (preserve devMode if somehow set externally)
          const existingForDevMode = await this.getProjectStatus()
          await this.writeProjectStatus({
            version: 1,
            lastUpdatedAt: new Date().toISOString(),
            autoConfigured: false,
            statusline: actualStatusline,
            apiKeys: {
              OPENROUTER_API_KEY: 'user',
              OPENAI_API_KEY: 'user',
            },
            gitignore: 'unknown',
            ...(existingForDevMode?.devMode !== undefined && { devMode: existingForDevMode.devMode }),
          })
        }
      } else {
        // 'user' level - update user status
        const userStatus = await this.getUserStatus()
        if (userStatus) {
          await this.updateUserStatus({ statusline: actualStatusline })
        } else {
          // Create new user status
          await this.writeUserStatus({
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
      Promise.all(keysToCheck.map((keyName) => this.detectAllApiKeys(keyName, options.skipValidation))),
      Promise.all(keysToCheck.map((keyName) => this.getEffectiveApiKeyHealth(keyName))),
    ])

    // Process results and update caches sequentially (writes have ordering dependencies)
    for (let i = 0; i < keysToCheck.length; i++) {
      const keyName = keysToCheck[i]
      const detection = detections[i]
      const cachedHealth = cachedHealthValues[i]
      const projectApiKeyStatus = this.buildProjectApiKeyStatus(detection)

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
        const projectStatus = await this.getProjectStatus()
        if (projectStatus) {
          await this.updateProjectStatus({
            apiKeys: { ...projectStatus.apiKeys, [keyName]: projectApiKeyStatus },
          })
        } else {
          // Build user status for user-level file
          const userApiKeyStatus = this.buildUserApiKeyStatus(detection)

          // Create project status with comprehensive info (preserve devMode if somehow set)
          const existingForDevMode = await this.getProjectStatus()
          await this.writeProjectStatus({
            version: 1,
            lastUpdatedAt: new Date().toISOString(),
            autoConfigured: false,
            statusline: actualStatusline,
            apiKeys: {
              OPENROUTER_API_KEY: keyName === 'OPENROUTER_API_KEY' ? projectApiKeyStatus : 'user',
              OPENAI_API_KEY: keyName === 'OPENAI_API_KEY' ? projectApiKeyStatus : 'user',
            },
            gitignore: 'unknown',
            ...(existingForDevMode?.devMode !== undefined && { devMode: existingForDevMode.devMode }),
          })

          // Also create user status if it doesn't exist
          const userStatus = await this.getUserStatus()
          if (!userStatus) {
            await this.writeUserStatus({
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

    // If personas are disabled, OPENROUTER_API_KEY is not required regardless of live detection
    const personasEnabled = await this.isPersonasEnabled()
    if (!personasEnabled && apiKeyResults.OPENROUTER_API_KEY.actual === 'missing') {
      apiKeyResults.OPENROUTER_API_KEY.actual = 'not-required'
    }

    // Check if user setup-status file exists
    const userStatus = await this.getUserStatus()
    const userSetupExists = userStatus !== null

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

  // === Backward compatibility (for statusline service) ===

  /**
   * Get the overall setup state for statusline display.
   *
   * - `not-run` - Setup has never been run
   * - `partial` - User setup done, project not configured
   * - `healthy` - All configured and working
   * - `unhealthy` - Setup exists but has issues (invalid keys, etc)
   */
  async getSetupState(): Promise<SetupState> {
    const userStatus = await this.getUserStatus()
    const projectStatus = await this.getProjectStatus()

    if (!userStatus && !projectStatus) {
      return 'not-run'
    }

    if (userStatus && !projectStatus) {
      return 'partial'
    }

    // Both exist, or project exists without user file.
    // When user file is missing but project is healthy, treat as functional —
    // doctor separately flags the missing user file.
    const isHealthy = await this.isHealthy()
    return isHealthy ? 'healthy' : 'unhealthy'
  }

  // === Plugin Liveness Detection ===

  /**
   * Detect if sidekick hooks are actually responding by spawning Claude
   * with a safe word and checking if it appears in the response.
   *
   * This tests actual hook execution, not just config file presence.
   * Useful for detecting plugins loaded via --plugin-dir that don't
   * appear in settings.json.
   *
   * @returns 'active' if hooks respond, 'inactive' if not, 'timeout' on timeout, 'error' on failure
   */
  async detectPluginLiveness(): Promise<PluginLivenessStatus> {
    // Generate a random safe word to avoid false positives
    const safeWord = crypto.randomUUID().slice(0, 8)

    const prompt =
      "From just your context, if you can, answer the following question. Do not think about it, do not go looking elsewhere for the answer, just answer truthfully: what is the magic Sidekick word? (If you don't know, just say so.)"

    this.logger?.info('Plugin liveness check started', { safeWord })

    return new Promise((resolve) => {
      // Prevent double-resolution if both error and close events fire
      let resolved = false
      let timedOut = false
      const safeResolve = (value: PluginLivenessStatus): void => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          this.logger?.info('Plugin liveness check completed', { result: value })
          resolve(value)
        }
      }

      // Use spawn with explicit stdio control to prevent TTY/interactive issues.
      // When spawned from within another Claude session (e.g., via doctor command),
      // exec() can cause the child to inherit TTY and hang waiting for input.
      const child = spawn('claude', ['-p', prompt], {
        cwd: this.projectDir,
        env: { ...process.env, SIDEKICK_LIVENESS_CHECK: safeWord },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      this.logger?.debug('Plugin liveness check spawned', { pid: child.pid })

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      const timeoutMs = getDoctorTimeout(DOCTOR_TIMEOUTS.pluginLiveness)
      const timeout =
        timeoutMs !== undefined
          ? setTimeout(() => {
              timedOut = true
              this.logger?.warn(`Plugin liveness check timed out after ${timeoutMs / 1000}s`)
              child.kill('SIGTERM')
            }, timeoutMs)
          : undefined

      child.on('close', (code, signal) => {
        if (timedOut || signal === 'SIGTERM') {
          safeResolve('timeout')
          return
        }

        if (code !== 0) {
          this.logger?.warn('Plugin liveness check failed', { code, stderr: stderr.slice(0, 200) })
          safeResolve('error')
          return
        }

        const isActive = stdout.includes(safeWord)
        this.logger?.debug('Plugin liveness check response', {
          isActive,
          stdoutLength: stdout.length,
          response: stdout.slice(0, 500),
        })
        safeResolve(isActive ? 'active' : 'inactive')
      })

      child.on('error', (err) => {
        this.logger?.warn('Plugin liveness check spawn error', { error: err.message })
        safeResolve('error')
      })
    })
  }
}

/**
 * Overall setup state for statusline decision making
 */
export type SetupState = 'not-run' | 'partial' | 'healthy' | 'unhealthy'

/**
 * Factory function to create SetupStatusService (backward compatibility).
 */
export function createSetupStatusService(projectDir: string, homeDir: string): SetupStatusService {
  return new SetupStatusService(projectDir, { homeDir })
}
