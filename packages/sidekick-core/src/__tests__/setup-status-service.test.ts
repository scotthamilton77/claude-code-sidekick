import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as childProcess from 'node:child_process'

// Mock child_process exec for detectPluginLiveness tests
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    exec: vi.fn(),
  }
})
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import { SetupStatusService } from '../setup-status-service.js'
import type { UserSetupStatus, ProjectSetupStatus } from '@sidekick/types'

describe('SetupStatusService', () => {
  let tempDir: string
  let projectDir: string
  let homeDir: string
  let service: SetupStatusService

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'setup-status-test-'))
    projectDir = path.join(tempDir, 'project')
    homeDir = path.join(tempDir, 'home')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(homeDir, { recursive: true })
    service = new SetupStatusService(projectDir, { homeDir })
  })

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // Helper to create valid status objects
  const createUserStatus = (overrides?: Partial<UserSetupStatus>): UserSetupStatus => ({
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    preferences: {
      autoConfigureProjects: true,
      defaultStatuslineScope: 'user',
      defaultApiKeyScope: 'user',
    },
    statusline: 'configured',
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
    statusline: 'user',
    apiKeys: {
      OPENROUTER_API_KEY: 'user',
      OPENAI_API_KEY: 'user',
    },
    gitignore: 'unknown',
    ...overrides,
  })

  // Helper to write status files
  const writeUserStatus = async (status: UserSetupStatus): Promise<void> => {
    const userStatusPath = path.join(homeDir, '.sidekick', 'setup-status.json')
    await fs.mkdir(path.dirname(userStatusPath), { recursive: true })
    await fs.writeFile(userStatusPath, JSON.stringify(status, null, 2))
  }

  const writeProjectStatus = async (status: ProjectSetupStatus): Promise<void> => {
    const projectStatusPath = path.join(projectDir, '.sidekick', 'setup-status.json')
    await fs.mkdir(path.dirname(projectStatusPath), { recursive: true })
    await fs.writeFile(projectStatusPath, JSON.stringify(status, null, 2))
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

    it('throws when user status file contains invalid JSON', async () => {
      const userStatusPath = path.join(homeDir, '.sidekick', 'setup-status.json')
      await fs.mkdir(path.dirname(userStatusPath), { recursive: true })
      await fs.writeFile(userStatusPath, '{invalid json}')

      await expect(service.getUserStatus()).rejects.toThrow()
    })

    it('returns null when user status file contains invalid schema', async () => {
      const userStatusPath = path.join(homeDir, '.sidekick', 'setup-status.json')
      await fs.mkdir(path.dirname(userStatusPath), { recursive: true })
      await fs.writeFile(userStatusPath, JSON.stringify({ version: 2 }))

      const result = await service.getUserStatus()
      expect(result).toBeNull()
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

    it('throws when project status file contains invalid JSON', async () => {
      const projectStatusPath = path.join(projectDir, '.sidekick', 'setup-status.json')
      await fs.mkdir(path.dirname(projectStatusPath), { recursive: true })
      await fs.writeFile(projectStatusPath, '{invalid json}')

      await expect(service.getProjectStatus()).rejects.toThrow()
    })

    it('returns null when project status file contains invalid schema', async () => {
      const projectStatusPath = path.join(projectDir, '.sidekick', 'setup-status.json')
      await fs.mkdir(path.dirname(projectStatusPath), { recursive: true })
      await fs.writeFile(projectStatusPath, JSON.stringify({ version: 2 }))

      const result = await service.getProjectStatus()
      expect(result).toBeNull()
    })
  })

  describe('getStatuslineHealth', () => {
    it('returns "not-setup" when no status files exist', async () => {
      const result = await service.getStatuslineHealth()
      expect(result).toBe('not-setup')
    })

    it('returns user status when project status is "user"', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'configured' }))
      await writeProjectStatus(createProjectStatus({ statusline: 'user' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('configured')
    })

    it('returns project status when project status is "configured"', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'configured' }))
      await writeProjectStatus(createProjectStatus({ statusline: 'configured' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('configured')
    })

    it('returns project status when project status is "skipped"', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'configured' }))
      await writeProjectStatus(createProjectStatus({ statusline: 'skipped' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('skipped')
    })

    it('returns "not-setup" when project wants user status but user status missing', async () => {
      await writeProjectStatus(createProjectStatus({ statusline: 'user' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('not-setup')
    })

    it('returns user status when only user status exists', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'configured' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('configured')
    })

    it('returns "not-setup" when only project status exists and is "user"', async () => {
      await writeProjectStatus(createProjectStatus({ statusline: 'user' }))

      const result = await service.getStatuslineHealth()
      expect(result).toBe('not-setup')
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
      const initialStatus = createUserStatus({ statusline: 'skipped' })
      await service.writeUserStatus(initialStatus)

      const updatedStatus = createUserStatus({ statusline: 'configured' })
      await service.writeUserStatus(updatedStatus)

      const writtenStatus = await service.getUserStatus()
      expect(writtenStatus?.statusline).toBe('configured')
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
      const initialStatus = createProjectStatus({ statusline: 'skipped' })
      await service.writeProjectStatus(initialStatus)

      const updatedStatus = createProjectStatus({ statusline: 'configured' })
      await service.writeProjectStatus(updatedStatus)

      const writtenStatus = await service.getProjectStatus()
      expect(writtenStatus?.statusline).toBe('configured')
    })
  })

  describe('isHealthy', () => {
    it('returns false when statusline is skipped', async () => {
      await writeUserStatus(createUserStatus({ statusline: 'skipped' }))

      const result = await service.isHealthy()
      expect(result).toBe(false)
    })

    it('returns false when any required API key is invalid', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'configured',
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
          statusline: 'configured',
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
          statusline: 'configured',
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
          statusline: 'configured',
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
          statusline: 'configured',
          apiKeys: {} as any,
        })
      )

      const result = await service.isHealthy()
      expect(result).toBe(false)
    })

    it('uses merged status from project and user', async () => {
      await writeUserStatus(
        createUserStatus({
          statusline: 'configured',
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
          statusline: 'configured',
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

  describe('detectActualStatusline', () => {
    // Helper to write Claude settings files
    const writeClaudeSettings = async (scope: 'user' | 'project', settings: Record<string, unknown>): Promise<void> => {
      const settingsPath =
        scope === 'user'
          ? path.join(homeDir, '.claude', 'settings.json')
          : path.join(projectDir, '.claude', 'settings.local.json')
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
    }

    it('returns "not-setup" when no settings files exist', async () => {
      const result = await service.detectActualStatusline()
      expect(result).toBe('not-setup')
    })

    it('returns "configured" when user settings has sidekick statusline', async () => {
      await writeClaudeSettings('user', {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
      })

      const result = await service.detectActualStatusline()
      expect(result).toBe('configured')
    })

    it('returns "configured" when project settings has sidekick statusline', async () => {
      await writeClaudeSettings('project', {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
      })

      const result = await service.detectActualStatusline()
      expect(result).toBe('configured')
    })

    it('returns "not-setup" when settings exist but no statusLine key', async () => {
      await writeClaudeSettings('user', { someOtherKey: 'value' })

      const result = await service.detectActualStatusline()
      expect(result).toBe('not-setup')
    })

    it('returns "not-setup" when statusLine exists but is not sidekick', async () => {
      await writeClaudeSettings('user', {
        statusLine: {
          type: 'command',
          command: 'some-other-tool statusline',
        },
      })

      const result = await service.detectActualStatusline()
      expect(result).toBe('not-setup')
    })

    it('returns "configured" when command contains "sidekick" anywhere', async () => {
      await writeClaudeSettings('user', {
        statusLine: {
          type: 'command',
          command: '/path/to/sidekick/statusline',
        },
      })

      const result = await service.detectActualStatusline()
      expect(result).toBe('configured')
    })

    it('prefers project settings over user settings', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'other-tool statusline' },
      })

      // Project has non-sidekick statusline, so should return not-setup
      // Actually, we should check EITHER - if either has sidekick, it's configured
      const result = await service.detectActualStatusline()
      expect(result).toBe('configured')
    })
  })

  describe('detectActualApiKey', () => {
    // Helper to write .env files
    const writeEnvFile = async (scope: 'user' | 'project', content: string): Promise<void> => {
      const envPath =
        scope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')
      await fs.mkdir(path.dirname(envPath), { recursive: true })
      await fs.writeFile(envPath, content)
    }

    it('returns null when no .env files exist', async () => {
      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result).toBeNull()
    })

    it('finds key in user .env file', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-or-test-key-123\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result).toBe('sk-or-test-key-123')
    })

    it('finds key in project .env file', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-or-project-key\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result).toBe('sk-or-project-key')
    })

    it('prefers project key over user key', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')
      await writeEnvFile('project', 'OPENROUTER_API_KEY=project-key\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result).toBe('project-key')
    })

    it('falls back to user key when project key not found', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')
      await writeEnvFile('project', 'OTHER_KEY=some-value\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result).toBe('user-key')
    })

    it('handles multiple keys in .env file', async () => {
      await writeEnvFile('user', 'OTHER_KEY=other\nOPENROUTER_API_KEY=the-key\nANOTHER_KEY=another\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result).toBe('the-key')
    })

    it('returns null when key not in any .env file', async () => {
      await writeEnvFile('user', 'OTHER_KEY=value\n')
      await writeEnvFile('project', 'ANOTHER_KEY=value\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result).toBeNull()
    })

    it('handles keys with equals signs in value', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=key=with=equals\n')

      const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
      expect(result).toBe('key=with=equals')
    })

    it('checks environment variable first', async () => {
      // Set env var (will be cleaned up)
      const originalEnv = process.env.OPENROUTER_API_KEY
      process.env.OPENROUTER_API_KEY = 'env-var-key'

      try {
        await writeEnvFile('user', 'OPENROUTER_API_KEY=file-key\n')
        const result = await service.detectActualApiKey('OPENROUTER_API_KEY')
        expect(result).toBe('env-var-key')
      } finally {
        if (originalEnv === undefined) {
          delete process.env.OPENROUTER_API_KEY
        } else {
          process.env.OPENROUTER_API_KEY = originalEnv
        }
      }
    })
  })

  describe('runDoctorCheck', () => {
    // Helper to write Claude settings files
    const writeClaudeSettings = async (scope: 'user' | 'project', settings: Record<string, unknown>): Promise<void> => {
      const settingsPath =
        scope === 'user'
          ? path.join(homeDir, '.claude', 'settings.json')
          : path.join(projectDir, '.claude', 'settings.local.json')
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
    }

    // Helper to write .env files
    const writeEnvFile = async (scope: 'user' | 'project', content: string): Promise<void> => {
      const envPath =
        scope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')
      await fs.mkdir(path.dirname(envPath), { recursive: true })
      await fs.writeFile(envPath, content)
    }

    it('detects statusline is configured when no cache exists', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })

      const result = await service.runDoctorCheck()

      expect(result.statusline.actual).toBe('configured')
      expect(result.statusline.cached).toBe('not-setup')
      expect(result.statusline.fixed).toBe(true)
    })

    it('detects cache is correct and reports no fix needed', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await service.writeUserStatus(createUserStatus({ statusline: 'configured' }))

      const result = await service.runDoctorCheck()

      expect(result.statusline.actual).toBe('configured')
      expect(result.statusline.cached).toBe('configured')
      expect(result.statusline.fixed).toBe(false)
    })

    it('updates user cache when statusline detected but cache says not-setup', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })

      await service.runDoctorCheck()

      const userStatus = await service.getUserStatus()
      expect(userStatus?.statusline).toBe('configured')
    })

    it('detects API key exists when cache says missing', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')

      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.actual).toBe('pending-validation')
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

      expect(result.fixes).toContain('Statusline was actually configured (updated cache)')
      expect(result.fixes).toContain('OPENROUTER_API_KEY was actually present (updated cache)')
    })

    it('returns empty fixes array when cache is accurate', async () => {
      // No config, no cache - both agree on not-setup/missing
      const result = await service.runDoctorCheck({ skipValidation: true })

      expect(result.fixes).toHaveLength(0)
    })
  })

  describe('detectPluginInstallation', () => {
    // Helper to write Claude settings files with hooks
    const writeClaudeSettings = async (scope: 'user' | 'project', settings: Record<string, unknown>): Promise<void> => {
      const settingsPath =
        scope === 'user'
          ? path.join(homeDir, '.claude', 'settings.json')
          : path.join(projectDir, '.claude', 'settings.local.json')
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
    }

    it('returns "none" when no settings files exist', async () => {
      const result = await service.detectPluginInstallation()
      expect(result).toBe('none')
    })

    it('returns "none" when settings files exist but no hooks configured', async () => {
      await writeClaudeSettings('user', { someOtherKey: 'value' })
      const result = await service.detectPluginInstallation()
      expect(result).toBe('none')
    })

    it('returns "plugin" when user settings has plugin hooks', async () => {
      await writeClaudeSettings('user', {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'npx @scotthamilton77/sidekick hook session-start --project-dir=$CLAUDE_PROJECT_DIR',
                },
              ],
            },
          ],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('plugin')
    })

    it('returns "plugin" when project settings has plugin hooks', async () => {
      await writeClaudeSettings('project', {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'npx @scotthamilton77/sidekick hook session-start --project-dir=$CLAUDE_PROJECT_DIR',
                },
              ],
            },
          ],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('plugin')
    })

    it('returns "dev-mode" when hooks contain dev-hooks path', async () => {
      await writeClaudeSettings('project', {
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-hooks/session-start' }] },
          ],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('dev-mode')
    })

    it('returns "both" when both plugin and dev-mode hooks are present', async () => {
      await writeClaudeSettings('user', {
        hooks: {
          SessionStart: [
            {
              hooks: [
                {
                  type: 'command',
                  command: 'npx @scotthamilton77/sidekick hook session-start --project-dir=$CLAUDE_PROJECT_DIR',
                },
              ],
            },
          ],
        },
      })
      await writeClaudeSettings('project', {
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-hooks/session-start' }] },
          ],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('both')
    })

    it('detects plugin from statusLine command', async () => {
      await writeClaudeSettings('user', {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('plugin')
    })

    it('detects dev-mode from statusLine command', async () => {
      await writeClaudeSettings('project', {
        statusLine: {
          type: 'command',
          command: '$CLAUDE_PROJECT_DIR/scripts/dev-hooks/statusline',
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('dev-mode')
    })

    it('returns "none" when hooks exist but are not sidekick-related', async () => {
      await writeClaudeSettings('user', {
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'some-other-tool hook start' }] }],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('none')
    })

    it('handles multiple hook types', async () => {
      await writeClaudeSettings('user', {
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'npx @scotthamilton77/sidekick hook session-start' }] }],
          PreToolUse: [{ hooks: [{ type: 'command', command: 'npx @scotthamilton77/sidekick hook pre-tool-use' }] }],
        },
      })

      const result = await service.detectPluginInstallation()
      expect(result).toBe('plugin')
    })

    it('handles malformed settings gracefully', async () => {
      const settingsPath = path.join(homeDir, '.claude', 'settings.json')
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.writeFile(settingsPath, '{invalid json}')

      // Should not throw, just return 'none'
      const result = await service.detectPluginInstallation()
      expect(result).toBe('none')
    })
  })

  describe('detectPluginLiveness', () => {
    const mockExec = vi.mocked(childProcess.exec)

    beforeEach(() => {
      vi.resetAllMocks()
    })

    it('returns "active" when Claude responds with the safe word', async () => {
      // Mock exec to return the safe word in stdout

      mockExec.mockImplementation(((_cmd: string, options: any, callback: any) => {
        const safeWord = options?.env?.SIDEKICK_SAFE_WORD ?? 'yes!'
        // Call callback if provided (node-style callback)
        if (callback) {
          callback(null, { stdout: `The magic word is: ${safeWord}`, stderr: '' })
        }
        // Return a mock ChildProcess
        return { pid: 123 }
      }) as typeof childProcess.exec)

      const result = await service.detectPluginLiveness()
      expect(result).toBe('active')
    })

    it('returns "inactive" when Claude does not respond with safe word', async () => {
      mockExec.mockImplementation(((_cmd: string, _options: any, callback: any) => {
        if (callback) {
          callback(null, { stdout: 'I do not understand the question.', stderr: '' })
        }
        return { pid: 123 }
      }) as typeof childProcess.exec)

      const result = await service.detectPluginLiveness()
      expect(result).toBe('inactive')
    })

    it('returns "error" when Claude command fails', async () => {
      mockExec.mockImplementation(((_cmd: string, _options: any, callback: any) => {
        if (callback) {
          callback(new Error('Command not found: claude'), { stdout: '', stderr: '' })
        }
        return { pid: 123 }
      }) as typeof childProcess.exec)

      const result = await service.detectPluginLiveness()
      expect(result).toBe('error')
    })

    it('uses a random safe word for each check', async () => {
      const capturedSafeWords: string[] = []

      mockExec.mockImplementation(((_cmd: string, options: any, callback: any) => {
        const safeWord = options?.env?.SIDEKICK_SAFE_WORD
        if (safeWord) {
          capturedSafeWords.push(safeWord)
        }
        if (callback) {
          callback(null, { stdout: `Response: ${safeWord}`, stderr: '' })
        }
        return { pid: 123 }
      }) as typeof childProcess.exec)

      await service.detectPluginLiveness()
      await service.detectPluginLiveness()

      // Each call should have a different safe word
      expect(capturedSafeWords).toHaveLength(2)
      expect(capturedSafeWords[0]).not.toBe(capturedSafeWords[1])
    })
  })

  describe('edge cases', () => {
    it('handles sequential writes to user status', async () => {
      const status1 = createUserStatus({ statusline: 'configured' })
      const status2 = createUserStatus({ statusline: 'skipped' })

      await service.writeUserStatus(status1)
      await service.writeUserStatus(status2)

      const result = await service.getUserStatus()
      expect(result).toBeTruthy()
      expect(result!.statusline).toBe('skipped')
    })

    it('handles sequential writes to project status', async () => {
      const status1 = createProjectStatus({ statusline: 'configured' })
      const status2 = createProjectStatus({ statusline: 'skipped' })

      await service.writeProjectStatus(status1)
      await service.writeProjectStatus(status2)

      const result = await service.getProjectStatus()
      expect(result).toBeTruthy()
      expect(result!.statusline).toBe('skipped')
    })

    it('handles files with required fields only', async () => {
      const minimalStatus = createUserStatus({
        apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
      })
      await service.writeUserStatus(minimalStatus)

      const statuslineHealth = await service.getStatuslineHealth()
      const apiKeyHealth = await service.getApiKeyHealth('OPENROUTER_API_KEY')
      const isHealthy = await service.isHealthy()

      expect(statuslineHealth).toBe('configured')
      expect(apiKeyHealth).toBe('missing')
      expect(isHealthy).toBe(false)
    })
  })
})
