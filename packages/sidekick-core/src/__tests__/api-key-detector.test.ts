import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  toScopeStatus,
  determineOverallStatus,
  readKeyFromEnvFile,
  detectActualApiKey,
  detectAllApiKeys,
  buildUserApiKeyStatus,
  buildProjectApiKeyStatus,
  userApiKeyStatusFromHealth,
  projectApiKeyStatusFromHealth,
  getDoctorTimeout,
  DOCTOR_TIMEOUTS,
  type AllScopesDetectionResult,
} from '../api-key-detector.js'

describe('api-key-detector', () => {
  let tempDir: string
  let projectDir: string
  let homeDir: string
  let savedOpenRouterKey: string | undefined
  let savedOpenAIKey: string | undefined
  let savedDisableTimeouts: string | undefined

  beforeEach(async () => {
    savedOpenRouterKey = process.env.OPENROUTER_API_KEY
    savedOpenAIKey = process.env.OPENAI_API_KEY
    savedDisableTimeouts = process.env.DISABLE_DOCTOR_TIMEOUTS
    delete process.env.OPENROUTER_API_KEY
    delete process.env.OPENAI_API_KEY
    delete process.env.DISABLE_DOCTOR_TIMEOUTS

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'api-key-detector-test-'))
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
    if (savedDisableTimeouts !== undefined) process.env.DISABLE_DOCTOR_TIMEOUTS = savedDisableTimeouts
    else delete process.env.DISABLE_DOCTOR_TIMEOUTS
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const writeEnvFile = async (scope: 'user' | 'project', content: string): Promise<void> => {
    const envPath =
      scope === 'user' ? path.join(homeDir, '.sidekick', '.env') : path.join(projectDir, '.sidekick', '.env')
    await fs.mkdir(path.dirname(envPath), { recursive: true })
    await fs.writeFile(envPath, content)
  }

  describe('toScopeStatus', () => {
    it('maps healthy to healthy', () => {
      expect(toScopeStatus('healthy')).toBe('healthy')
    })

    it('maps invalid to invalid', () => {
      expect(toScopeStatus('invalid')).toBe('invalid')
    })

    it('maps not-required to not-required', () => {
      expect(toScopeStatus('not-required')).toBe('not-required')
    })

    it('maps missing to missing', () => {
      expect(toScopeStatus('missing')).toBe('missing')
    })

    it('maps pending-validation to missing', () => {
      expect(toScopeStatus('pending-validation')).toBe('missing')
    })

    it('maps unknown strings to missing', () => {
      expect(toScopeStatus('some-random-value')).toBe('missing')
    })
  })

  describe('determineOverallStatus', () => {
    it('returns healthy when used is set', () => {
      expect(determineOverallStatus('user', false)).toBe('healthy')
    })

    it('returns invalid when keys found but none used', () => {
      expect(determineOverallStatus(null, true)).toBe('invalid')
    })

    it('returns missing when no keys found and none used', () => {
      expect(determineOverallStatus(null, false)).toBe('missing')
    })
  })

  describe('getDoctorTimeout', () => {
    it('returns default value when kill switch not set', () => {
      expect(getDoctorTimeout(10_000)).toBe(10_000)
    })

    it('returns undefined when DISABLE_DOCTOR_TIMEOUTS=1', () => {
      process.env.DISABLE_DOCTOR_TIMEOUTS = '1'
      expect(getDoctorTimeout(10_000)).toBeUndefined()
    })

    it('returns default when DISABLE_DOCTOR_TIMEOUTS is something other than 1', () => {
      process.env.DISABLE_DOCTOR_TIMEOUTS = 'true'
      expect(getDoctorTimeout(10_000)).toBe(10_000)
    })
  })

  describe('DOCTOR_TIMEOUTS', () => {
    it('has expected timeout keys', () => {
      expect(DOCTOR_TIMEOUTS.apiKeyValidation).toBe(10_000)
      expect(DOCTOR_TIMEOUTS.pluginDetection).toBe(10_000)
      expect(DOCTOR_TIMEOUTS.pluginLiveness).toBe(30_000)
    })
  })

  describe('readKeyFromEnvFile', () => {
    it('returns null when file does not exist', async () => {
      const result = await readKeyFromEnvFile('/nonexistent/.env', 'OPENROUTER_API_KEY')
      expect(result).toBeNull()
    })

    it('reads key from .env file', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-test-key\n')
      const envPath = path.join(homeDir, '.sidekick', '.env')
      const result = await readKeyFromEnvFile(envPath, 'OPENROUTER_API_KEY')
      expect(result).toBe('sk-test-key')
    })

    it('strips double quotes', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY="sk-quoted-key"\n')
      const envPath = path.join(homeDir, '.sidekick', '.env')
      const result = await readKeyFromEnvFile(envPath, 'OPENROUTER_API_KEY')
      expect(result).toBe('sk-quoted-key')
    })

    it('strips single quotes', async () => {
      await writeEnvFile('user', "OPENROUTER_API_KEY='sk-single-quoted'\n")
      const envPath = path.join(homeDir, '.sidekick', '.env')
      const result = await readKeyFromEnvFile(envPath, 'OPENROUTER_API_KEY')
      expect(result).toBe('sk-single-quoted')
    })

    it('returns null when key is not in the file', async () => {
      await writeEnvFile('user', 'SOME_OTHER_KEY=value\n')
      const envPath = path.join(homeDir, '.sidekick', '.env')
      const result = await readKeyFromEnvFile(envPath, 'OPENROUTER_API_KEY')
      expect(result).toBeNull()
    })
  })

  describe('detectActualApiKey', () => {
    it('returns null when no .env files exist', async () => {
      const result = await detectActualApiKey('OPENROUTER_API_KEY', projectDir, homeDir)
      expect(result.key).toBeNull()
      expect(result.source).toBeNull()
    })

    it('returns project-env source when key in project .env', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=project-key\n')
      const result = await detectActualApiKey('OPENROUTER_API_KEY', projectDir, homeDir)
      expect(result.key).toBe('project-key')
      expect(result.source).toBe('project-env')
    })

    it('returns user-env source when key in user .env', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')
      const result = await detectActualApiKey('OPENROUTER_API_KEY', projectDir, homeDir)
      expect(result.key).toBe('user-key')
      expect(result.source).toBe('user-env')
    })

    it('project .env takes priority over user .env', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=project-key\n')
      await writeEnvFile('user', 'OPENROUTER_API_KEY=user-key\n')
      const result = await detectActualApiKey('OPENROUTER_API_KEY', projectDir, homeDir)
      expect(result.key).toBe('project-key')
      expect(result.source).toBe('project-env')
    })

    it('falls back to environment variable', async () => {
      process.env.OPENROUTER_API_KEY = 'env-var-key'
      const result = await detectActualApiKey('OPENROUTER_API_KEY', projectDir, homeDir)
      expect(result.key).toBe('env-var-key')
      expect(result.source).toBe('env-var')
    })
  })

  describe('detectAllApiKeys', () => {
    it('detects key in project .env', async () => {
      await writeEnvFile('project', 'OPENROUTER_API_KEY=sk-proj-key\n')
      const result = await detectAllApiKeys('OPENROUTER_API_KEY', projectDir, homeDir, true)
      expect(result.project.found).toBe(true)
      expect(result.project.key).toBe('sk-proj-key')
      expect(result.project.status).toBe('healthy')
      expect(result.user.found).toBe(false)
      expect(result.env.found).toBe(false)
    })

    it('detects key in user .env', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=sk-user-key\n')
      const result = await detectAllApiKeys('OPENROUTER_API_KEY', projectDir, homeDir, true)
      expect(result.user.found).toBe(true)
      expect(result.user.key).toBe('sk-user-key')
      expect(result.user.status).toBe('healthy')
      expect(result.project.found).toBe(false)
    })

    it('returns all missing when no keys found', async () => {
      const result = await detectAllApiKeys('OPENROUTER_API_KEY', projectDir, homeDir, true)
      expect(result.project.found).toBe(false)
      expect(result.user.found).toBe(false)
      expect(result.env.found).toBe(false)
    })

    it('excludes env key that matches file-sourced key', async () => {
      // When process.env has the same value as a file key, it's from dotenv — ignore it
      await writeEnvFile('user', 'OPENROUTER_API_KEY=same-key\n')
      process.env.OPENROUTER_API_KEY = 'same-key'
      const result = await detectAllApiKeys('OPENROUTER_API_KEY', projectDir, homeDir, true)
      expect(result.user.found).toBe(true)
      expect(result.env.found).toBe(false)
    })

    it('includes env key when different from file-sourced keys', async () => {
      await writeEnvFile('user', 'OPENROUTER_API_KEY=file-key\n')
      process.env.OPENROUTER_API_KEY = 'different-env-key'
      const result = await detectAllApiKeys('OPENROUTER_API_KEY', projectDir, homeDir, true)
      expect(result.user.found).toBe(true)
      expect(result.env.found).toBe(true)
      expect(result.env.key).toBe('different-env-key')
    })
  })

  describe('buildUserApiKeyStatus', () => {
    it('returns healthy with user scope when user key is healthy', () => {
      const detection: AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: true, key: 'sk-user', status: 'healthy' },
        env: { found: false, key: null, status: 'missing' },
      }
      const result = buildUserApiKeyStatus(detection)
      expect(result.used).toBe('user')
      expect(result.status).toBe('healthy')
      expect(result.scopes.user).toBe('healthy')
      expect(result.scopes.env).toBe('missing')
    })

    it('returns healthy with env scope when env key is healthy and user missing', () => {
      const detection: AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: false, key: null, status: 'missing' },
        env: { found: true, key: 'sk-env', status: 'healthy' },
      }
      const result = buildUserApiKeyStatus(detection)
      expect(result.used).toBe('env')
      expect(result.status).toBe('healthy')
    })

    it('returns invalid when keys found but none healthy', () => {
      const detection: AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: true, key: 'bad', status: 'invalid' },
        env: { found: false, key: null, status: 'missing' },
      }
      const result = buildUserApiKeyStatus(detection)
      expect(result.used).toBeNull()
      expect(result.status).toBe('invalid')
    })

    it('returns missing when no keys found at user or env scope', () => {
      const detection: AllScopesDetectionResult = {
        project: { found: true, key: 'sk-proj', status: 'healthy' },
        user: { found: false, key: null, status: 'missing' },
        env: { found: false, key: null, status: 'missing' },
      }
      const result = buildUserApiKeyStatus(detection)
      expect(result.used).toBeNull()
      expect(result.status).toBe('missing')
    })
  })

  describe('buildProjectApiKeyStatus', () => {
    it('returns healthy with project scope when project key is healthy', () => {
      const detection: AllScopesDetectionResult = {
        project: { found: true, key: 'sk-proj', status: 'healthy' },
        user: { found: false, key: null, status: 'missing' },
        env: { found: false, key: null, status: 'missing' },
      }
      const result = buildProjectApiKeyStatus(detection)
      expect(result.used).toBe('project')
      expect(result.status).toBe('healthy')
    })

    it('falls through to user when project key invalid', () => {
      const detection: AllScopesDetectionResult = {
        project: { found: true, key: 'bad', status: 'invalid' },
        user: { found: true, key: 'sk-user', status: 'healthy' },
        env: { found: false, key: null, status: 'missing' },
      }
      const result = buildProjectApiKeyStatus(detection)
      expect(result.used).toBe('user')
      expect(result.status).toBe('healthy')
    })

    it('returns missing when no keys found anywhere', () => {
      const detection: AllScopesDetectionResult = {
        project: { found: false, key: null, status: 'missing' },
        user: { found: false, key: null, status: 'missing' },
        env: { found: false, key: null, status: 'missing' },
      }
      const result = buildProjectApiKeyStatus(detection)
      expect(result.used).toBeNull()
      expect(result.status).toBe('missing')
    })
  })

  describe('userApiKeyStatusFromHealth', () => {
    it('converts not-required', () => {
      const result = userApiKeyStatusFromHealth('not-required')
      expect(result.used).toBeNull()
      expect(result.status).toBe('not-required')
      expect(result.scopes.user).toBe('missing')
      expect(result.scopes.env).toBe('missing')
    })

    it('converts missing', () => {
      const result = userApiKeyStatusFromHealth('missing')
      expect(result.used).toBeNull()
      expect(result.status).toBe('missing')
    })

    it('converts healthy', () => {
      const result = userApiKeyStatusFromHealth('healthy')
      expect(result.used).toBeNull()
      expect(result.status).toBe('healthy')
    })
  })

  describe('projectApiKeyStatusFromHealth', () => {
    it('converts not-required', () => {
      const result = projectApiKeyStatusFromHealth('not-required')
      expect(result.used).toBeNull()
      expect(result.status).toBe('not-required')
      expect(result.scopes).toEqual({ project: 'missing', user: 'missing', env: 'missing' })
    })

    it('converts healthy', () => {
      const result = projectApiKeyStatusFromHealth('healthy')
      expect(result.used).toBeNull()
      expect(result.status).toBe('healthy')
    })
  })
})
