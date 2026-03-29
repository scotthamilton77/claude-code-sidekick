/**
 * Tests for scripted.ts — non-interactive setup mode.
 *
 * Tests runScripted for flag combinations, dev-mode guards, error paths,
 * and configuredCount accuracy.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PassThrough } from 'node:stream'
import type { Logger } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'
import type { MockedLogger } from '@sidekick/testing-fixtures'
import type { SetupCommandOptions } from '../helpers.js'

// ============================================================================
// Hoisted mocks — vi.hoisted() ensures these are available when vi.mock()
// factories execute (vi.mock is hoisted above all other code)
// ============================================================================

const {
  mockEnsurePluginInstalled,
  mockDetectInstalledScope,
  mockDetectShell,
  mockInstallAlias,
  mockUninstallAlias,
  mockSerializeProfileYaml,
  mockConfigureStatusline,
  mockWriteApiKeyToEnv,
  mockWritePersonaConfig,
  mockGetUserStatus,
  mockWriteUserStatus,
  mockGetProjectStatus,
  mockWriteProjectStatus,
  mockValidateOpenRouterKey,
  mockInstallGitignoreSection,
} = vi.hoisted(() => ({
  mockEnsurePluginInstalled: vi.fn(),
  mockDetectInstalledScope: vi.fn(),
  mockDetectShell: vi.fn(),
  mockInstallAlias: vi.fn(),
  mockUninstallAlias: vi.fn(),
  mockSerializeProfileYaml: vi.fn(),
  mockConfigureStatusline: vi.fn(),
  mockWriteApiKeyToEnv: vi.fn(),
  mockWritePersonaConfig: vi.fn(),
  mockGetUserStatus: vi.fn(),
  mockWriteUserStatus: vi.fn(),
  mockGetProjectStatus: vi.fn(),
  mockWriteProjectStatus: vi.fn(),
  mockValidateOpenRouterKey: vi.fn(),
  mockInstallGitignoreSection: vi.fn(),
}))

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  const MockSetupStatusService = vi.fn().mockImplementation(function () {
    return {
      getUserStatus: mockGetUserStatus,
      writeUserStatus: mockWriteUserStatus,
      getProjectStatus: mockGetProjectStatus,
      writeProjectStatus: mockWriteProjectStatus,
    }
  })
  // Preserve static methods used by scripted.ts for project status writes

  const mock = MockSetupStatusService as any
  mock.userApiKeyStatusFromHealth = actual.SetupStatusService.userApiKeyStatusFromHealth
  mock.projectApiKeyStatusFromHealth = actual.SetupStatusService.projectApiKeyStatusFromHealth
  return {
    ...actual,
    SetupStatusService: MockSetupStatusService,
    installGitignoreSection: mockInstallGitignoreSection,
    validateOpenRouterKey: mockValidateOpenRouterKey,
  }
})

vi.mock('../plugin-installer.js', () => ({
  ensurePluginInstalled: mockEnsurePluginInstalled,
  detectInstalledScope: mockDetectInstalledScope,
}))

vi.mock('../shell-alias.js', () => ({
  detectShell: mockDetectShell,
  installAlias: mockInstallAlias,
  uninstallAlias: mockUninstallAlias,
}))

vi.mock('../user-profile-setup.js', () => ({
  serializeProfileYaml: mockSerializeProfileYaml,
}))

vi.mock('../helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers.js')>()
  return {
    ...actual,
    configureStatusline: mockConfigureStatusline,
    writeApiKeyToEnv: mockWriteApiKeyToEnv,
    writePersonaConfig: mockWritePersonaConfig,
  }
})

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs/promises')>()
  return {
    ...actual,
    mkdir: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  }
})

import { runScripted, hasScriptingFlags } from '../scripted.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createStdout(): { stdout: NodeJS.WritableStream; getOutput: () => string } {
  const chunks: Buffer[] = []
  const stdout = new PassThrough()
  stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  return { stdout, getOutput: () => Buffer.concat(chunks).toString() }
}

const projectDir = '/test/project'
const homeDir = '/test/home'

// ============================================================================
// hasScriptingFlags
// ============================================================================

describe('hasScriptingFlags', () => {
  it('returns false when no scripting flags set', () => {
    expect(hasScriptingFlags({})).toBe(false)
    expect(hasScriptingFlags({ checkOnly: true })).toBe(false)
    expect(hasScriptingFlags({ fix: true })).toBe(false)
  })

  it('returns true for marketplaceScope', () => {
    expect(hasScriptingFlags({ marketplaceScope: 'user' })).toBe(true)
  })

  it('returns true for pluginScope', () => {
    expect(hasScriptingFlags({ pluginScope: 'project' })).toBe(true)
  })

  it('returns true for statuslineScope', () => {
    expect(hasScriptingFlags({ statuslineScope: 'user' })).toBe(true)
  })

  it('returns true for gitignore', () => {
    expect(hasScriptingFlags({ gitignore: true })).toBe(true)
    expect(hasScriptingFlags({ gitignore: false })).toBe(true)
  })

  it('returns true for personas', () => {
    expect(hasScriptingFlags({ personas: true })).toBe(true)
  })

  it('returns true for apiKeyScope', () => {
    expect(hasScriptingFlags({ apiKeyScope: 'user' })).toBe(true)
  })

  it('returns true for autoConfig', () => {
    expect(hasScriptingFlags({ autoConfig: 'auto' })).toBe(true)
  })

  it('returns true for alias', () => {
    expect(hasScriptingFlags({ alias: true })).toBe(true)
  })

  it('returns true for user profile flags', () => {
    expect(hasScriptingFlags({ userProfileName: 'Scott' })).toBe(true)
    expect(hasScriptingFlags({ userProfileRole: 'architect' })).toBe(true)
    expect(hasScriptingFlags({ userProfileInterests: 'TypeScript' })).toBe(true)
  })
})

// ============================================================================
// runScripted
// ============================================================================

describe('runScripted', () => {
  let logger: MockedLogger
  let originalEnv: NodeJS.ProcessEnv

  beforeEach(() => {
    logger = createFakeLogger()
    originalEnv = { ...process.env }

    // Clear all hoisted mocks
    mockEnsurePluginInstalled.mockClear()
    mockDetectInstalledScope.mockClear()
    mockDetectShell.mockClear()
    mockInstallAlias.mockClear()
    mockUninstallAlias.mockClear()
    mockSerializeProfileYaml.mockClear()
    mockConfigureStatusline.mockClear()
    mockWriteApiKeyToEnv.mockClear()
    mockWritePersonaConfig.mockClear()
    mockGetUserStatus.mockClear()
    mockWriteUserStatus.mockClear()
    mockGetProjectStatus.mockClear()
    mockWriteProjectStatus.mockClear()
    mockValidateOpenRouterKey.mockClear()
    mockInstallGitignoreSection.mockClear()

    // Defaults
    mockGetProjectStatus.mockResolvedValue(null)
    mockWriteProjectStatus.mockResolvedValue(undefined)
    mockEnsurePluginInstalled.mockResolvedValue({ pluginScope: 'user' })
    mockConfigureStatusline.mockResolvedValue(true)
    mockInstallGitignoreSection.mockResolvedValue({ status: 'installed' })
    mockDetectShell.mockReturnValue({ name: 'zsh', rcFile: '.zshrc' })
    mockInstallAlias.mockReturnValue('installed')
    mockUninstallAlias.mockReturnValue('removed')
    mockSerializeProfileYaml.mockReturnValue('name: Scott\n')
  })

  afterEach(() => {
    process.env = originalEnv
  })

  // --------------------------------------------------------------------------
  // Dev-mode scope guard
  // --------------------------------------------------------------------------

  it('blocks non-user scopes in dev-mode', async () => {
    const { stdout, getOutput } = createStdout()
    const result = await runScripted(
      projectDir,
      logger as Logger,
      stdout,
      { homeDir, marketplaceScope: 'project' },
      true // isDevMode
    )
    expect(result.exitCode).toBe(1)
    expect(getOutput()).toContain('Dev-mode is active')
    expect(getOutput()).toContain('Cannot use non-user scopes')
  })

  it('blocks multiple non-user scopes in dev-mode', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(
      projectDir,
      logger as Logger,
      stdout,
      { homeDir, marketplaceScope: 'local', statuslineScope: 'project' },
      true
    )
    const output = getOutput()
    expect(output).toContain('--marketplace-scope=local')
    expect(output).toContain('--statusline-scope=project')
  })

  it('allows user scope in dev-mode', async () => {
    const { stdout, getOutput } = createStdout()
    const result = await runScripted(projectDir, logger as Logger, stdout, { homeDir, statuslineScope: 'user' }, true)
    expect(result.exitCode).toBe(0)
    expect(getOutput()).not.toContain('Dev-mode is active')
  })

  // --------------------------------------------------------------------------
  // Plugin installation
  // --------------------------------------------------------------------------

  it('installs plugin when marketplaceScope specified', async () => {
    const { stdout } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, marketplaceScope: 'user' }, false)
    expect(mockEnsurePluginInstalled).toHaveBeenCalledWith(
      expect.objectContaining({ marketplaceScope: 'user', force: true })
    )
  })

  it('reports plugin installation error without failing', async () => {
    mockEnsurePluginInstalled.mockResolvedValue({ error: 'marketplace down' })
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, marketplaceScope: 'user' }, false)
    expect(getOutput()).toContain('Plugin installation issue')
  })

  // --------------------------------------------------------------------------
  // Statusline
  // --------------------------------------------------------------------------

  it('configures statusline when scope specified', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, statuslineScope: 'user' }, false)
    expect(mockConfigureStatusline).toHaveBeenCalled()
    expect(getOutput()).toContain('Statusline configured')
  })

  it('reports statusline dev-mode skip', async () => {
    mockConfigureStatusline.mockResolvedValue(false)
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, statuslineScope: 'user' }, false)
    expect(getOutput()).toContain('dev-mode (skipped)')
  })

  // --------------------------------------------------------------------------
  // Gitignore
  // --------------------------------------------------------------------------

  it('installs gitignore when --gitignore=true', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, gitignore: true }, false)
    expect(mockInstallGitignoreSection).toHaveBeenCalledWith(projectDir)
    expect(getOutput()).toContain('Gitignore configured')
  })

  it('reports already-installed gitignore', async () => {
    mockInstallGitignoreSection.mockResolvedValue({ status: 'already-installed' })
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, gitignore: true }, false)
    expect(getOutput()).toContain('Gitignore already configured')
  })

  it('reports gitignore installation error', async () => {
    mockInstallGitignoreSection.mockResolvedValue({ status: 'error', error: 'no .git dir' })
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, gitignore: true }, false)
    expect(getOutput()).toContain('Failed to update .gitignore')
  })

  it('skips gitignore when --gitignore=false', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, gitignore: false }, false)
    expect(mockInstallGitignoreSection).not.toHaveBeenCalled()
    expect(getOutput()).toContain('Gitignore skipped')
  })

  // --------------------------------------------------------------------------
  // Personas
  // --------------------------------------------------------------------------

  it('enables personas when specified', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, personas: true }, false)
    expect(mockWritePersonaConfig).toHaveBeenCalledWith(homeDir, true)
    expect(getOutput()).toContain('Personas enabled')
  })

  it('disables personas when specified', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, personas: false }, false)
    expect(mockWritePersonaConfig).toHaveBeenCalledWith(homeDir, false)
    expect(getOutput()).toContain('Personas disabled')
  })

  // --------------------------------------------------------------------------
  // API key
  // --------------------------------------------------------------------------

  it('validates and saves API key when scope and env var present', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-valid-key'
    mockValidateOpenRouterKey.mockResolvedValue({ valid: true })

    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, apiKeyScope: 'user' }, false)

    expect(mockValidateOpenRouterKey).toHaveBeenCalledWith('sk-or-valid-key', logger)
    expect(mockWriteApiKeyToEnv).toHaveBeenCalled()
    expect(getOutput()).toContain('API key saved')
  })

  it('saves invalid API key with warning', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-bad'
    mockValidateOpenRouterKey.mockResolvedValue({ valid: false, error: 'unauthorized' })

    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, apiKeyScope: 'user' }, false)
    expect(getOutput()).toContain('invalid (unauthorized)')
    expect(getOutput()).toContain('API key saved anyway')
    expect(mockWriteApiKeyToEnv).toHaveBeenCalled()
  })

  it('warns when apiKeyScope specified but env var missing', async () => {
    delete process.env.OPENROUTER_API_KEY

    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, apiKeyScope: 'user' }, false)
    expect(getOutput()).toContain('OPENROUTER_API_KEY not set')
    expect(mockWriteApiKeyToEnv).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // Auto-config
  // --------------------------------------------------------------------------

  it('configures auto-config preference', async () => {
    mockGetUserStatus.mockResolvedValue(null)
    mockDetectInstalledScope.mockResolvedValue('user')

    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, autoConfig: 'auto' }, false)
    expect(mockWriteUserStatus).toHaveBeenCalled()
    expect(getOutput()).toContain("Auto-config set to 'auto'")
  })

  it('blocks auto-config when plugin not user-scoped', async () => {
    mockGetUserStatus.mockResolvedValue(null)
    mockDetectInstalledScope.mockResolvedValue('project')

    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, autoConfig: 'auto' }, false)
    expect(getOutput()).toContain('Auto-configure requires user-scoped plugin')
    expect(mockWriteUserStatus).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // Shell alias
  // --------------------------------------------------------------------------

  it('installs shell alias', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, alias: true }, false)
    expect(mockInstallAlias).toHaveBeenCalled()
    expect(getOutput()).toContain('Shell alias added')
  })

  it('reports already-installed alias', async () => {
    mockInstallAlias.mockReturnValue('already-installed')
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, alias: true }, false)
    expect(getOutput()).toContain('Shell alias already configured')
  })

  it('removes shell alias', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, alias: false }, false)
    expect(mockUninstallAlias).toHaveBeenCalled()
    expect(getOutput()).toContain('Shell alias removed')
  })

  it('reports no alias found on removal', async () => {
    mockUninstallAlias.mockReturnValue('not-found')
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, alias: false }, false)
    expect(getOutput()).toContain('No shell alias found')
  })

  it('warns on unsupported shell for alias', async () => {
    mockDetectShell.mockReturnValue(null)
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, alias: true }, false)
    expect(getOutput()).toContain('Unsupported shell')
  })

  // --------------------------------------------------------------------------
  // User profile
  // --------------------------------------------------------------------------

  it('saves user profile when all required flags provided', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(
      projectDir,
      logger as Logger,
      stdout,
      {
        homeDir,
        userProfileName: 'Scott',
        userProfileRole: 'architect',
        userProfileInterests: 'TypeScript, Rust',
      },
      false
    )
    expect(mockSerializeProfileYaml).toHaveBeenCalledWith({
      name: 'Scott',
      role: 'architect',
      interests: ['TypeScript', 'Rust'],
    })
    expect(getOutput()).toContain('User profile saved')
  })

  it('requires --user-profile-name', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, userProfileRole: 'dev' }, false)
    expect(getOutput()).toContain('--user-profile-name is required')
  })

  it('requires --user-profile-role when name provided', async () => {
    const { stdout, getOutput } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, userProfileName: 'Scott' }, false)
    expect(getOutput()).toContain('--user-profile-role is required')
  })

  // --------------------------------------------------------------------------
  // configuredCount accuracy
  // --------------------------------------------------------------------------

  it('reports "no changes" when no flags produce results', async () => {
    const { stdout, getOutput } = createStdout()
    // No scripting flags that produce changes
    const options: SetupCommandOptions = { homeDir }
    await runScripted(projectDir, logger as Logger, stdout, options, false)
    expect(getOutput()).toContain('No configuration changes made')
  })

  it('reports correct count for multiple successful operations', async () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-test'
    mockValidateOpenRouterKey.mockResolvedValue({ valid: true })

    const { stdout, getOutput } = createStdout()
    await runScripted(
      projectDir,
      logger as Logger,
      stdout,
      {
        homeDir,
        statuslineScope: 'user',
        gitignore: true,
        personas: true,
        apiKeyScope: 'user',
      },
      false
    )
    const output = getOutput()
    expect(output).toContain('Configured 4 settings')
  })

  it('writes project status only when configuredCount > 0', async () => {
    const { stdout } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir }, false)
    expect(mockWriteProjectStatus).not.toHaveBeenCalled()
  })

  it('writes project status after successful configuration', async () => {
    const { stdout } = createStdout()
    await runScripted(projectDir, logger as Logger, stdout, { homeDir, statuslineScope: 'user' }, false)
    expect(mockWriteProjectStatus).toHaveBeenCalled()
  })

  it('always returns exitCode 0', async () => {
    const { stdout } = createStdout()
    const result = await runScripted(projectDir, logger as Logger, stdout, { homeDir }, false)
    expect(result.exitCode).toBe(0)
  })
})
