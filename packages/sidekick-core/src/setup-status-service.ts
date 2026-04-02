// packages/sidekick-core/src/setup-status-service.ts
//
// Focused facade: status-file CRUD, merged getters, health-check orchestration.
// Detection logic lives in api-key-detector, plugin-detector, and doctor-engine.
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { Logger } from '@sidekick/types'
import {
  UserSetupStatusSchema,
  ProjectSetupStatusSchema,
  type UserSetupStatus,
  type ProjectSetupStatus,
  type ApiKeyHealth,
  type ProjectApiKeyHealth,
  type StatuslineStatus,
} from '@sidekick/types'
import { installGitignoreSection } from './gitignore.js'
import type { UserApiKeyStatus, ProjectApiKeyStatus } from '@sidekick/types'
import {
  type ApiKeyName,
  type ApiKeyDetectionResult,
  type AllScopesDetectionResult,
  toScopeStatus,
  detectActualApiKey as _detectActualApiKey,
  detectAllApiKeys as _detectAllApiKeys,
  buildUserApiKeyStatus as _buildUserApiKeyStatus,
  buildProjectApiKeyStatus as _buildProjectApiKeyStatus,
  userApiKeyStatusFromHealth,
  projectApiKeyStatusFromHealth,
} from './api-key-detector.js'
import {
  detectActualStatusline as _detectActualStatusline,
  detectPluginInstallation as _detectPluginInstallation,
  detectPluginLiveness as _detectPluginLiveness,
  type PluginInstallationStatus,
  type PluginLivenessStatus,
} from './plugin-detector.js'
import { runDoctorCheck as _runDoctorCheck, type DoctorCheckOptions, type DoctorCheckResult } from './doctor-engine.js'

// Re-export extracted types for backward compatibility (barrel re-export pattern)
export type {
  ApiKeyName,
  ApiKeySource,
  ApiKeyDetectionResult,
  ScopeDetectionResult,
  AllScopesDetectionResult,
} from './api-key-detector.js'
export type { PluginInstallationStatus, PluginLivenessStatus } from './plugin-detector.js'
export type { DoctorCheckOptions, DoctorCheckResult, DoctorItemResult, DoctorApiKeyResult } from './doctor-engine.js'

// Filenames for status files (centralized to prevent collision bugs)
export const USER_STATUS_FILENAME = 'user-setup-status.json'
export const PROJECT_STATUS_FILENAME = 'setup-status.json'
/** @deprecated Old user-scope filename — intentionally equals PROJECT_STATUS_FILENAME because that collision was the bug. Kept for migration only. */
export const LEGACY_USER_STATUS_FILENAME = PROJECT_STATUS_FILENAME

export interface SetupStatusServiceOptions {
  homeDir?: string
  logger?: Logger
}

