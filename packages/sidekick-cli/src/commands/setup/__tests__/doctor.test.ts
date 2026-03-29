/**
 * Tests for doctor.ts — health check and auto-fix logic.
 *
 * Tests runDoctor (the main entry point) and the internal runDoctorFixes path.
 * Mocks all external dependencies to isolate the doctor's orchestration and
 * output formatting logic.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { PassThrough } from 'node:stream'
import type { Logger } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'
import type { MockedLogger } from '@sidekick/testing-fixtures'

// ============================================================================
// Hoisted mocks — vi.hoisted() ensures these are available when vi.mock()
// factories execute (vi.mock is hoisted above all other code)
// ============================================================================

const {
  mockRunDoctorCheck,
  mockDetectPluginInstallation,
  mockDetectPluginLiveness,
  mockGetUserStatus,
  mockWriteUserStatus,
  mockWriteProjectStatus,
  mockGetProjectStatus,
  mockDetectGitignoreStatus,
  mockInstallGitignoreSection,
  mockFindZombieDaemons,
  mockKillZombieDaemons,
  mockEnsurePluginInstalled,
  mockDetectShell,
  mockInstallAlias,
  mockIsAliasInRcFile,
  mockConfigureStatusline,
} = vi.hoisted(() => ({
  mockRunDoctorCheck: vi.fn(),
  mockDetectPluginInstallation: vi.fn(),
  mockDetectPluginLiveness: vi.fn(),
  mockGetUserStatus: vi.fn(),
  mockWriteUserStatus: vi.fn(),
  mockWriteProjectStatus: vi.fn(),
  mockGetProjectStatus: vi.fn(),
  mockDetectGitignoreStatus: vi.fn(),
  mockInstallGitignoreSection: vi.fn(),
  mockFindZombieDaemons: vi.fn(),
  mockKillZombieDaemons: vi.fn(),
  mockEnsurePluginInstalled: vi.fn(),
  mockDetectShell: vi.fn(),
  mockInstallAlias: vi.fn(),
  mockIsAliasInRcFile: vi.fn(),
  mockConfigureStatusline: vi.fn(),
}))

// ============================================================================
// Module mocks
// ============================================================================

vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  const MockSetupStatusService = vi.fn().mockImplementation(function () {
    return {
      runDoctorCheck: mockRunDoctorCheck,
      detectPluginInstallation: mockDetectPluginInstallation,
      detectPluginLiveness: mockDetectPluginLiveness,
      getUserStatus: mockGetUserStatus,
      writeUserStatus: mockWriteUserStatus,
      writeProjectStatus: mockWriteProjectStatus,
      getProjectStatus: mockGetProjectStatus,
    }
  })
  // Preserve static methods used by doctor.ts (runDoctorFixes creates a UserSetupStatus)

  const mock = MockSetupStatusService as any
  mock.userApiKeyStatusFromHealth = actual.SetupStatusService.userApiKeyStatusFromHealth
  mock.projectApiKeyStatusFromHealth = actual.SetupStatusService.projectApiKeyStatusFromHealth
  return {
    ...actual,
    SetupStatusService: MockSetupStatusService,
    detectGitignoreStatus: mockDetectGitignoreStatus,
    installGitignoreSection: mockInstallGitignoreSection,
    findZombieDaemons: mockFindZombieDaemons,
    killZombieDaemons: mockKillZombieDaemons,
  }
})

vi.mock('../plugin-installer.js', () => ({
  ensurePluginInstalled: mockEnsurePluginInstalled,
}))

vi.mock('../shell-alias.js', () => ({
  detectShell: mockDetectShell,
  installAlias: mockInstallAlias,
  isAliasInRcFile: mockIsAliasInRcFile,
}))

vi.mock('../helpers.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../helpers.js')>()
  return {
    ...actual,
    configureStatusline: mockConfigureStatusline,
  }
})

import { runDoctor } from '../doctor.js'

// ============================================================================
// Test Helpers
// ============================================================================

function createStdout(): { stdout: NodeJS.WritableStream; getOutput: () => string } {
  const chunks: Buffer[] = []
  const stdout = new PassThrough()
  stdout.on('data', (chunk: Buffer) => chunks.push(chunk))
  return { stdout, getOutput: () => Buffer.concat(chunks).toString() }
}

/** Healthy doctor check result — all green */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function healthyDoctorResult() {
  return {
    overallHealth: 'healthy' as const,
    userSetupExists: true,
    fixes: [],
    apiKeys: {
      OPENROUTER_API_KEY: {
        actual: 'healthy',
        used: 'user',
        scopes: { project: 'missing' as const, user: 'healthy' as const, env: 'missing' as const },
      },
    },
    statusline: { actual: 'user' },
  }
}

