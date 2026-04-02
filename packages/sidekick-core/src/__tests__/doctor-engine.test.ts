import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import type { UserSetupStatus, ProjectSetupStatus } from '@sidekick/types'
import { runDoctorCheck, type StatusFileIO } from '../doctor-engine.js'
import { SetupStatusService, USER_STATUS_FILENAME, PROJECT_STATUS_FILENAME } from '../setup-status-service.js'

describe('doctor-engine', () => {
  let tempDir: string
  let projectDir: string
  let homeDir: string
  let savedOpenRouterKey: string | undefined
  let savedOpenAIKey: string | undefined

  beforeEach(async () => {
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY
    savedOpenAIKey = process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENAI_API_KEY

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'doctor-engine-test-'))
    projectDir = path.join(tempDir, 'project')
    homeDir = path.join(tempDir, 'home')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(homeDir, { recursive: true })
  })

  afterEach(async () => {
    if (savedOpenRouterKey !== undefined) process.env.OPENROUTER_API_KEY = savedOpenRouterKey
    else delete process.env.OPENROUTER_API_KEY
    if (savedOpenAIKey !== undefined) process.env.OPENAI_API_KEY = savedOpenAIKey
    else delete process.env.OPENAI_API_KEY
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  // Helpers to write raw files — the StatusFileIO implementation reads/writes these
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

  const createUserStatus = (overrides?: Partial<UserSetupStatus>): UserSetupStatus => ({
    version: 1,
    lastUpdatedAt: new Date().toISOString(),
    preferences: {
      autoConfigureProjects: true,
      defaultStatuslineScope: 'user',
      defaultApiKeyScope: 'user',
    },
    statusline: 'user',
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

  /**
   * File-backed StatusFileIO implementation for testing.
   * Uses SetupStatusService (the real facade) so we don't duplicate Zod parsing.
   */
  function createFileIO(): StatusFileIO {
    const svc = new SetupStatusService(projectDir, { homeDir })
    return {
      getUserStatus: () => svc.getUserStatus(),
      getProjectStatus: () => svc.getProjectStatus(),
      writeUserStatus: (status) => svc.writeUserStatus(status),
      writeProjectStatus: (status) => svc.writeProjectStatus(status),
      updateUserStatus: (updates) => svc.updateUserStatus(updates),
      updateProjectStatus: (updates) => svc.updateProjectStatus(updates),
      getEffectiveApiKeyHealth: (key) => svc.getEffectiveApiKeyHealth(key),
      getStatuslineStatus: () => svc.getStatuslineStatus(),
    }
  }

  // Helper to write status files directly
  const writeUserStatus = async (status: UserSetupStatus): Promise<void> => {
    const p = path.join(homeDir, '.sidekick', USER_STATUS_FILENAME)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, JSON.stringify(status, null, 2))
  }

  const writeProjectStatus = async (status: ProjectSetupStatus): Promise<void> => {
    const p = path.join(projectDir, '.sidekick', PROJECT_STATUS_FILENAME)
    await fs.mkdir(path.dirname(p), { recursive: true })
    await fs.writeFile(p, JSON.stringify(status, null, 2))
  }

  describe('runDoctorCheck', () => {
    it('detects statusline is configured when no cache exists', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, {})
      expect(result.statusline.actual).toBe('user')
      expect(result.statusline.cached).toBe('none')
      expect(result.statusline.fixed).toBe(true)
    })

    it('detects cache is correct and reports no fix needed', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeUserStatus(createUserStatus({ statusline: 'user' }))
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, {})
      expect(result.statusline.actual).toBe('user')
      expect(result.statusline.cached).toBe('user')
      expect(result.statusline.fixed).toBe(false)
    })

    it('detects API key exists when cache says missing', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })
      expect(result.apiKeys.OPENROUTER_API_KEY.actual).toBe('healthy')
      expect(result.apiKeys.OPENROUTER_API_KEY.cached).toBe('missing')
      expect(result.apiKeys.OPENROUTER_API_KEY.fixed).toBe(true)
    })

    it('reports overall health correctly', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })
      expect(result.overallHealth).toBe('healthy')
    })

    it('reports unhealthy when statusline not configured', async () => {
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })
      expect(result.overallHealth).toBe('unhealthy')
    })

    it('returns list of fixes made', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })
      expect(result.fixes).toContain('Statusline was actually configured at user level (updated cache)')
      expect(result.fixes).toContain('OPENROUTER_API_KEY was actually present (updated cache)')
    })

    it('returns empty fixes when cache is accurate', async () => {
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })
      expect(result.fixes).toHaveLength(0)
    })

    it('updates project cache when API key found in project .env', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=project-key\n')
      await writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'not-required' } })
      )
      await writeProjectStatus(
        createProjectStatus({ apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'user' } })
      )

      const io = createFileIO()
      await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })

      const projectStatus = await io.getProjectStatus()
      const apiKeyStatus = projectStatus?.apiKeys.OPENROUTER_API_KEY
      expect(typeof apiKeyStatus).toBe('object')
      if (typeof apiKeyStatus === 'object') {
        expect(apiKeyStatus.status).toBe('healthy')
        expect(apiKeyStatus.used).toBe('project')
      }
    })

    it('fixes cache when key is missing but cache says healthy', async () => {
      await writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'healthy', OPENAI_API_KEY: 'not-required' } })
      )

      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.fixed).toBe(true)
      expect(result.fixes).toContain('OPENROUTER_API_KEY was actually missing (updated cache)')
    })

    it('does not change cache when key is missing and cache says not-required', async () => {
      await writeUserStatus(
        createUserStatus({ apiKeys: { OPENROUTER_API_KEY: 'not-required', OPENAI_API_KEY: 'not-required' } })
      )

      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })

      expect(result.apiKeys.OPENROUTER_API_KEY.fixed).toBe(false)
    })

    it('reports unhealthy when user setup-status file is missing', async () => {
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-test-key\n')
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

      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })

      expect(result.userSetupExists).toBe(false)
      expect(result.overallHealth).toBe('unhealthy')
    })

    it('reports which scope is used for project .env key', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-project-key\n')
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })
      expect(result.apiKeys.OPENROUTER_API_KEY.used).toBe('project')
    })

    it('reports null used when key is missing', async () => {
      const io = createFileIO()
      const result = await runDoctorCheck(projectDir, homeDir, io, { skipValidation: true })
      expect(result.apiKeys.OPENROUTER_API_KEY.used).toBeNull()
    })
  })
})
