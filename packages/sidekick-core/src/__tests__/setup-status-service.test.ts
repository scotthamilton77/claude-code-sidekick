import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'

// Mock child_process spawn for detectPluginLiveness tests
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
  }
})

/**
 * Create a mock ChildProcess for spawn tests.
 * Returns an EventEmitter with stdout/stderr streams that can emit data.
 */
function createMockChildProcess(): EventEmitter & {
  stdout: EventEmitter
  stderr: EventEmitter
  pid: number
  kill: ReturnType<typeof vi.fn>
} {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter
    stderr: EventEmitter
    pid: number
    kill: ReturnType<typeof vi.fn>
  }
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.pid = 12345
  proc.kill = vi.fn()
  return proc
}
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { SetupStatusService, USER_STATUS_FILENAME, PROJECT_STATUS_FILENAME } from '../setup-status-service.js'
import type { UserSetupStatus, ProjectSetupStatus } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'

describe('SetupStatusService', () => {
  let tempDir: string
  let projectDir: string
  let homeDir: string
  let service: SetupStatusService
  let savedOpenRouterKey: string | undefined
  let savedOpenAIKey: string | undefined

  beforeEach(async () => {
    // Isolate from real environment API keys
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY
    savedOpenAIKey = process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENAI_API_KEY

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-status-test-'))
    projectDir = path.join(tempDir, 'project')
    homeDir = path.join(tempDir, 'home')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(homeDir, { recursive: true })
    service = new SetupStatusService(projectDir, { homeDir })
  })

  afterEach(async () => {
    // Restore environment API keys
    if (savedOpenRouterKey !== undefined) {
      process.env.OPENROUTER_API_KEY = savedOpenRouterKey
    }
    if (savedOpenAIKey !== undefined) {
      process.env.OPENAI_API_KEY = savedOpenAIKey
    }
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // Helper to create valid status objects
  // Note: statusline values are now 'user' | 'project' | 'both' | 'none' (where it's configured)
  const createUserStatus = (overrides?: Partial<UserSetupStatus>): UserSetupStatus => ({
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    preferences: {
      autoConfigureProjects: true,
      defaultStatuslineScope: 'user',
      defaultApiKeyScope: 'user',
    },
    statusline: 'user', // Configured at user level
    apiKeys: {
      OPENROUTER_API_KEY: 'healthy',
      OPENAI_API_KEY: 'not-required',
    },
    ...overrides,
  })

  const createProjectStatus = (overrides?: Partial<ProjectSetupStatus>): ProjectSetupStatus => ({
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    autoConfigured: false,
    statusline: 'user', // Configured at user level (or 'none' if not configured)
    apiKeys: {
      OPENROUTER_API_KEY: 'user',
      OPENAI_API_KEY: 'user',
    },
    gitignore: 'unknown',
    ...overrides,
  })

  // Helper to write status files
  const writeUserStatus = async (status: UserSetupStatus): Promise<void> => {
    const userStatusPath = path.join(homeDir, '.sidekick', USER_STATUS_FILENAME)
    await fs.mkdir(path.dirname(userStatusPath), { recursive: true })
    await fs.writeFile(userStatusPath, JSON.stringify(status, null, 2))
  }

  const writeProjectStatus = async (status: ProjectSetupStatus): Promise<void> => {
    const projectStatusPath = path.join(projectDir, '.sidekick', PROJECT_STATUS_FILENAME)
    await fs.mkdir(path.dirname(projectStatusPath), { recursive: true })
    await fs.writeFile(projectStatusPath, JSON.stringify(status, null, 2))
  }

  const writeEnvFile = async (scope: 'user' | 'project', content: string): Promise<void> => {
    const envPath =
      scope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')
    await fs.mkdir(path.dirname(envPath), { recursive: true })
    await fs.writeFile(envPath, content)
  }

  const writeClaudeSettings = async (scope: 'user' | 'project', settings: Record<string, unknown>): Promise<void> => {
    const settingsPath =
      scope === 'user'
        ? path.join(homeDir, '.claude', 'settings.json')
        : path.join(projectDir, '.claude', 'settings.local.json')
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
  }

  describe('getUserStatus', () => {
    it('returns null when no user status file exists', async () => {
      const result = await service.getUserStatus()
      expect(result).toBeNull()
    })

    it('reads and parses valid user status file', async () => {
      const status = createUserStatus()
      await writeUserStatus(status)

      const result = await service.getUserStatus()
      expect(result).toEqual(status)
    })

    it('returns null when user status file contains corrupt JSON', async () => {
      const userStatusPath = path.join(homeDir, '.sidekick', USER_STATUS_FILENAME)
      await fs.mkdir(path.dirname(userStatusPath), { recursive: true })
      await fs.writeFile(userStatusPath, '{invalid json}')

      const result = await service.getUserStatus()
      expect(result).toBeNull()
    })

    it('returns null when user status file contains invalid schema', async () => {
      const userStatusPath = path.join(homeDir, '.sidekick', USER_STATUS_FILENAME)
      await fs.mkdir(path.dirname(userStatusPath), { recursive: true })
      await fs.writeFile(userStatusPath, JSON.stringify({ version: 2 }))

      const result = await service.getUserStatus()
      expect(result).toBeNull()
    })
  })

  describe('writeProjectStatus - homeDir collision guard', () => {
    it('skips writing when projectDir equals homeDir', async () => {
      const collisionService = new SetupStatusService(homeDir, { homeDir })
      const status = createProjectStatus()

      // Should silently skip
      await collisionService.writeProjectStatus(status)

      // No project-scope file should have been created in ~/.sidekick/
      const projectPath = path.join(homeDir, '.sidekick', PROJECT_STATUS_FILENAME)
      await expect(fs.access(projectPath)).rejects.toThrow()
    })

    it('logs a warning when projectDir equals homeDir', async () => {
      const mockLogger = createFakeLogger()
      const collisionService = new SetupStatusService(homeDir, { homeDir, logger: mockLogger })
      const status = createProjectStatus()

      await collisionService.writeProjectStatus(status)

      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Skipping project status write: projectDir is the home directory',
        expect.objectContaining({ projectDir: homeDir })
      )
    })

    it('writes normally when projectDir differs from homeDir', async () => {
      const status = createProjectStatus()
      await service.writeProjectStatus(status)

      const projectPath = path.join(projectDir, '.sidekick', PROJECT_STATUS_FILENAME)
      const content = await fs.readFile(projectPath, 'utf-8')
      expect(JSON.parse(content).version).toBe(1)
    })
  })

  describe('getProjectStatus', () => {
    it('returns null when no project status file exists', async () => {
      const result = await service.getProjectStatus()
      expect(result).toBeNull()
    })

    it('reads and parses valid project status file', async () => {
      const status = createProjectStatus()
      await writeProjectStatus(status)

      const result = await service.getProjectStatus()
      expect(result).toEqual(status)
    })

    it('returns null when project status file contains corrupt JSON', async () => {
      const projectStatusPath = path.join(projectDir, '.sidekick', PROJECT_STATUS_FILENAME)
      await fs.mkdir(path.dirname(projectStatusPath), { recursive: true })
      await fs.writeFile(projectStatusPath, '{invalid json}')

      const result = await service.getProjectStatus()
      expect(result).toBeNull()
    })

    it('returns null when project status file contains invalid schema', async () => {
      const projectStatusPath = path.join(projectDir, '.sidekick', PROJECT_STATUS_FILENAME)
      await fs.mkdir(path.dirname(projectStatusPath), { recursive: true })
      await fs.writeFile(projectStatusPath, JSON.stringify({ version: 2 }))

      const result = await service.getProjectStatus()
      expect(result).toBeNull()
    })

    it('returns null when projectDir equals homeDir', async () => {
      const collisionService = new SetupStatusService(homeDir, { homeDir })
      // Even if a file exists at ~/.sidekick/setup-status.json, the guard should prevent reading it
      const projectPath = path.join(homeDir, '.sidekick', PROJECT_STATUS_FILENAME)
      await fs.mkdir(path.dirname(projectPath), { recursive: true })
      await fs.writeFile(projectPath, JSON.stringify(createProjectStatus(), null, 2))

      const result = await collisionService.getProjectStatus()
      expect(result).toBeNull()
    })

    it('logs a debug message when projectDir equals homeDir', async () => {
      const mockLogger = createFakeLogger()
      const collisionService = new SetupStatusService(homeDir, { homeDir, logger: mockLogger })

      await collisionService.getProjectStatus()

      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Skipping project status read: projectDir is the home directory',
        expect.objectContaining({ projectDir: homeDir })
      )
    })
  })

  describe('getStatuslineHealth', () => {
    it('returns "none" when no status files exist', async () => {
      const result = await service.getStatuslineHealth()
      expect(result).toBe('none')
    })

    it('returns user status when project status is "user"', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'user' }))
      await writeProjectStatus(createProjectStatus({ statusline: 'user' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('user')
    })

    it('returns "user" when project status is "user"', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'user' }))
      await writeProjectStatus(createProjectStatus({ statusline: 'user' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('user')
    })

    it('returns "none" when project status is "none"', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'user' }))
      await writeProjectStatus(createProjectStatus({ statusline: 'none' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('none')
    })

    it('returns "user" when project cache says statusline is at user level', async () => {
      // Project cache reports statusline is configured at user level
      // (This is cached knowledge, not delegation)
      await writeProjectStatus(createProjectStatus({ statusline: 'user' }))

      const result = await service.getStatuslineHealth()
      // Returns the cached status - "statusline is at user level"
      expect(result).toBe('user')
    })

    it('returns user status when only user status exists', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'user' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('user')
    })

    it('returns cached value from project status (project takes precedence)', async () => {
      // Project status takes precedence over user status
      await writeUserStatus(createUserStatus({ statusline: 'project' }))
      await writeProjectStatus(createProjectStatus({ statusline: 'user' }))

      const result = await service.getStatuslineHealth()
      // Project status wins, reports 'user' (statusline at user level)
      expect(result).toBe('user')
    })
  })

  describe('getApiKeyHealth', () => {
    it('returns "missing" when no status files exist', async () => {
      const result = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      expect(result).toBe('missing')
    })

    it('returns user status when project status is "user"', async () => {
      await writeUserStatus(
        createUserStatus({
          apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' },
        })
      )
      await writeProjectStatus(
        createProjectStatus({
          apiKeys: { OPENROUTER_API_KEY: 'user', OPENAI_API_KEY: 'user' },
        })
      )

      const result = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      expect(result).toBe('healthy')
    })

    it('returns project status when project status is "healthy"', async () => {
      await writeUserStatus(
        createUserStatus({
          apiKeys: { OPENROUTER_API_KEY: 'invalid', OPENAI_API_KEY: 'not-required' },
        })
      )
      await writeProjectStatus(
        createProjectStatus({
          apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'user' },
        })
      )

      const result = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      expect(result).toBe('healthy')
    })

    it('returns project status when project status is "invalid"', async () => {
      await writeUserStatus(
        createUserStatus({
          apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' },
        })
      )
      await writeProjectStatus(
        createProjectStatus({
          apiKeys: { OPENROUTER_API_KEY: 'invalid', OPENAI_API_KEY: 'user' },
        })
      )

      const result = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      expect(result).toBe('invalid')
    })

    it('returns "missing" when project wants user status but user status missing', async () => {
      await writeProjectStatus(createProjectStatus({ apiKeys: { OPENROUTER_API_KEY: 'user', OPENAI_API_KEY: 'user' } }))

      const result = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      expect(result).toBe('missing')
    })

    it('returns user status when only user status exists', async () => {
      await writeUserStatus(
        createUserStatus({
          apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' },
        })
      )

      const result = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      expect(result).toBe('healthy')
    })

    it('returns "missing" when only project status exists and is "user"', async () => {
      await writeProjectStatus(
        createProjectStatus({
          apiKeys: { OPENROUTER_API_KEY: 'user', OPENAI_API_KEY: 'user' },
        })
      )

      const result = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      expect(result).toBe('missing')
    })

    it('returns "missing" when key is not present in any status', async () => {
      await writeUserStatus(createUserStatus({ apiKeys: {} as any }))
      await writeProjectStatus(createProjectStatus({ apiKeys: {} as any }))

      const result = await service.getApiKeyHealth('SOME_OTHER_KEY' as any)
      expect(result).toBe('missing')
    })

    it('returns "not-required" status correctly', async () => {
      await writeUserStatus(
        createUserStatus({
          apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' },
        })
      )

      const result = await service.getApiKeyHealth('OPENAI_API_KEY')
      expect(result).toBe('not-required')
    })

    it('returns "missing" status correctly', async () => {
      await writeUserStatus(
        createUserStatus({
          apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'not-required' },
        })
      )

      const result = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      expect(result).toBe('missing')
    })
  })

  describe('shouldAutoConfigureProject', () => {
    it('returns false when no user status exists', async () => {
      const result = await service.shouldAutoConfigureProject()
      expect(result).toBe(false)
    })

    it('returns false when autoConfigureProjects is false', async () => {
      await writeUserStatus(
        createUserStatus({
          preferences: {
            autoConfigureProjects: false,
            defaultStatuslineScope: 'user',
            defaultApiKeyScope: 'user',
          },
        })
      )

      const result = await service.shouldAutoConfigureProject()
      expect(result).toBe(false)
    })

    it('returns false when project status already exists', async () => {
      await writeUserStatus(
        createUserStatus({
          preferences: {
            autoConfigureProjects: true,
            defaultStatuslineScope: 'user',
            defaultApiKeyScope: 'user',
          },
        })
      )
      await writeProjectStatus(createProjectStatus())

      const result = await service.shouldAutoConfigureProject()
      expect(result).toBe(false)
    })

    it('returns true when autoConfigureProjects is true and no project status exists', async () => {
      await writeUserStatus(
        createUserStatus({
          preferences: {
            autoConfigureProjects: true,
            defaultStatuslineScope: 'user',
            defaultApiKeyScope: 'user',
          },
        })
      )

      const result = await service.shouldAutoConfigureProject()
      expect(result).toBe(true)
    })
  })

  describe('autoConfigureProject', () => {
    it('returns false when no user status exists', async () => {
      const result = await service.autoConfigureProject()
      expect(result).toBe(false)

      // Verify no project status was created
      const projectStatus = await service.getProjectStatus()
      expect(projectStatus).toBeNull()
    })

    it('returns false when autoConfigureProjects is false', async () => {
      await writeUserStatus(
        createUserStatus({
          preferences: {
            autoConfigureProjects: false,
            defaultStatuslineScope: 'user',
            defaultApiKeyScope: 'user',
          },
        })
      )

      const result = await service.autoConfigureProject()
      expect(result).toBe(false)

      // Verify no project status was created
      const projectStatus = await service.getProjectStatus()
      expect(projectStatus).toBeNull()
    })

    it('returns false when project already configured', async () => {
      await writeUserStatus(
        createUserStatus({
          preferences: {
            autoConfigureProjects: true,
            defaultStatuslineScope: 'user',
            defaultApiKeyScope: 'user',
          },
        })
      )
      const existingProjectStatus = createProjectStatus()
      await writeProjectStatus(existingProjectStatus)

      const result = await service.autoConfigureProject()
      expect(result).toBe(false)

      // Verify project status was not modified
      const projectStatus = await service.getProjectStatus()
      expect(projectStatus?.autoConfigured).toBe(false)
    })

    it('auto-configures project when user has autoConfigureProjects enabled', async () => {
      await writeUserStatus(
        createUserStatus({
          preferences: {
            autoConfigureProjects: true,
            defaultStatuslineScope: 'user',
            defaultApiKeyScope: 'user',
          },
        })
      )

      const result = await service.autoConfigureProject()
      expect(result).toBe(true)

      // Verify project status was created with expected values
      const projectStatus = await service.getProjectStatus()
      expect(projectStatus).not.toBeNull()
      expect(projectStatus?.autoConfigured).toBe(true)
      expect(projectStatus?.statusline).toBe('user')
      expect(projectStatus?.apiKeys.OPENROUTER_API_KEY).toBe('user')
      expect(projectStatus?.apiKeys.OPENAI_API_KEY).toBe('user')
      expect(projectStatus?.gitignore).toBe('installed')

      // Verify .gitignore was actually created with sidekick section
      const gitignoreContent = await fs.readFile(path.join(projectDir, '.gitignore'), 'utf-8')
      expect(gitignoreContent).toContain('# >>> sidekick')
      expect(gitignoreContent).toContain('.sidekick/logs/')
    })

    it('is idempotent - second call returns false', async () => {
      await writeUserStatus(
        createUserStatus({
          preferences: {
            autoConfigureProjects: true,
            defaultStatuslineScope: 'user',
            defaultApiKeyScope: 'user',
          },
        })
      )

      // First call should auto-configure
      const result1 = await service.autoConfigureProject()
      expect(result1).toBe(true)

      // Second call should return false (already configured)
      const result2 = await service.autoConfigureProject()
      expect(result2).toBe(false)
    })
  })

  describe('writeUserStatus', () => {
    it('creates directory and writes status file', async () => {
      const status = createUserStatus()
      await service.writeUserStatus(status)

      const writtenStatus = await service.getUserStatus()
      expect(writtenStatus).toEqual(status)
    })

    it('does not update lastUpdatedAt timestamp automatically', async () => {
      const status = createUserStatus({ lastUpdatedAt: '2020-01-01T00:00:00.000Z' })
      await service.writeUserStatus(status)

      const writtenStatus = await service.getUserStatus()
      expect(writtenStatus?.lastUpdatedAt).toBe('2020-01-01T00:00:00.000Z')
    })

    it('overwrites existing status file', async () => {
      const initialStatus = createUserStatus({ statusline: 'none' })
      await service.writeUserStatus(initialStatus)

      const updatedStatus = createUserStatus({ statusline: 'user' })
      await service.writeUserStatus(updatedStatus)

      const writtenStatus = await service.getUserStatus()
      expect(writtenStatus?.statusline).toBe('user')
    })

    it('sets file permissions to 0o600', async () => {
      const status = createUserStatus()
      await service.writeUserStatus(status)

      const userStatusPath = path.join(homeDir, '.sidekick', USER_STATUS_FILENAME)
      const stat = await fs.stat(userStatusPath)
      // 0o600 = owner read/write only (octal 0100600 includes file type bits)
      expect(stat.mode & 0o777).toBe(0o600)
    })
  })

  describe('writeProjectStatus', () => {
    it('creates directory and writes status file', async () => {
      const status = createProjectStatus()
      await service.writeProjectStatus(status)

      const writtenStatus = await service.getProjectStatus()
      expect(writtenStatus).toEqual(status)
    })

    it('does not update lastUpdatedAt timestamp automatically', async () => {
      const status = createProjectStatus({ lastUpdatedAt: '2020-01-01T00:00:00.000Z' })
      await service.writeProjectStatus(status)

      const writtenStatus = await service.getProjectStatus()
      expect(writtenStatus?.lastUpdatedAt).toBe('2020-01-01T00:00:00.000Z')
    })

    it('overwrites existing status file', async () => {
      const initialStatus = createProjectStatus({ statusline: 'none' })
      await service.writeProjectStatus(initialStatus)

      const updatedStatus = createProjectStatus({ statusline: 'user' })
      await service.writeProjectStatus(updatedStatus)

      const writtenStatus = await service.getProjectStatus()
      expect(writtenStatus?.statusline).toBe('user')
    })

    it('sets file permissions to 0o600', async () => {
      const status = createProjectStatus()
      await service.writeProjectStatus(status)

      const projectStatusPath = path.join(projectDir, '.sidekick', PROJECT_STATUS_FILENAME)
      const stat = await fs.stat(projectStatusPath)
      expect(stat.mode & 0o777).toBe(0o600)
    })
  })

  describe('isHealthy', () => {
    it('returns false when statusline is skipped', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'none' }))

      const result = await service.isHealthy()
      expect(result).toBe(false)
    })

    it('returns false when any required API key is invalid', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'user',
          apiKeys: {
            OPENROUTER_API_KEY: 'invalid',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )

      const result = await service.isHealthy()
      expect(result).toBe(false)
    })

    it('returns false when any required API key is missing', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'user',
          apiKeys: {
            OPENROUTER_API_KEY: 'missing',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )

      const result = await service.isHealthy()
      expect(result).toBe(false)
    })

    it('returns true when statusline is configured and all required API keys are healthy', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'user',
          apiKeys: {
            OPENROUTER_API_KEY: 'healthy',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )

      const result = await service.isHealthy()
      expect(result).toBe(true)
    })

    it('returns true when statusline is configured and no API keys are required', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'user',
          apiKeys: {
            OPENROUTER_API_KEY: 'not-required',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )

      const result = await service.isHealthy()
      expect(result).toBe(true)
    })

    it('returns false when required API key is missing even if statusline is configured', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'user',
          apiKeys: {} as any,
        })
      )

      const result = await service.isHealthy()
      expect(result).toBe(false)
    })

    it('uses merged status from project and user', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'user',
          apiKeys: {
            OPENROUTER_API_KEY: 'healthy',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )
      await writeProjectStatus(
        createProjectStatus({
          statusline: 'user',
          apiKeys: {
            OPENROUTER_API_KEY: 'user',
            OPENAI_API_KEY: 'user',
          },
        })
      )

      const result = await service.isHealthy()
      expect(result).toBe(true)
    })

    it('returns false when merged status has invalid API key', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'user',
          apiKeys: {
            OPENROUTER_API_KEY: 'healthy',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )
      await writeProjectStatus(
        createProjectStatus({
          statusline: 'user',
          apiKeys: {
            OPENROUTER_API_KEY: 'invalid',
            OPENAI_API_KEY: 'user',
          },
        })
      )

      const result = await service.isHealthy()
      expect(result).toBe(false)
    })
  })

  describe('getSetupState', () => {
    it('returns not-run when neither user nor project status exists', async () => {
      const state = await service.getSetupState()
      expect(state).toBe('not-run')
    })

    it('returns partial when user status exists but project does not', async () => {
      await writeUserStatus(createUserStatus())
      const state = await service.getSetupState()
      expect(state).toBe('partial')
    })

    it('returns healthy when both user and project status exist and are healthy', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'user' }))
      await writeProjectStatus(createProjectStatus({ statusline: 'user' }))
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')

      const state = await service.getSetupState()
      expect(state).toBe('healthy')
    })

    it('returns healthy when user status is missing but project is healthy', async () => {
      // This is the bug: previously returned 'not-run' causing "Sidekick not configured" message
      await writeProjectStatus(
        createProjectStatus({
          statusline: 'project',
          apiKeys: {
            OPENROUTER_API_KEY: {
              status: 'healthy',
              scopes: { project: 'healthy', user: 'missing', env: 'missing' },
              used: 'project',
            },
            OPENAI_API_KEY: 'not-required',
          },
        })
      )
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-test-key\n')

      const state = await service.getSetupState()
      expect(state).toBe('healthy')
    })

    it('returns unhealthy when user status is missing and project has invalid key', async () => {
      await writeProjectStatus(
        createProjectStatus({
          statusline: 'project',
          apiKeys: {
            OPENROUTER_API_KEY: 'invalid',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })

      const state = await service.getSetupState()
      expect(state).toBe('unhealthy')
    })

    it('returns unhealthy when user status is missing and project has no statusline', async () => {
      // Project status file exists (setup was run) but config is incomplete
      await writeProjectStatus(
        createProjectStatus({
          statusline: 'none',
          apiKeys: {
            OPENROUTER_API_KEY: 'missing',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )

      const state = await service.getSetupState()
      expect(state).toBe('unhealthy')
    })
  })

  describe('detectActualStatusline', () => {
    it('returns "none" when no settings files exist', async () => {
      const result = await service.detectActualStatusline()
      expect(result).toBe('none')
    })

    it('returns "user" when user settings has sidekick statusline', async () => {
      await writeClaudeSettings('user', {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
      })

      const result = await service.detectActualStatusline()
      expect(result).toBe('user')
    })

    it('returns "project" when project settings has sidekick statusline', async () => {
      await writeClaudeSettings('project', {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
      })

      const result = await service.detectActualStatusline()
      expect(result).toBe('project')
    })

    it('returns "none" when settings exist but no statusLine key', async () => {
      await writeClaudeSettings('user', { someOtherKey: 'value' })

      const result = await service.detectActualStatusline()
      expect(result).toBe('none')
    })

    it('returns "none" when statusLine exists but is not sidekick', async () => {
      await writeClaudeSettings('user', {
        statusLine: {
          type: 'command',
          command: 'some-other-tool statusline',
        },
      })

      const result = await service.detectActualStatusline()
      expect(result).toBe('none')
    })

    it('returns "user" when command contains "sidekick" anywhere', async () => {
      await writeClaudeSettings('user', {
        statusLine: {
          type: 'command',
          command: '/path/to/sidekick/statusline',
        },
      })

      const result = await service.detectActualStatusline()
      expect(result).toBe('user')
    })

    it('returns "user" when only user settings has sidekick statusline', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'other-tool statusline' },
      })

      // Project has non-sidekick statusline, user has sidekick - returns 'user'
      const result = await service.detectActualStatusline()
      expect(result).toBe('user')
    })
  })

  describe('detectActualApiKey', () => {
    it('returns null key and null source when no .env files exist', async () => {
      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result.key).toBeNull()
      expect(result.source).toBeNull()
    })

    it('returns user-env source when key found in user .env', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result.key).toBe('user-key')
      expect(result.source).toBe('user-env')
    })

    it('returns project-env source when key found in project .env', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=project-key\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result.key).toBe('project-key')
      expect(result.source).toBe('project-env')
    })

    it('returns project-env source when key exists in both (project takes precedence)', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')
      await writeEnvFile('project', 'OPENROUTER_API_KEY=project-key\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result.key).toBe('project-key')
      expect(result.source).toBe('project-env')
    })

    it('returns user-env source when key is in both user .env and environment variable', async () => {
      const originalEnv = process.env.OPENROUTER_API_KEY
      process.env.OPENROUTER_API_KEY = 'env-var-key'

      try {
        await writeEnvFile('user', 'OPENROUTER_API_KEY=file-key\n')
        const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
        // Priority: project → user → env; user .env wins over env var
        expect(result.key).toBe('file-key')
        expect(result.source).toBe('user-env')
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv
        }
      }
    })

    it('falls back to user-env when project .env does not have the key', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')
      await writeEnvFile('project', 'OTHER_KEY=other-value\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result.key).toBe('user-key')
      expect(result.source).toBe('user-env')
    })
  })

  describe('runDoctorCheck', () => {
    it('detects statusline is configured when no cache exists', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })

      const result = await service.runDoctorCheck()

      expect(result.statusline.actual).toBe('user')
      expect(result.statusline.cached).toBe('none')
      expect(result.statusline.fixed).toBe(true)
    })

    it('detects cache is correct and reports no fix needed', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await service.writeUserStatus(createUserStatus({ statusline: 'user' }))

      const result = await service.runDoctorCheck()

      expect(result.statusline.actual).toBe('user')
      expect(result.statusline.cached).toBe('user')
      expect(result.statusline.fixed).toBe(false)
    })

    it('updates user cache when statusline detected but cache says not-setup', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })

      await service.runDoctorCheck()

      const userStatus = await service.getUserStatus()
      expect(userStatus?.statusline).toBe('user')
    })

    it('detects API key exists when cache says missing', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      // When skipValidation is true, we assume the key is healthy (not pending-validation)
      expect(result.apiKeys.OPENROUTER_API_KEY.actual).toBe('healthy')
      expect(result.apiKeys.OPENROUTER_API_KEY.cached).toBe('missing')
      expect(result.apiKeys.OPENROUTER_API_KEY.fixed).toBe(true)
    })

    it('reports overall health correctly', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.overallHealth).toBe('healthy')
    })

    it('reports unhealthy when statusline not configured', async () => {
      // No statusline configured

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.overallHealth).toBe('unhealthy')
    })

    it('returns list of fixes made', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.fixes).toContain('Statusline was actually configured at user level (updated cache)')
      expect(result.fixes).toContain('OPENROUTER_API_KEY was actually present (updated cache)')
    })

    it('returns empty fixes array when cache is accurate', async () => {
      // No config, no cache - both agree on not-setup/missing
      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.fixes).toHaveLength(0)
    })

    it('updates project cache when API key found in project .env (Bug #1 fix)', async () => {
      // Setup: Key in project .env, user status exists, project status exists with 'missing'
      await writeEnvFile('project', 'OPENROUTER_API_KEY=project-key\n')
      await service.writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'not-required' } })
      )
      await service.writeProjectStatus(
        createProjectStatus({ apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'user' } })
      )

      await service.runDoctorCheck({ skipValidation: true })

      // Bug fix: Should update PROJECT status, not user status
      // Now uses new comprehensive format with scopes
      const projectStatus = await service.getProjectStatus()
      const apiKeyStatus = projectStatus?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.status).toBe('healthy') // skipValidation assumes healthy
        expect(apiKeyStatus.used).toBe('project')
        expect(apiKeyStatus.scopes.project).toBe('healthy')
      }

      // User status should remain unchanged
      const userStatus = await service.getUserStatus()
      expect(userStatus?.apiKeys.OPENROUTER_API_KEY).toBe('missing')
    })

    it('updates user cache when API key found in user .env', async () => {
      // Setup: Key in user .env, user status exists with 'missing'
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')
      await service.writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'not-required' } })
      )

      await service.runDoctorCheck({ skipValidation: true })

      // Should update project status (doctor always writes to project for comprehensive info)
      // User status remains unchanged - the comprehensive status is in project
      const projectStatus = await service.getProjectStatus()
      const apiKeyStatus = projectStatus?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.status).toBe('healthy')
        expect(apiKeyStatus.used).toBe('user')
        expect(apiKeyStatus.scopes.user).toBe('healthy')
      }
    })

    it('fixes cache when key is missing but cache says healthy (Bug #2 fix)', async () => {
      // Setup: No key present, but cache says 'healthy'
      await service.writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' } })
      )

      const result = await service.runDoctorCheck({ skipValidation: true })

      // Should fix the cache - now writes to project status
      expect(result.apiKeys.OPENROUTER_API_KEY.fixed).toBe(true)
      expect(result.fixes).toContain('OPENROUTER_API_KEY was actually missing (updated cache)')

      const projectStatus = await service.getProjectStatus()
      const apiKeyStatus = projectStatus?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.status).toBe('missing')
        expect(apiKeyStatus.used).toBeNull()
      }
    })

    it('fixes cache when key is missing but cache says pending-validation (Bug #2 fix)', async () => {
      // Setup: No key present, but cache says 'pending-validation'
      await service.writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'pending-validation', OPENAI_API_KEY: 'not-required' } })
      )

      const result = await service.runDoctorCheck({ skipValidation: true })

      // Should fix the cache to 'missing'
      expect(result.apiKeys.OPENROUTER_API_KEY.fixed).toBe(true)
      expect(result.fixes).toContain('OPENROUTER_API_KEY was actually missing (updated cache)')
    })

    it('does not change cache when key is missing and cache says not-required', async () => {
      // Setup: No key present, cache says 'not-required' (user opted out)
      await service.writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'not-required', OPENAI_API_KEY: 'not-required' } })
      )

      const result = await service.runDoctorCheck({ skipValidation: true })

      // Should NOT change the cache - user explicitly opted out
      expect(result.apiKeys.OPENROUTER_API_KEY.fixed).toBe(false)

      const userStatus = await service.getUserStatus()
      expect(userStatus?.apiKeys.OPENROUTER_API_KEY).toBe('not-required')
    })

    it('does not change cache when actual matches cached (healthy)', async () => {
      // Setup: Key present in user .env, cache says 'healthy'
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')
      await service.writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' } })
      )

      const result = await service.runDoctorCheck({ skipValidation: true })

      // Cache is already correct (key exists and cache says healthy)
      expect(result.apiKeys.OPENROUTER_API_KEY.fixed).toBe(false)
    })

    it('creates project status file when fixing API key found in project .env', async () => {
      // No status files exist initially
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-project-key\n')

      await service.runDoctorCheck({ skipValidation: true })

      // Should create project status since key was found in project .env
      // Now uses new comprehensive format
      const projectStatus = await service.getProjectStatus()
      expect(projectStatus).not.toBeNull()
      const apiKeyStatus = projectStatus?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.status).toBe('healthy') // skipValidation assumes healthy
        expect(apiKeyStatus.used).toBe('project')
        expect(apiKeyStatus.scopes.project).toBe('healthy')
      }
    })

    it('sets statusline to configured in new project status when statusline is actually configured', async () => {
      // Configure statusline in project settings
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'pnpm sidekick statusline' },
      })
      // Also have an API key to trigger status file creation
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-project-key\n')

      await service.runDoctorCheck({ skipValidation: true })

      const projectStatus = await service.getProjectStatus()
      expect(projectStatus?.statusline).toBe('project')
    })

    it('sets statusline to none in new project status when statusline not actually configured in Claude settings', async () => {
      // User status exists with cached statusline: 'user', but no actual statusline in Claude settings
      await writeUserStatus(
        createUserStatus({
          statusline: 'user', // This is what CACHE says, not reality
          apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'not-required' },
        })
      )
      // Project API key triggers status file creation (cache says missing, reality says present)
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-project-key\n')

      await service.runDoctorCheck({ skipValidation: true })

      const projectStatus = await service.getProjectStatus()
      // 'none' because detectActualStatusline() checks real Claude settings, not cache
      expect(projectStatus?.statusline).toBe('none')
    })

    it('sets statusline to skipped in new project status when nothing configured and no user status', async () => {
      // No statusline configured anywhere, no user status exists
      // Only project API key exists
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-project-key\n')

      await service.runDoctorCheck({ skipValidation: true })

      const projectStatus = await service.getProjectStatus()
      // Should NOT say 'user' when there's nothing to delegate to
      // 'none' indicates "not configured anywhere"
      expect(projectStatus?.statusline).toBe('none')
    })

    it('creates user status file when fixing API key found in user .env', async () => {
      // No status files exist initially
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-user-key\n')

      await service.runDoctorCheck({ skipValidation: true })

      // Doctor creates project status for comprehensive info, and user status
      // Check project status has the right format
      const projectStatus = await service.getProjectStatus()
      expect(projectStatus).not.toBeNull()
      const apiKeyStatus = projectStatus?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.status).toBe('healthy')
        expect(apiKeyStatus.used).toBe('user')
        expect(apiKeyStatus.scopes.user).toBe('healthy')
      }

      // User status should also be created
      const userStatus = await service.getUserStatus()
      expect(userStatus).not.toBeNull()
    })

    it('reports which scope is used for project .env key', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-project-key\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.used).toBe('project')
    })

    it('reports which scope is used for user .env key', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-user-key\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.used).toBe('user')
    })

    it('reports null used when key is missing', async () => {
      // No .env files

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.used).toBeNull()
    })

    it('reports missing when personas are disabled and no API key present', async () => {
      // Write features.yaml with personas disabled — key is still needed for
      // non-persona LLM features (session titles, completion detection, etc.)
      const sidekickDir = path.join(homeDir, '.sidekick')
      await fs.mkdir(sidekickDir, { recursive: true })
      await fs.writeFile(path.join(sidekickDir, 'features.yaml'), 'personas:\n  enabled: false\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.actual).toBe('missing')
    })

    it('reports unhealthy when user setup-status file is missing but project exists', async () => {
      // Project status has correct cache — no fixes trigger, so user file never gets created.
      // But getSetupState() returns 'not-run' because user file is missing.
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-test-key\n')
      await service.writeProjectStatus(
        createProjectStatus({
          statusline: 'project',
          apiKeys: {
            OPENROUTER_API_KEY: {
              status: 'healthy',
              scopes: { project: 'healthy', user: 'missing', env: 'missing' },
              used: 'project',
            },
            OPENAI_API_KEY: 'not-required',
          },
        })
      )

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.userSetupExists).toBe(false)
      expect(result.overallHealth).toBe('unhealthy')
    })

    it('reports unhealthy (not crash) when user setup-status file contains corrupt JSON', async () => {
      const userStatusPath = path.join(homeDir, '.sidekick', USER_STATUS_FILENAME)
      await fs.mkdir(path.dirname(userStatusPath), { recursive: true })
      await fs.writeFile(userStatusPath, '{invalid json}')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.userSetupExists).toBe(false)
      expect(result.overallHealth).toBe('unhealthy')
    })

    it('reports healthy when user setup-status file exists with valid config', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')
      await service.writeUserStatus(
        createUserStatus({
          statusline: 'user',
          apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' },
        })
      )

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.userSetupExists).toBe(true)
      expect(result.overallHealth).toBe('healthy')
    })

    it('does not add user setup warning to cache fixes array', async () => {
      // User file missing is a diagnostic finding, not a cache correction
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-test-key\n')
      await service.writeProjectStatus(
        createProjectStatus({
          statusline: 'project',
          apiKeys: {
            OPENROUTER_API_KEY: {
              status: 'healthy',
              scopes: { project: 'healthy', user: 'missing', env: 'missing' },
              used: 'project',
            },
            OPENAI_API_KEY: 'not-required',
          },
        })
      )

      const result = await service.runDoctorCheck({ skipValidation: true })

      // fixes only contains cache corrections, not diagnostic findings
      expect(result.fixes).toHaveLength(0)
      expect(result.userSetupExists).toBe(false)
    })
  })

  describe('isPersonasEnabled', () => {
    it('returns true when features.yaml does not exist', async () => {
      expect(await service.isPersonasEnabled()).toBe(true)
    })

    it('returns true when personas enabled in features.yaml', async () => {
      const sidekickDir = path.join(homeDir, '.sidekick')
      await fs.mkdir(sidekickDir, { recursive: true })
      await fs.writeFile(path.join(sidekickDir, 'features.yaml'), 'personas:\n  enabled: true\n')
      expect(await service.isPersonasEnabled()).toBe(true)
    })

    it('returns false when personas disabled in features.yaml', async () => {
      const sidekickDir = path.join(homeDir, '.sidekick')
      await fs.mkdir(sidekickDir, { recursive: true })
      await fs.writeFile(path.join(sidekickDir, 'features.yaml'), 'personas:\n  enabled: false\n')
      expect(await service.isPersonasEnabled()).toBe(false)
    })

    it('returns true when features.yaml exists but has no personas section', async () => {
      const sidekickDir = path.join(homeDir, '.sidekick')
      await fs.mkdir(sidekickDir, { recursive: true })
      await fs.writeFile(path.join(sidekickDir, 'features.yaml'), 'reminders:\n  enabled: true\n')
      expect(await service.isPersonasEnabled()).toBe(true)
    })
  })

  describe('buildUserApiKeyStatus', () => {
    it('returns healthy with user scope when user key is healthy', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: true, key: 'sk-user', status: 'healthy' },
        env: { found: false, key: null, status: 'missing' },
      }

      const result = service.buildUserApiKeyStatus(detection)

      expect(result.used).toBe('user')
      expect(result.status).toBe('healthy')
      expect(result.scopes.user).toBe('healthy')
      expect(result.scopes.env).toBe('missing')
    })

    it('returns healthy with env scope when env key is healthy and user missing', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: false, key: null, status: 'missing' },
        env: { found: true, key: 'sk-env', status: 'healthy' },
      }

      const result = service.buildUserApiKeyStatus(detection)

      expect(result.used).toBe('env')
      expect(result.status).toBe('healthy')
      expect(result.scopes.env).toBe('healthy')
    })

    it('prefers user over env when both healthy', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: true, key: 'sk-user', status: 'healthy' },
        env: { found: true, key: 'sk-env', status: 'healthy' },
      }

      const result = service.buildUserApiKeyStatus(detection)

      expect(result.used).toBe('user')
      expect(result.scopes.user).toBe('healthy')
      expect(result.scopes.env).toBe('healthy')
    })

    it('returns invalid when keys found but none healthy', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: true, key: 'bad-key', status: 'invalid' },
        env: { found: false, key: null, status: 'missing' },
      }

      const result = service.buildUserApiKeyStatus(detection)

      expect(result.used).toBeNull()
      expect(result.status).toBe('invalid')
      expect(result.scopes.user).toBe('invalid')
    })

    it('returns missing when no keys found at user or env scope', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: true, key: 'sk-proj', status: 'healthy' },
        user: { found: false, key: null, status: 'missing' },
        env: { found: false, key: null, status: 'missing' },
      }

      const result = service.buildUserApiKeyStatus(detection)

      // User-level doesn't see project scope
      expect(result.used).toBeNull()
      expect(result.status).toBe('missing')
    })
  })

  describe('buildProjectApiKeyStatus', () => {
    it('returns healthy with project scope when project key is healthy', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: true, key: 'sk-proj', status: 'healthy' },
        user: { found: false, key: null, status: 'missing' },
        env: { found: false, key: null, status: 'missing' },
      }

      const result = service.buildProjectApiKeyStatus(detection)

      expect(result.used).toBe('project')
      expect(result.status).toBe('healthy')
      expect(result.scopes.project).toBe('healthy')
    })

    it('falls through to user when project key invalid', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: true, key: 'bad-proj', status: 'invalid' },
        user: { found: true, key: 'sk-user', status: 'healthy' },
        env: { found: false, key: null, status: 'missing' },
      }

      const result = service.buildProjectApiKeyStatus(detection)

      expect(result.used).toBe('user')
      expect(result.status).toBe('healthy')
      expect(result.scopes.project).toBe('invalid')
      expect(result.scopes.user).toBe('healthy')
    })

    it('falls through to env when project and user keys both invalid', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: true, key: 'bad-proj', status: 'invalid' },
        user: { found: true, key: 'bad-user', status: 'invalid' },
        env: { found: true, key: 'sk-env', status: 'healthy' },
      }

      const result = service.buildProjectApiKeyStatus(detection)

      expect(result.used).toBe('env')
      expect(result.status).toBe('healthy')
    })

    it('returns invalid when all keys found but none healthy', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: true, key: 'bad1', status: 'invalid' },
        user: { found: true, key: 'bad2', status: 'invalid' },
        env: { found: true, key: 'bad3', status: 'invalid' },
      }

      const result = service.buildProjectApiKeyStatus(detection)

      expect(result.used).toBeNull()
      expect(result.status).toBe('invalid')
    })

    it('returns missing when no keys found anywhere', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: false, key: null, status: 'missing' },
        env: { found: false, key: null, status: 'missing' },
      }

      const result = service.buildProjectApiKeyStatus(detection)

      expect(result.used).toBeNull()
      expect(result.status).toBe('missing')
      expect(result.scopes).toEqual({ project: 'missing', user: 'missing', env: 'missing' })
    })

    it('respects priority order: project > user > env', () => {
      const detection: import('../setup-status-service.js').AllScopesDetectionResult = {
        project: { found: true, key: 'sk-proj', status: 'healthy' },
        user: { found: true, key: 'sk-user', status: 'healthy' },
        env: { found: true, key: 'sk-env', status: 'healthy' },
      }

      const result = service.buildProjectApiKeyStatus(detection)

      expect(result.used).toBe('project')
    })
  })

  describe('detectAllApiKeys', () => {
    it('detects key in project .env', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-proj-key\n')

      const result = await service.detectAllApiKeys('OPENROUTER_API_KEY', true)

      expect(result.project.found).toBe(true)
      expect(result.project.key).toBe('sk-proj-key')
      expect(result.project.status).toBe('healthy') // skipValidation
      expect(result.user.found).toBe(false)
      expect(result.env.found).toBe(false)
    })

    it('detects key in user .env', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-user-key\n')

      const result = await service.detectAllApiKeys('OPENROUTER_API_KEY', true)

      expect(result.user.found).toBe(true)
      expect(result.user.key).toBe('sk-user-key')
      expect(result.user.status).toBe('healthy')
      expect(result.project.found).toBe(false)
    })

    it('detects keys at multiple scopes independently', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-proj\n')
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-user\n')

      const result = await service.detectAllApiKeys('OPENROUTER_API_KEY', true)

      expect(result.project.found).toBe(true)
      expect(result.project.key).toBe('sk-proj')
      expect(result.user.found).toBe(true)
      expect(result.user.key).toBe('sk-user')
    })

    it('returns all missing when no keys found', async () => {
      const result = await service.detectAllApiKeys('OPENROUTER_API_KEY', true)

      expect(result.project.found).toBe(false)
      expect(result.user.found).toBe(false)
      expect(result.env.found).toBe(false)
      expect(result.project.status).toBe('missing')
      expect(result.user.status).toBe('missing')
      expect(result.env.status).toBe('missing')
    })

    it('strips quotes from .env values', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY="sk-quoted-key"\n')

      const result = await service.detectAllApiKeys('OPENROUTER_API_KEY', true)

      expect(result.user.key).toBe('sk-quoted-key')
    })
  })

  describe('static helper methods', () => {
    it('userApiKeyStatusFromHealth converts not-required', () => {
      const result = SetupStatusService.userApiKeyStatusFromHealth('not-required')

      expect(result.used).toBeNull()
      expect(result.status).toBe('not-required')
      expect(result.scopes.user).toBe('missing')
      expect(result.scopes.env).toBe('missing')
    })

    it('userApiKeyStatusFromHealth converts missing', () => {
      const result = SetupStatusService.userApiKeyStatusFromHealth('missing')

      expect(result.used).toBeNull()
      expect(result.status).toBe('missing')
    })

    it('projectApiKeyStatusFromHealth converts not-required', () => {
      const result = SetupStatusService.projectApiKeyStatusFromHealth('not-required')

      expect(result.used).toBeNull()
      expect(result.status).toBe('not-required')
      expect(result.scopes).toEqual({ project: 'missing', user: 'missing', env: 'missing' })
    })

    it('projectApiKeyStatusFromHealth converts healthy', () => {
      const result = SetupStatusService.projectApiKeyStatusFromHealth('healthy')

      expect(result.used).toBeNull()
      expect(result.status).toBe('healthy')
    })
  })

  describe('detectPluginInstallation', () => {
    const mockSpawn = vi.mocked(childProcess.spawn)

    // Helper to mock claude plugin list --json output
    const mockPluginList = (plugins: Array<{ id: string; scope: string; enabled: boolean }>): void => {
      mockSpawn.mockImplementation((cmd, args) => {
        // Only mock 'claude plugin list --json' calls
        if (cmd === 'claude' && args?.includes('plugin') && args?.includes('list') && args?.includes('--json')) {
          const proc = createMockChildProcess()
          setImmediate(() => {
            proc.stdout.emit('data', Buffer.from(JSON.stringify(plugins)))
            proc.emit('close', 0, null)
          })
          return proc as unknown as childProcess.ChildProcess
        }
        // For other spawn calls, return a process that closes immediately
        const proc = createMockChildProcess()
        setImmediate(() => proc.emit('close', 0, null))
        return proc as unknown as childProcess.ChildProcess
      })
    }

    beforeEach(() => {
      vi.resetAllMocks()
    })

    it('returns "none" when no sidekick plugin and no dev-mode hooks', async () => {
      mockPluginList([
        { id: 'beads@beads-marketplace', scope: 'user', enabled: true },
        { id: 'superpowers@claude-plugins-official', scope: 'user', enabled: true },
      ])

      const result = await service.detectPluginInstallation()
      expect(result).toBe('none')
    })

    it('returns "plugin" when sidekick plugin is in claude plugin list', async () => {
      mockPluginList([
        { id: 'sidekick@some-marketplace', scope: 'user', enabled: true },
        { id: 'beads@beads-marketplace', scope: 'user', enabled: true },
      ])

      const result = await service.detectPluginInstallation()
      expect(result).toBe('plugin')
    })

    it('returns "plugin" when sidekick plugin is at project scope', async () => {
      mockPluginList([{ id: 'sidekick@local', scope: 'project', enabled: true }])

      const result = await service.detectPluginInstallation()
      expect(result).toBe('plugin')
    })

    it('returns "dev-mode" when hooks contain dev-sidekick path', async () => {
      mockPluginList([]) // No plugins installed

      await writeClaudeSettings('project', {
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/session-start' }] },
          ],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('dev-mode')
    })

    it('returns "both" when sidekick plugin AND dev-mode hooks are present', async () => {
      mockPluginList([{ id: 'sidekick@some-marketplace', scope: 'user', enabled: true }])

      await writeClaudeSettings('project', {
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/session-start' }] },
          ],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('both')
    })

    it('detects dev-mode from statusLine command', async () => {
      mockPluginList([])

      await writeClaudeSettings('project', {
        statusLine: {
          type: 'command',
          command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/statusline',
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('dev-mode')
    })

    it('returns "none" when hooks exist but are not sidekick-related', async () => {
      mockPluginList([])

      await writeClaudeSettings('user', {
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'some-other-tool hook start' }] }],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('none')
    })

    it('handles malformed settings gracefully', async () => {
      mockPluginList([])

      const settingsPath = path.join(homeDir, '.claude', 'settings.json')
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.writeFile(settingsPath, '{invalid json}')

      // Should not throw, just return 'none'
      const result = await service.detectPluginInstallation()
      expect(result).toBe('none')
    })

    it('handles claude CLI error gracefully', async () => {
      mockSpawn.mockImplementation((cmd, args) => {
        if (cmd === 'claude' && args?.includes('plugin')) {
          const proc = createMockChildProcess()
          setImmediate(() => {
            proc.stderr.emit('data', Buffer.from('claude: command not found'))
            proc.emit('close', 1, null)
          })
          return proc as unknown as childProcess.ChildProcess
        }
        const proc = createMockChildProcess()
        setImmediate(() => proc.emit('close', 0, null))
        return proc as unknown as childProcess.ChildProcess
      })

      // Should not throw, return 'error' to distinguish from genuine 'none'
      const result = await service.detectPluginInstallation()
      expect(result).toBe('error')
    })

    it('handles invalid JSON from claude CLI gracefully', async () => {
      mockSpawn.mockImplementation((cmd, args) => {
        if (cmd === 'claude' && args?.includes('plugin')) {
          const proc = createMockChildProcess()
          setImmediate(() => {
            proc.stdout.emit('data', Buffer.from('not valid json'))
            proc.emit('close', 0, null)
          })
          return proc as unknown as childProcess.ChildProcess
        }
        const proc = createMockChildProcess()
        setImmediate(() => proc.emit('close', 0, null))
        return proc as unknown as childProcess.ChildProcess
      })

      // Should not throw, return 'error' for invalid JSON
      const result = await service.detectPluginInstallation()
      expect(result).toBe('error')
    })
  })

  describe('detectPluginLiveness', () => {
    const mockSpawn = vi.mocked(childProcess.spawn)

    beforeEach(() => {
      vi.resetAllMocks()
    })

    it('returns "active" when Claude responds with the safe word', async () => {
      mockSpawn.mockImplementation((_cmd, _args, options) => {
        const proc = createMockChildProcess()
        const safeWord = (options?.env as Record<string, string>)?.SIDEKICK_LIVENESS_CHECK ?? 'nope'

        // Simulate async response
        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from(`The magic word is: ${safeWord}`))
          proc.emit('close', 0, null)
        })

        return proc as unknown as childProcess.ChildProcess
      })

      const result = await service.detectPluginLiveness()
      expect(result).toBe('active')
    })

    it('returns "inactive" when Claude does not respond with safe word', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()

        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from('I do not understand the question.'))
          proc.emit('close', 0, null)
        })

        return proc as unknown as childProcess.ChildProcess
      })

      const result = await service.detectPluginLiveness()
      expect(result).toBe('inactive')
    })

    it('returns "error" when Claude command fails with non-zero exit', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()

        setImmediate(() => {
          proc.stderr.emit('data', Buffer.from('Command failed'))
          proc.emit('close', 1, null)
        })

        return proc as unknown as childProcess.ChildProcess
      })

      const result = await service.detectPluginLiveness()
      expect(result).toBe('error')
    })

    it('returns "error" when spawn fails', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()

        setImmediate(() => {
          proc.emit('error', new Error('Command not found: claude'))
        })

        return proc as unknown as childProcess.ChildProcess
      })

      const result = await service.detectPluginLiveness()
      expect(result).toBe('error')
    })

    it('uses a random safe word for each check', async () => {
      const capturedSafeWords: string[] = []

      mockSpawn.mockImplementation((_cmd, _args, options) => {
        const proc = createMockChildProcess()
        const safeWord = (options?.env as Record<string, string>)?.SIDEKICK_LIVENESS_CHECK

        if (safeWord) {
          capturedSafeWords.push(safeWord)
        }

        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from(`Response: ${safeWord}`))
          proc.emit('close', 0, null)
        })

        return proc as unknown as childProcess.ChildProcess
      })

      await service.detectPluginLiveness()
      await service.detectPluginLiveness()

      expect(capturedSafeWords).toHaveLength(2)
      expect(capturedSafeWords[0]).not.toBe(capturedSafeWords[1])
    })

    it('returns "timeout" and kills process on timeout', async () => {
      vi.useFakeTimers()

      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()
        // When kill is called, emit close with SIGTERM signal
        proc.kill.mockImplementation((signal: string) => {
          setImmediate(() => proc.emit('close', null, signal))
          return true
        })
        return proc as unknown as childProcess.ChildProcess
      })

      const resultPromise = service.detectPluginLiveness()

      // Fast-forward past 30s timeout
      await vi.advanceTimersByTimeAsync(31000)

      const result = await resultPromise
      expect(result).toBe('timeout')

      vi.useRealTimers()
    })

    it('calls kill with SIGTERM on timeout', async () => {
      vi.useFakeTimers()

      let capturedProc: ReturnType<typeof createMockChildProcess> | null = null

      mockSpawn.mockImplementation(() => {
        capturedProc = createMockChildProcess()
        capturedProc.kill.mockImplementation((signal: string) => {
          setImmediate(() => capturedProc!.emit('close', null, signal))
          return true
        })
        return capturedProc as unknown as childProcess.ChildProcess
      })

      const resultPromise = service.detectPluginLiveness()

      // Fast-forward past timeout
      await vi.advanceTimersByTimeAsync(31000)

      await resultPromise
      expect(capturedProc!.kill).toHaveBeenCalledWith('SIGTERM')

      vi.useRealTimers()
    })
  })

  describe('doctor missing user setup edge cases', () => {
    it('getUserStatus returns null with a warning when user config file contains invalid JSON', async () => {
      // Create a service with a logger so we can assert the warning
      const mockLogger = {
        trace: vi.fn() as any,
        debug: vi.fn() as any,
        info: vi.fn() as any,
        warn: vi.fn() as any,
        error: vi.fn() as any,
        fatal: vi.fn() as any,
        child: vi.fn() as any,
        level: 'debug' as const,
        silent: false,
      }
      const serviceWithLogger = new SetupStatusService(projectDir, { homeDir, logger: mockLogger as any })

      const userStatusPath = path.join(homeDir, '.sidekick', USER_STATUS_FILENAME)
      await fs.mkdir(path.dirname(userStatusPath), { recursive: true })
      await fs.writeFile(userStatusPath, '{ this is not valid JSON !!!')

      const result = await serviceWithLogger.getUserStatus()

      expect(result).toBeNull()
      expect(mockLogger.warn).toHaveBeenCalledWith(
        `Corrupt ${USER_STATUS_FILENAME}, treating as missing`,
        expect.objectContaining({
          path: userStatusPath,
          error: expect.any(String),
        })
      )
    })

    it('doctor reports unhealthy when both user AND project files are missing', async () => {
      // No user status file, no project status file — completely fresh system
      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.userSetupExists).toBe(false)
      expect(result.overallHealth).toBe('unhealthy')
      // Statusline should also report as not configured
      expect(result.statusline.actual).toBe('none')
      // API keys should be missing across all scopes
      expect(result.apiKeys.OPENROUTER_API_KEY.actual).toBe('missing')
      expect(result.apiKeys.OPENROUTER_API_KEY.used).toBeNull()
    })

    it('doctor reports multiple failure signals together when user missing and API key unhealthy', async () => {
      // Project status exists with an invalid API key, but user file is missing.
      // Doctor should report BOTH: userSetupExists=false AND apiKey unhealthy,
      // not bail out after finding the first failure.
      await writeProjectStatus(
        createProjectStatus({
          statusline: 'project',
          apiKeys: {
            OPENROUTER_API_KEY: 'invalid',
            OPENAI_API_KEY: 'not-required',
          },
        })
      )
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })

      const result = await service.runDoctorCheck({ skipValidation: true })

      // Both failures should be visible — user missing AND api key unhealthy
      expect(result.userSetupExists).toBe(false)
      expect(result.overallHealth).toBe('unhealthy')
      // Statusline IS configured (at project level), so that's not the problem
      expect(result.statusline.actual).toBe('project')
      // API key is missing (no .env files) — the project cache saying 'invalid' is stale
      expect(result.apiKeys.OPENROUTER_API_KEY.actual).toBe('missing')
      expect(result.apiKeys.OPENROUTER_API_KEY.used).toBeNull()
    })
  })

  describe('edge cases', () => {
    it('handles sequential writes to user status', async () => {
      const status1 = createUserStatus({ statusline: 'user' })
      const status2 = createUserStatus({ statusline: 'none' })

      await service.writeUserStatus(status1)
      await service.writeUserStatus(status2)

      const result = await service.getUserStatus()
      expect(result).toBeTruthy()
      expect(result!.statusline).toBe('none')
    })

    it('handles sequential writes to project status', async () => {
      const status1 = createProjectStatus({ statusline: 'user' })
      const status2 = createProjectStatus({ statusline: 'none' })

      await service.writeProjectStatus(status1)
      await service.writeProjectStatus(status2)

      const result = await service.getProjectStatus()
      expect(result).toBeTruthy()
      expect(result!.statusline).toBe('none')
    })

    it('handles files with required fields only', async () => {
      const minimalStatus = createUserStatus({
        apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
      })
      await service.writeUserStatus(minimalStatus)

      const statuslineHealth = await service.getStatuslineHealth()
      const apiKeyHealth = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      const isHealthy = await service.isHealthy()

      expect(statuslineHealth).toBe('user')
      expect(apiKeyHealth).toBe('missing')
      expect(isHealthy).toBe(false)
    })
  })

  describe('pluginDetected field', () => {
    it('reads pluginDetected from user status file', async () => {
      const status = createUserStatus()
      ;(status as any).pluginDetected = true
      await writeUserStatus(status)

      const result = await service.getUserStatus()
      expect(result?.pluginDetected).toBe(true)
    })

    it('reads pluginDetected from project status file', async () => {
      const status = createProjectStatus()
      ;(status as any).pluginDetected = true
      await writeProjectStatus(status)

      const result = await service.getProjectStatus()
      expect(result?.pluginDetected).toBe(true)
    })

    it('defaults pluginDetected to undefined when not set', async () => {
      const status = createUserStatus()
      await writeUserStatus(status)

      const result = await service.getUserStatus()
      expect(result?.pluginDetected).toBeUndefined()
    })
  })

  describe('devMode field', () => {
    it('reads devMode from project status file', async () => {
      const status = createProjectStatus()
      ;(status as any).devMode = true
      await writeProjectStatus(status)

      const result = await service.getProjectStatus()
      expect(result?.devMode).toBe(true)
    })

    it('defaults devMode to undefined when not set', async () => {
      const status = createProjectStatus()
      await writeProjectStatus(status)

      const result = await service.getProjectStatus()
      expect(result?.devMode).toBeUndefined()
    })

    it('getDevMode returns false when no project status exists', async () => {
      const result = await service.getDevMode()
      expect(result).toBe(false)
    })

    it('getDevMode returns false when devMode not set', async () => {
      await writeProjectStatus(createProjectStatus())

      const result = await service.getDevMode()
      expect(result).toBe(false)
    })

    it('getDevMode returns true when devMode is true', async () => {
      const status = createProjectStatus()
      ;(status as any).devMode = true
      await writeProjectStatus(status)

      const result = await service.getDevMode()
      expect(result).toBe(true)
    })

    it('setDevMode updates devMode in project status', async () => {
      await writeProjectStatus(createProjectStatus())

      await service.setDevMode(true)

      const result = await service.getProjectStatus()
      expect(result?.devMode).toBe(true)
    })

    it('setDevMode creates project status if missing', async () => {
      // No project status exists initially

      await service.setDevMode(true)

      const result = await service.getProjectStatus()
      expect(result?.devMode).toBe(true)
    })

    it('setDevMode detects configured statusline when creating project status', async () => {
      // Configure statusline in project settings (like dev-mode enable does)
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'pnpm sidekick statusline' },
      })

      await service.setDevMode(true)

      const result = await service.getProjectStatus()
      // Statusline is configured in PROJECT settings, so should report 'project'
      expect(result?.statusline).toBe('project')
    })

    it('setDevMode detects project-level API keys when creating project status', async () => {
      // Write API key to project .env
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-or-test-key-123')

      await service.setDevMode(true)

      const result = await service.getProjectStatus()
      // Now writes new object format with per-scope breakdown (skipValidation=true → healthy)
      const apiKeyStatus = result?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.used).toBe('project')
        expect(apiKeyStatus.status).toBe('healthy')
        expect(apiKeyStatus.scopes.project).toBe('healthy')
      }
    })

    it('setDevMode uses user delegation when no project API key exists', async () => {
      // No project .env file, but user-level exists
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-or-user-key-456')

      await service.setDevMode(true)

      const result = await service.getProjectStatus()
      // Should detect key at user scope (skipValidation=true → healthy)
      const apiKeyStatus = result?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.used).toBe('user')
        expect(apiKeyStatus.status).toBe('healthy')
        expect(apiKeyStatus.scopes.user).toBe('healthy')
        expect(apiKeyStatus.scopes.project).toBe('missing')
      }
    })

    it('setDevMode marks API keys missing when not found anywhere', async () => {
      // No .env files anywhere

      await service.setDevMode(true)

      const result = await service.getProjectStatus()
      const apiKeyStatus = result?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.used).toBeNull()
        expect(apiKeyStatus.status).toBe('missing')
      }
    })

    it('setDevMode detects both statusline and API keys together', async () => {
      // Configure both statusline and project API key
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'npx @scotthamilton77/sidekick statusline' },
      })
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-or-project-key\nOPENAI_API_KEY=sk-openai-key')

      await service.setDevMode(true)

      const result = await service.getProjectStatus()
      // Statusline is configured in PROJECT settings, so should report 'project'
      expect(result?.statusline).toBe('project')
      // Both keys detected at project scope (skipValidation=true → healthy)
      const orStatus = result?.apiKeys.OPENROUTER_API_KEY
      const oaiStatus = result?.apiKeys.OPENAI_API_KEY
      expect(typeof orStatus).toBe('object')
      expect(typeof oaiStatus).toBe('object')
      if (typeof orStatus === 'object') {
        expect(orStatus.used).toBe('project')
        expect(orStatus.status).toBe('healthy')
      }
      if (typeof oaiStatus === 'object') {
        expect(oaiStatus.used).toBe('project')
        expect(oaiStatus.status).toBe('healthy')
      }
    })
  })

  describe('isPluginInstalled helper', () => {
    it('returns false when no status files exist', async () => {
      const result = await service.isPluginInstalled()
      expect(result).toBe(false)
    })

    it('returns true when userPluginDetected is true', async () => {
      const status = createUserStatus()
      ;(status as any).pluginDetected = true
      await writeUserStatus(status)

      const result = await service.isPluginInstalled()
      expect(result).toBe(true)
    })

    it('returns true when projectPluginDetected is true', async () => {
      const status = createProjectStatus()
      ;(status as any).pluginDetected = true
      await writeProjectStatus(status)

      const result = await service.isPluginInstalled()
      expect(result).toBe(true)
    })

    it('returns true when both are true', async () => {
      const userStatus = createUserStatus()
      ;(userStatus as any).pluginDetected = true
      await writeUserStatus(userStatus)

      const projectStatus = createProjectStatus()
      ;(projectStatus as any).pluginDetected = true
      await writeProjectStatus(projectStatus)

      const result = await service.isPluginInstalled()
      expect(result).toBe(true)
    })

    it('returns false when both are false', async () => {
      const userStatus = createUserStatus()
      ;(userStatus as any).pluginDetected = false
      await writeUserStatus(userStatus)

      const projectStatus = createProjectStatus()
      ;(projectStatus as any).pluginDetected = false
      await writeProjectStatus(projectStatus)

      const result = await service.isPluginInstalled()
      expect(result).toBe(false)
    })
  })
})
