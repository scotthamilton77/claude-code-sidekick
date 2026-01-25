// packages/sidekick-core/src/setup-status-service.ts
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
} from '@sidekick/types'

export type ApiKeyName = 'OPENROUTER_API_KEY' | 'OPENAI_API_KEY'

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