/**
 * SetupStatusService - Manages dual-scope setup status files.
 *
 * User-level: ~/.sidekick/user-setup-status.json
 * Project-level: .sidekick/setup-status.json
 *
 * Provides merged getters so consumers don't need to know about scope.
 * Detection logic is delegated to api-key-detector, plugin-detector, and doctor-engine.
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
    return path.join(this.homeDir, '.sidekick', USER_STATUS_FILENAME)
  }

  /** Legacy path for migration: old user-scope file that collided with project-scope */
  private get legacyUserStatusPath(): string {
    return path.join(this.homeDir, '.sidekick', LEGACY_USER_STATUS_FILENAME)
  }

  private get projectStatusPath(): string {
    return path.join(this.projectDir, '.sidekick', PROJECT_STATUS_FILENAME)
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
        // New file doesn't exist — try migrating from legacy location
        return this.migrateFromLegacyUserStatus()
      }
      if (err instanceof SyntaxError) {
        this.logger?.warn(`Corrupt ${USER_STATUS_FILENAME}, treating as missing`, {
          path: this.userStatusPath,
          error: err.message,
        })
        return null
      }
      throw err
    }
  }

  /**
   * Migration: read user status from the legacy `setup-status.json` location,
   * write it to the new `user-setup-status.json`, and remove the old file.
   *
   * Only migrates if the legacy file contains valid UserSetupStatus data
   * (not project-format data that may have been written by the collision bug).
   */
  private async migrateFromLegacyUserStatus(): Promise<UserSetupStatus | null> {
    try {
      const legacyContent = await fs.readFile(this.legacyUserStatusPath, 'utf-8')
      const parsed = UserSetupStatusSchema.safeParse(JSON.parse(legacyContent))
      if (!parsed.success) {
        // Legacy file exists but isn't valid user-format — don't migrate
        // (could be a project-format file from the collision bug)
        this.logger?.debug('Legacy user status file exists but is not valid user format, skipping migration', {
          path: this.legacyUserStatusPath,
        })
        return null
      }
      // Write to new location and remove legacy file
      this.logger?.info('Migrating user status from legacy location', {
        from: this.legacyUserStatusPath,
        to: this.userStatusPath,
      })
      await this.writeUserStatus(parsed.data)
      await fs.unlink(this.legacyUserStatusPath)
      this.logger?.info('Legacy user status migration complete')
      return parsed.data
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Neither new nor legacy file exists
        return null
      }
      if (err instanceof SyntaxError) {
        this.logger?.warn(`Corrupt legacy ${LEGACY_USER_STATUS_FILENAME}, treating as missing`, {
          path: this.legacyUserStatusPath,
          error: err.message,
        })
        return null
      }
      throw err
    }
  }

  async getProjectStatus(): Promise<ProjectSetupStatus | null> {
    // Guard: skip project-level reads when projectDir IS the home directory.
    // Symmetric with writeProjectStatus — prevents reading stale/wrong data
    // from ~/.sidekick/setup-status.json when ~ is the project dir.
    if (path.resolve(this.projectDir) === path.resolve(this.homeDir)) {
      this.logger?.debug('Skipping project status read: projectDir is the home directory', {
        projectDir: this.projectDir,
      })
      return null
    }
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
        this.logger?.warn(`Corrupt project ${PROJECT_STATUS_FILENAME}, treating as missing`, {
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
    await fs.writeFile(this.userStatusPath, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600 })
    await fs.chmod(this.userStatusPath, 0o600)
    this.logger?.debug('User setup status written', { path: this.userStatusPath })
  }

  async writeProjectStatus(status: ProjectSetupStatus): Promise<void> {
    // Guard: skip project-level writes when projectDir IS the home directory.
    // In that case project status is meaningless (~ is not a real project),
    // and writing would collide with / overwrite user-scope data.
    if (path.resolve(this.projectDir) === path.resolve(this.homeDir)) {
      this.logger?.warn('Skipping project status write: projectDir is the home directory', {
        projectDir: this.projectDir,
      })
      return
    }
    const validated = ProjectSetupStatusSchema.parse(status)
    const dir = path.dirname(this.projectStatusPath)
    await fs.mkdir(dir, { recursive: true })
    await fs.writeFile(this.projectStatusPath, JSON.stringify(validated, null, 2) + '\n', { mode: 0o600 })
    await fs.chmod(this.projectStatusPath, 0o600)
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

  // === Detection delegates ===

  /**
   * Detect actual API key by reading .env files.
   * Priority: project .env → user .env → environment variable.
   */
  async detectActualApiKey(keyName: ApiKeyName): Promise<ApiKeyDetectionResult> {
    return _detectActualApiKey(keyName, this.projectDir, this.homeDir)
  }

  /**
   * Detect API key across ALL scopes and optionally validate each.
   */
  async detectAllApiKeys(keyName: ApiKeyName, skipValidation = false): Promise<AllScopesDetectionResult> {
    return _detectAllApiKeys(keyName, this.projectDir, this.homeDir, skipValidation, this.logger)
  }

  /**
   * Build UserApiKeyStatus from detection results.
   */
  buildUserApiKeyStatus(detection: AllScopesDetectionResult): UserApiKeyStatus {
    return _buildUserApiKeyStatus(detection)
  }

  /**
   * Build ProjectApiKeyStatus from detection results.
   */
  buildProjectApiKeyStatus(detection: AllScopesDetectionResult): ProjectApiKeyStatus {
    return _buildProjectApiKeyStatus(detection)
  }

  /**
   * Build a UserApiKeyStatus from a simple health string.
   */
  static userApiKeyStatusFromHealth = userApiKeyStatusFromHealth

  /**
   * Build a ProjectApiKeyStatus from a simple health string.
   */
  static projectApiKeyStatusFromHealth = projectApiKeyStatusFromHealth

  /**
   * Detect actual statusline configuration by reading Claude settings files.
   */
  async detectActualStatusline(): Promise<StatuslineStatus> {
    return _detectActualStatusline(this.projectDir, this.homeDir)
  }

  /**
   * Detect plugin installation status.
   */
  async detectPluginInstallation(): Promise<PluginInstallationStatus> {
    return _detectPluginInstallation(this.projectDir, this.homeDir, this.logger)
  }

  /**
   * Detect if sidekick hooks are actually responding.
   */
  async detectPluginLiveness(): Promise<PluginLivenessStatus> {
    return _detectPluginLiveness(this.projectDir, this.logger)
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

    // Install gitignore section (idempotent — safe to call repeatedly)
    const gitResult = await installGitignoreSection(this.projectDir)
    const gitignoreStatus = gitResult.status === 'error' ? 'missing' : 'installed'
    if (gitResult.status === 'error') {
      this.logger?.warn('Gitignore installation failed during auto-configure', {
        projectDir: this.projectDir,
        error: gitResult.error,
      })
    }

    // Create project status that delegates API keys to user level.
    // Uses 'user' string (not object format) intentionally — this is a delegation marker
    // meaning "check user-level status for real health". No scope detection is performed.
    // Note: devMode is not preserved here because isProjectConfigured() above confirmed
    // no project status exists (devMode is only set via setDevMode which creates status first).
    const projectStatus: ProjectSetupStatus = {
      version: 1,
      lastUpdatedAt: new Date().toISOString(),
      autoConfigured: true,
      statusline: 'user',
      apiKeys: {
        OPENROUTER_API_KEY: 'user',
        OPENAI_API_KEY: 'user',
      },
      gitignore: gitignoreStatus,
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
    return _runDoctorCheck(this.projectDir, this.homeDir, this, options, this.logger)
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
