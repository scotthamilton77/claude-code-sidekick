// packages/sidekick-core/src/setup-status-service.ts
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import * as crypto from 'node:crypto'
import { exec } from 'node:child_process'
import { promisify } from 'node:util'

const execAsync = promisify(exec)
import type { Logger } from '@sidekick/types'
import {
  UserSetupStatusSchema,
  ProjectSetupStatusSchema,
  type UserSetupStatus,
  type ProjectSetupStatus,
  type ApiKeyHealth,
  type ProjectApiKeyHealth,
} from '@sidekick/types'
import { validateOpenRouterKey, validateOpenAIKey } from '@sidekick/shared-providers'

/**
 * Check if a statusLine command is a sidekick command.
 */
function isSidekickStatuslineCommand(command: string | undefined): boolean {
  if (!command) return false
  return command.toLowerCase().includes('sidekick')
}

/**
 * Check if a command is from the published plugin (npx @scotthamilton77/sidekick).
 */
function isPluginCommand(command: string): boolean {
  return command.includes('npx @scotthamilton77/sidekick')
}

/**
 * Check if a command is from dev-mode hooks.
 */
function isDevModeCommand(command: string): boolean {
  return command.includes('dev-hooks')
}

/**
 * Plugin installation status for doctor display.
 */
export type PluginInstallationStatus = 'plugin' | 'dev-mode' | 'both' | 'none'

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
 * Plugin liveness check result.
 * - 'active': Hooks responded with the safe word
 * - 'inactive': Hooks did not respond with safe word
 * - 'error': Claude command failed or timed out
 */
export type PluginLivenessStatus = 'active' | 'inactive' | 'error'

export interface DoctorCheckOptions {
  /** Skip API key validation (for faster checks or when offline) */
  skipValidation?: boolean
}

export interface DoctorItemResult {
  actual: string
  cached: string
  fixed: boolean
}

export interface DoctorCheckResult {
  statusline: DoctorItemResult
  apiKeys: Record<ApiKeyName, DoctorItemResult>
  overallHealth: 'healthy' | 'unhealthy'
  fixes: string[]
}

export interface SetupStatusServiceOptions {
  homeDir?: string
  logger?: Logger
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
   * Checks environment variable first, then project .env, then user .env.
   * Returns the key value if found, null otherwise.
   */
  async detectActualApiKey(keyName: ApiKeyName): Promise<string | null> {
    // Check environment variable first
    if (process.env[keyName]) {
      return process.env[keyName]
    }

    // Check .env files (project first, then user)
    const envPaths = [path.join(this.projectDir, '.sidekick', '.env'), path.join(this.homeDir, '.sidekick', '.env')]

    for (const envPath of envPaths) {
      try {
        const content = await fs.readFile(envPath, 'utf-8')
        const match = content.match(new RegExp(`^${keyName}=(.+)$`, 'm'))
        if (match) {
          return match[1]
        }
      } catch {
        // File doesn't exist - continue checking
      }
    }

    return null
  }

  /**
   * Detect actual statusline configuration by reading Claude settings files.
   * Checks both user (~/.claude/settings.json) and project (.claude/settings.local.json).
   */
  async detectActualStatusline(): Promise<'configured' | 'not-setup'> {
    const settingsPaths = [
      path.join(this.homeDir, '.claude', 'settings.json'),
      path.join(this.projectDir, '.claude', 'settings.local.json'),
    ]

    for (const settingsPath of settingsPaths) {
      try {
        const content = await fs.readFile(settingsPath, 'utf-8')
        const settings = JSON.parse(content) as Record<string, unknown>
        const statusLine = settings.statusLine as { command?: string } | undefined
        if (isSidekickStatuslineCommand(statusLine?.command)) {
          return 'configured'
        }
      } catch {
        // File doesn't exist or is invalid - continue checking
      }
    }

    return 'not-setup'
  }

  /**
   * Detect plugin installation status by reading Claude settings files.
   * Checks both user (~/.claude/settings.json) and project (.claude/settings.local.json).
   *
   * @returns Installation status:
   *   - 'plugin': Plugin hooks installed (npx @scotthamilton77/sidekick)
   *   - 'dev-mode': Dev-mode hooks installed (dev-hooks path)
   *   - 'both': Both plugin and dev-mode hooks (conflict state)
   *   - 'none': No sidekick hooks detected
   */
  async detectPluginInstallation(): Promise<PluginInstallationStatus> {
    const settingsPaths = [
      path.join(this.homeDir, '.claude', 'settings.json'),
      path.join(this.projectDir, '.claude', 'settings.local.json'),
    ]

    let hasPlugin = false
    let hasDevMode = false

    for (const settingsPath of settingsPaths) {
      try {
        const content = await fs.readFile(settingsPath, 'utf-8')
        const settings = JSON.parse(content) as ClaudeSettings
        const { plugin, devMode } = this.checkSettingsForSidekick(settings)
        if (plugin) hasPlugin = true
        if (devMode) hasDevMode = true
      } catch {
        // File doesn't exist or is invalid - continue checking
      }
    }

    if (hasPlugin && hasDevMode) return 'both'
    if (hasPlugin) return 'plugin'
    if (hasDevMode) return 'dev-mode'
    return 'none'
  }

