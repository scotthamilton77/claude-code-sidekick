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
  type PluginStatus,
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
 * Check if a command is from dev-mode hooks.
 */
function isDevModeCommand(command: string): boolean {
  return command.includes('dev-sidekick')
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
    const hasPlugin = await this.detectPluginFromCLI()

    // Check for dev-mode hooks in settings files
    const hasDevMode = await this.detectDevModeFromSettings()

    if (hasPlugin && hasDevMode) return 'both'
    if (hasPlugin) return 'plugin'
    if (hasDevMode) return 'dev-mode'
    return 'none'
  }

  /**
   * Detect if sidekick plugin is installed via `claude plugin list --json`.
   */
  private async detectPluginFromCLI(): Promise<boolean> {
    return new Promise((resolve) => {
      let resolved = false
      const safeResolve = (value: boolean): void => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          resolve(value)
        }
      }

      const child = spawn('claude', ['plugin', 'list', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      const timeout = setTimeout(() => {
        this.logger?.warn('Plugin detection timed out after 10s')
        child.kill('SIGTERM')
        safeResolve(false)
      }, 10000)

      child.on('close', (code) => {
        if (code !== 0) {
          this.logger?.debug('claude plugin list failed', { code })
          safeResolve(false)
          return
        }

        try {
          const plugins = JSON.parse(stdout) as Array<{ id: string; scope?: string; enabled?: boolean }>
          // Look for any plugin with "sidekick" in the id
          const hasSidekick = plugins.some((p) => p.id.toLowerCase().includes('sidekick'))
          this.logger?.debug('Plugin detection completed', { pluginCount: plugins.length, hasSidekick })
          safeResolve(hasSidekick)
        } catch (err) {
          this.logger?.debug('Failed to parse plugin list JSON', {
            error: err instanceof Error ? err.message : String(err),
          })
          safeResolve(false)
        }
      })

      child.on('error', (err) => {
        this.logger?.debug('claude plugin list spawn error', { error: err.message })
        safeResolve(false)
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

  /**
   * Get the plugin installation status.
   *
   * First checks cached pluginStatus from user setup status file.
   * If not cached, detects status by examining Claude settings files.
   *
   * @returns PluginStatus indicating installation state
   */
  async getPluginStatus(): Promise<PluginStatus> {
    // Check cached status first
    const userStatus = await this.getUserStatus()
    if (userStatus?.pluginStatus) {
      return userStatus.pluginStatus
    }

    // Detect from settings files
    const installation = await this.detectPluginInstallation()

    // Map PluginInstallationStatus to PluginStatus
    switch (installation) {
      case 'both':
        return 'conflict'
      case 'dev-mode':
        return 'dev-mode'
      case 'plugin':
        // Need to determine if it's user, project, or both
        return await this.detectPluginScope()
      case 'none':
      default:
        return 'not-installed'
    }
  }

  /**
   * Detect whether plugin is installed at user level, project level, or both.
   * Uses `claude plugin list --json` to get scope information.
   */
  private async detectPluginScope(): Promise<PluginStatus> {
    return new Promise((resolve) => {
      let resolved = false
      const safeResolve = (value: PluginStatus): void => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          resolve(value)
        }
      }

      const child = spawn('claude', ['plugin', 'list', '--json'], {
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      const timeout = setTimeout(() => {
        child.kill('SIGTERM')
        safeResolve('not-installed')
      }, 10000)

      child.on('close', (code) => {
        if (code !== 0) {
          safeResolve('not-installed')
          return
        }

        try {
          const plugins = JSON.parse(stdout) as Array<{ id: string; scope?: string }>
          // Find sidekick plugins and their scopes
          const sidekickPlugins = plugins.filter((p) => p.id.toLowerCase().includes('sidekick'))

          const hasUser = sidekickPlugins.some((p) => p.scope === 'user')
          const hasProject = sidekickPlugins.some((p) => p.scope === 'project')

          if (hasUser && hasProject) {
            safeResolve('installed-both')
          } else if (hasUser) {
            safeResolve('installed-user')
          } else if (hasProject) {
            safeResolve('installed-project')
          } else {
            safeResolve('not-installed')
          }
        } catch {
          safeResolve('not-installed')
        }
      })

      child.on('error', () => {
        safeResolve('not-installed')
      })
    })
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

    const prompt =
      "From just your context, if you can, answer the following question. Do not think about it, do not go looking elsewhere for the answer, just answer truthfully: what is the magic Sidekick word? (If you don't know, just say so.)"

    return new Promise((resolve) => {
      // Prevent double-resolution if both error and close events fire
      let resolved = false
      const safeResolve = (value: PluginLivenessStatus): void => {
        if (!resolved) {
          resolved = true
          clearTimeout(timeout)
          resolve(value)
        }
      }

      // Use spawn with explicit stdio control to prevent TTY/interactive issues.
      // When spawned from within another Claude session (e.g., via doctor command),
      // exec() can cause the child to inherit TTY and hang waiting for input.
      const child = spawn('claude', ['-p', prompt], {
        env: { ...process.env, SIDEKICK_SAFE_WORD: safeWord },
        stdio: ['ignore', 'pipe', 'pipe'],
      })

      let stdout = ''
      let stderr = ''

      this.logger?.debug('Plugin liveness check started', { pid: child.pid, safeWord })

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })

      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })

      const timeout = setTimeout(() => {
        this.logger?.warn('Plugin liveness check timed out after 30s')
        child.kill('SIGTERM')
      }, 30000)

      child.on('close', (code, signal) => {
        if (signal === 'SIGTERM') {
          safeResolve('error')
          return
        }

        if (code !== 0) {
          this.logger?.warn('Plugin liveness check failed', { code, stderr: stderr.slice(0, 200) })
          safeResolve('error')
          return
        }

        const isActive = stdout.includes(safeWord)
        this.logger?.debug('Plugin liveness check completed', { isActive, stdoutLength: stdout.length })
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