/** Unhealthy doctor check result */
// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function unhealthyDoctorResult() {
  return {
    overallHealth: 'needs-attention' as const,
    userSetupExists: false,
    fixes: [],
    apiKeys: {
      OPENROUTER_API_KEY: {
        actual: 'missing',
        used: null,
        scopes: { project: 'missing' as const, user: 'missing' as const, env: 'missing' as const },
      },
    },
    statusline: { actual: 'none' },
  }
}

// ============================================================================
// Tests
// ============================================================================

describe('runDoctor', () => {
  let logger: MockedLogger
  const projectDir = '/test/project'
  const homeDir = '/test/home'

  beforeEach(() => {
    logger = createFakeLogger()

    // Clear all hoisted mocks
    mockRunDoctorCheck.mockClear()
    mockDetectPluginInstallation.mockClear()
    mockDetectPluginLiveness.mockClear()
    mockGetUserStatus.mockClear()
    mockWriteUserStatus.mockClear()
    mockWriteProjectStatus.mockClear()
    mockGetProjectStatus.mockClear()
    mockDetectGitignoreStatus.mockClear()
    mockInstallGitignoreSection.mockClear()
    mockFindZombieDaemons.mockClear()
    mockKillZombieDaemons.mockClear()
    mockEnsurePluginInstalled.mockClear()
    mockDetectShell.mockClear()
    mockInstallAlias.mockClear()
    mockIsAliasInRcFile.mockClear()
    mockConfigureStatusline.mockClear()

    // Default healthy state
    mockRunDoctorCheck.mockResolvedValue(healthyDoctorResult())
    mockDetectPluginInstallation.mockResolvedValue('plugin')
    mockDetectPluginLiveness.mockResolvedValue('active')
    mockDetectGitignoreStatus.mockResolvedValue('installed')
    mockFindZombieDaemons.mockResolvedValue([])
    mockGetUserStatus.mockResolvedValue(null)
    mockDetectShell.mockReturnValue({ name: 'zsh', rcFile: '.zshrc' })
    mockIsAliasInRcFile.mockReturnValue(true)
  })

  // --------------------------------------------------------------------------
  // Basic execution
  // --------------------------------------------------------------------------

  it('outputs doctor header', async () => {
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    const output = getOutput()
    expect(output).toContain('Sidekick Doctor')
    expect(output).toContain('===============')
  })

  it('returns exitCode 0 when all checks healthy', async () => {
    const { stdout } = createStdout()
    const result = await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(result.exitCode).toBe(0)
  })

  it('returns exitCode 1 when overall unhealthy', async () => {
    mockRunDoctorCheck.mockResolvedValue(unhealthyDoctorResult())
    mockDetectPluginInstallation.mockResolvedValue('none')
    mockDetectGitignoreStatus.mockResolvedValue('missing')
    mockDetectPluginLiveness.mockResolvedValue('inactive')

    const { stdout } = createStdout()
    const result = await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(result.exitCode).toBe(1)
  })

  // --------------------------------------------------------------------------
  // --only filtering
  // --------------------------------------------------------------------------

  it('returns exitCode 1 for invalid --only check name', async () => {
    const { stdout, getOutput } = createStdout()
    const result = await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      only: 'bogus-check',
    })
    expect(result.exitCode).toBe(1)
    expect(getOutput()).toContain('Unknown doctor check(s): bogus-check')
  })

  it('runs only specified checks with --only', async () => {
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      only: 'gitignore',
    })
    const output = getOutput()
    // gitignore check was run
    expect(mockDetectGitignoreStatus).toHaveBeenCalled()
    // Other checks were NOT run
    expect(mockRunDoctorCheck).not.toHaveBeenCalled()
    expect(mockDetectPluginInstallation).not.toHaveBeenCalled()
    expect(mockFindZombieDaemons).not.toHaveBeenCalled()
  })

  it('accepts comma-separated --only values', async () => {
    const { stdout } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      only: 'gitignore,zombies',
    })
    expect(mockDetectGitignoreStatus).toHaveBeenCalled()
    expect(mockFindZombieDaemons).toHaveBeenCalled()
    expect(mockRunDoctorCheck).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // Individual check outputs
  // --------------------------------------------------------------------------

  it('reports API key health in output', async () => {
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    const output = getOutput()
    expect(output).toContain('OpenRouter API Key')
  })

  it('reports statusline status in output', async () => {
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    const output = getOutput()
    expect(output).toContain('Statusline')
  })

  it('reports gitignore status', async () => {
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('Gitignore')
  })

  it('reports plugin status', async () => {
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('Plugin')
  })

  it('reports zombie daemon count', async () => {
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('Zombie Daemons')
  })

  it('reports zombie daemons when found', async () => {
    mockFindZombieDaemons.mockResolvedValue([{ pid: 1234 }, { pid: 5678 }])
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    const output = getOutput()
    expect(output).toContain('2 found')
  })

  it('reports shell alias status when configured', async () => {
    mockIsAliasInRcFile.mockReturnValue(true)
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('Shell Alias')
    expect(getOutput()).toContain('configured')
  })

  it('reports shell alias as not configured', async () => {
    mockIsAliasInRcFile.mockReturnValue(false)
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('Shell Alias')
    expect(getOutput()).toContain('not configured')
  })

  it('reports unsupported shell for alias check', async () => {
    mockDetectShell.mockReturnValue(null)
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('unsupported shell')
  })

  // --------------------------------------------------------------------------
  // Doctor cache corrections
  // --------------------------------------------------------------------------

  it('displays cache corrections when found', async () => {
    mockRunDoctorCheck.mockResolvedValue({
      ...healthyDoctorResult(),
      fixes: ['Fixed user statusline cache', 'Fixed api key scope'],
    })
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    const output = getOutput()
    expect(output).toContain('Cache corrections')
    expect(output).toContain('Fixed user statusline cache')
  })

  // --------------------------------------------------------------------------
  // Missing user setup warning
  // --------------------------------------------------------------------------

  it('warns when user setup-status.json is missing', async () => {
    mockRunDoctorCheck.mockResolvedValue({
      ...healthyDoctorResult(),
      userSetupExists: false,
    })
    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('User Setup')
    expect(getOutput()).toContain('missing')
  })

  // --------------------------------------------------------------------------
  // Auto-config warning
  // --------------------------------------------------------------------------

  it('warns when auto-configure enabled but plugin not user-scoped', async () => {
    mockGetUserStatus.mockResolvedValue({
      preferences: { autoConfigureProjects: true },
    })
    mockDetectPluginInstallation.mockResolvedValue('dev-mode')

    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('Auto-configure is enabled but plugin is not installed at user scope')
  })

  // --------------------------------------------------------------------------
  // --fix mode (full)
  // --------------------------------------------------------------------------

  it('runs fixes when unhealthy and --fix is set', async () => {
    mockRunDoctorCheck.mockResolvedValue(unhealthyDoctorResult())
    mockDetectPluginInstallation.mockResolvedValue('none')
    mockDetectGitignoreStatus.mockResolvedValue('missing')
    mockConfigureStatusline.mockResolvedValue(true)
    mockInstallGitignoreSection.mockResolvedValue({ status: 'installed' })
    mockEnsurePluginInstalled.mockResolvedValue({ pluginScope: 'user' })
    mockKillZombieDaemons.mockResolvedValue([])
    mockIsAliasInRcFile.mockReturnValue(false)
    mockInstallAlias.mockReturnValue('installed')

    const { stdout, getOutput } = createStdout()
    const result = await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      fix: true,
    })

    const output = getOutput()
    expect(output).toContain('Fixing detected issues')
    // Should attempt fixes for detected problems
    expect(mockConfigureStatusline).toHaveBeenCalled()
    expect(mockInstallGitignoreSection).toHaveBeenCalled()
    expect(mockEnsurePluginInstalled).toHaveBeenCalled()
  })

  it('reports unfixable items requiring manual action', async () => {
    mockRunDoctorCheck.mockResolvedValue({
      ...unhealthyDoctorResult(),
      apiKeys: {
        OPENROUTER_API_KEY: {
          actual: 'missing',
          used: null,
          scopes: { project: 'missing' as const, user: 'missing' as const, env: 'missing' as const },
        },
      },
    })
    mockDetectPluginInstallation.mockResolvedValue('plugin')
    mockDetectPluginLiveness.mockResolvedValue('inactive')
    mockDetectGitignoreStatus.mockResolvedValue('installed')
    mockConfigureStatusline.mockResolvedValue(true)
    mockKillZombieDaemons.mockResolvedValue([])
    mockIsAliasInRcFile.mockReturnValue(true)

    const { stdout, getOutput } = createStdout()
    const result = await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      fix: true,
    })
    const output = getOutput()
    expect(output).toContain('Requires manual action')
    expect(result.exitCode).toBe(1)
  })

  it('suggests --fix when unhealthy without fix flag', async () => {
    mockRunDoctorCheck.mockResolvedValue(unhealthyDoctorResult())
    mockDetectPluginInstallation.mockResolvedValue('none')
    mockDetectGitignoreStatus.mockResolvedValue('missing')

    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, { homeDir })
    expect(getOutput()).toContain('sidekick doctor --fix')
  })

  // --------------------------------------------------------------------------
  // --fix mode (filtered with --only)
  // --------------------------------------------------------------------------

  it('runs filtered fix with --only + --fix', async () => {
    mockDetectGitignoreStatus.mockResolvedValue('missing')
    mockInstallGitignoreSection.mockResolvedValue({ status: 'installed' })
    mockKillZombieDaemons.mockResolvedValue([])

    const { stdout, getOutput } = createStdout()
    const result = await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      only: 'gitignore',
      fix: true,
    })

    const output = getOutput()
    expect(output).toContain('Fixing detected issues')
    expect(mockInstallGitignoreSection).toHaveBeenCalled()
    // Plugin fix should NOT have been called (not in --only filter)
    expect(mockEnsurePluginInstalled).not.toHaveBeenCalled()
  })

  // --------------------------------------------------------------------------
  // Fix: Zombie daemons
  // --------------------------------------------------------------------------

  it('kills zombie daemons in fix mode', async () => {
    mockRunDoctorCheck.mockResolvedValue(unhealthyDoctorResult())
    mockDetectPluginInstallation.mockResolvedValue('plugin')
    mockDetectGitignoreStatus.mockResolvedValue('installed')
    mockConfigureStatusline.mockResolvedValue(true)
    mockKillZombieDaemons.mockResolvedValue([
      { pid: 1234, killed: true },
      { pid: 5678, killed: false, error: 'EPERM' },
    ])
    mockIsAliasInRcFile.mockReturnValue(true)

    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      fix: true,
    })
    const output = getOutput()
    expect(output).toContain('Killed 1 zombie daemon')
    expect(output).toContain('Failed to kill PID 5678')
  })

  // --------------------------------------------------------------------------
  // Fix: Gitignore error path
  // --------------------------------------------------------------------------

  it('reports gitignore fix failure', async () => {
    mockDetectGitignoreStatus.mockResolvedValue('missing')
    mockInstallGitignoreSection.mockResolvedValue({ status: 'error', error: 'Permission denied' })
    mockKillZombieDaemons.mockResolvedValue([])

    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      only: 'gitignore',
      fix: true,
    })
    expect(getOutput()).toContain('Failed to update .gitignore')
    expect(getOutput()).toContain('Permission denied')
  })

  // --------------------------------------------------------------------------
  // Fix: Plugin installation error path
  // --------------------------------------------------------------------------

  it('reports plugin installation exception', async () => {
    // Need plugin to be detected as 'none' for fix to trigger
    mockDetectPluginInstallation.mockResolvedValue('none')
    mockEnsurePluginInstalled.mockRejectedValue(new Error('Network error'))
    mockKillZombieDaemons.mockResolvedValue([])
    mockRunDoctorCheck.mockResolvedValue(unhealthyDoctorResult())
    mockDetectGitignoreStatus.mockResolvedValue('installed')
    mockConfigureStatusline.mockResolvedValue(true)
    mockIsAliasInRcFile.mockReturnValue(true)

    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      fix: true,
    })
    expect(getOutput()).toContain('Plugin installation failed')
    expect(getOutput()).toContain('Network error')
  })

  // --------------------------------------------------------------------------
  // Fix: Statusline dev-mode skip
  // --------------------------------------------------------------------------

  it('reports statusline dev-mode skip during fix', async () => {
    mockRunDoctorCheck.mockResolvedValue(unhealthyDoctorResult())
    mockDetectPluginInstallation.mockResolvedValue('plugin')
    mockDetectGitignoreStatus.mockResolvedValue('installed')
    mockConfigureStatusline.mockResolvedValue(false) // dev-mode managed
    mockKillZombieDaemons.mockResolvedValue([])
    mockIsAliasInRcFile.mockReturnValue(true)

    const { stdout, getOutput } = createStdout()
    await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      fix: true,
    })
    expect(getOutput()).toContain('dev-mode (skipped)')
  })

  // --------------------------------------------------------------------------
  // Fix idempotency
  // --------------------------------------------------------------------------

  it('reports no fixable issues when everything already healthy in filtered mode', async () => {
    mockKillZombieDaemons.mockResolvedValue([])
    const { stdout, getOutput } = createStdout()
    const result = await runDoctor(projectDir, logger as Logger, stdout, {
      homeDir,
      only: 'zombies',
      fix: true,
    })
    expect(getOutput()).toContain('No fixable issues found')
    expect(result.exitCode).toBe(0)
  })
})