  /**
   * Check a Claude settings object for sidekick hooks.
   */
  private checkSettingsForSidekick(settings: ClaudeSettings): { plugin: boolean; devMode: boolean } {
    let plugin = false
    let devMode = false

    // Check statusLine
    const statusLineCommand = settings.statusLine?.command
    if (statusLineCommand) {
      if (isPluginCommand(statusLineCommand)) plugin = true
      if (isDevModeCommand(statusLineCommand)) devMode = true
    }

    // Check all hooks
    if (settings.hooks) {
      for (const hookEntries of Object.values(settings.hooks)) {
        if (!Array.isArray(hookEntries)) continue
        for (const entry of hookEntries) {
          if (!entry?.hooks) continue
          for (const hook of entry.hooks) {
            const command = hook?.command
            if (command) {
              if (isPluginCommand(command)) plugin = true
              if (isDevModeCommand(command)) devMode = true
            }
          }
        }
      }
    }

    return { plugin, devMode }
  }

  // === Merged getters ===

  async getStatuslineHealth(): Promise<'configured' | 'skipped' | 'not-setup'> {
    const project = await this.getProjectStatus()
    if (project?.statusline === 'configured') return 'configured'
    if (project?.statusline === 'skipped') return 'skipped'
    if (project?.statusline === 'user') {
      const user = await this.getUserStatus()
      return user?.statusline ?? 'not-setup'
    }
    // No project status, check user directly
    const user = await this.getUserStatus()
    return user?.statusline ?? 'not-setup'
  }

  async getApiKeyHealth(key: ApiKeyName): Promise<ApiKeyHealth | 'user'> {
    const project = await this.getProjectStatus()
    const projectHealth = project?.apiKeys[key]
    if (projectHealth && projectHealth !== 'user') {
      return projectHealth
    }
    // Project says 'user' or no project status - check user
    const user = await this.getUserStatus()
    return user?.apiKeys[key] ?? 'missing'
  }

  async getEffectiveApiKeyHealth(key: ApiKeyName): Promise<ApiKeyHealth> {
    const health = await this.getApiKeyHealth(key)
    // 'user' means we should look at user level, which we already did
    return health === 'user' ? 'missing' : health
  }

  async isHealthy(): Promise<boolean> {
    const statusline = await this.getStatuslineHealth()
    const openrouterKey = await this.getEffectiveApiKeyHealth('OPENROUTER_API_KEY')
    return statusline === 'configured' && (openrouterKey === 'healthy' || openrouterKey === 'not-required')
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
    const cachedStatusline = await this.getStatuslineHealth()
    const statuslineFixed = actualStatusline !== cachedStatusline && actualStatusline === 'configured'

    if (statuslineFixed) {
      fixes.push('Statusline was actually configured (updated cache)')
      // Update the cache
      const userStatus = await this.getUserStatus()
      if (userStatus) {
        await this.updateUserStatus({ statusline: 'configured' })
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
          statusline: 'configured',
          apiKeys: {
            OPENROUTER_API_KEY: 'missing',
            OPENAI_API_KEY: 'not-required',
          },
        })
      }
    }

    // Check API keys
    const apiKeyResults: Record<ApiKeyName, DoctorItemResult> = {} as Record<ApiKeyName, DoctorItemResult>
    const keysToCheck: ApiKeyName[] = ['OPENROUTER_API_KEY', 'OPENAI_API_KEY']

    for (const keyName of keysToCheck) {
      const actualKey = await this.detectActualApiKey(keyName)
      const cachedHealth = await this.getEffectiveApiKeyHealth(keyName)

      let actualHealth: ApiKeyHealth
      if (!actualKey) {
        actualHealth = 'missing'
      } else if (options.skipValidation) {
        actualHealth = 'pending-validation'
      } else {
        // Validate the key using the provider API
        const validateFn = keyName === 'OPENROUTER_API_KEY' ? validateOpenRouterKey : validateOpenAIKey
        const validationResult = await validateFn(actualKey, this.logger)
        actualHealth = validationResult.valid ? 'healthy' : 'invalid'
      }

      const keyFixed = actualKey !== null && cachedHealth === 'missing'

      if (keyFixed) {
        fixes.push(`${keyName} was actually present (updated cache)`)
        // Update cache
        const userStatus = await this.getUserStatus()
        if (userStatus) {
          await this.updateUserStatus({
            apiKeys: { ...userStatus.apiKeys, [keyName]: actualHealth },
          })
        }
      }

      apiKeyResults[keyName] = {
        actual: actualHealth,
        cached: cachedHealth,
        fixed: keyFixed,
      }
    }

    // Determine overall health
    const isStatuslineHealthy = actualStatusline === 'configured'
    const openRouterActual = apiKeyResults.OPENROUTER_API_KEY.actual
    const openRouterCached = apiKeyResults.OPENROUTER_API_KEY.cached
    // API key is healthy if: actual key is present OR user opted out (not-required)
    const isApiKeyHealthy = openRouterActual !== 'missing' || openRouterCached === 'not-required'
    const overallHealth: 'healthy' | 'unhealthy' = isStatuslineHealthy && isApiKeyHealthy ? 'healthy' : 'unhealthy'

    return {
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

    if (!userStatus) {
      return 'not-run'
    }

    if (!projectStatus) {
      return 'partial'
    }

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
   * @returns 'active' if hooks respond, 'inactive' if not, 'error' on failure
   */
  async detectPluginLiveness(): Promise<PluginLivenessStatus> {
    // Generate a random safe word to avoid false positives
    const safeWord = crypto.randomUUID().slice(0, 8)

    try {
      const { stdout } = await execAsync('claude /p "Is sidekick installed? Reply with just the magic word if yes."', {
        env: { ...process.env, SIDEKICK_SAFE_WORD: safeWord },
        timeout: 30000, // 30 second timeout
      })

      return stdout.includes(safeWord) ? 'active' : 'inactive'
    } catch (error) {
      this.logger?.warn('Plugin liveness check failed', { error })
      return 'error'
    }
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
