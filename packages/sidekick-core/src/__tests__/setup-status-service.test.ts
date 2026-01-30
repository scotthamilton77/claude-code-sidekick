import { describe, it, expect, beforeEach, afterEach } from 'vitest'
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
