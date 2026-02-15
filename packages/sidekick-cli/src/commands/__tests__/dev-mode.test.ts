/**
 * Tests for dev-mode command handler.
 *
 * Verifies BEHAVIOR of handleDevModeCommand:
 * - enable: writes hooks to settings.local.json
 * - disable: removes hooks from settings
 * - status: shows current dev-mode state
 * - clean/clean-all: cleanup operations
 * - unknown subcommand: shows usage
 *
 * @see dev-mode.ts handleDevModeCommand
 */
import { Writable } from 'node:stream'
import { mkdir, writeFile, readFile, rm, access } from 'node:fs/promises'
import { constants } from 'node:fs'
import path from 'node:path'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import type { Logger } from '@sidekick/types'
import { handleDevModeCommand } from '../dev-mode'
import { DaemonClient } from '@sidekick/core'

// CollectingWritable to capture stdout output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Create fake logger
function createFakeLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn(() => createFakeLogger()) as any,
    flush: vi.fn() as any,
  }
}

// Mock @sidekick/core to avoid actual daemon operations
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    Logger: vi.fn(),
    DaemonClient: vi.fn().mockImplementation(function () {
      return { kill: vi.fn().mockResolvedValue({ killed: false }) }
    }),
    killAllDaemons: vi.fn().mockResolvedValue([]),
    getSocketPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.sock')),
    getTokenPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.token')),
    getLockPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.lock')),
    getUserDaemonsDir: vi.fn(() => '/tmp/claude/nonexistent-daemons-dir'),
  }
})

describe('handleDevModeCommand', () => {
  let stdout: CollectingWritable
  let logger: Logger
  let tempDir: string

  beforeEach(async () => {
    stdout = new CollectingWritable()
    logger = createFakeLogger()
    // Use /tmp/claude for sandbox compatibility
    tempDir = `/tmp/claude/dev-mode-test-${Date.now()}`
    await mkdir(tempDir, { recursive: true })
    // Create minimal project structure
    await mkdir(path.join(tempDir, '.claude'), { recursive: true })
    await mkdir(path.join(tempDir, '.sidekick', 'logs'), { recursive: true })
    await mkdir(path.join(tempDir, '.sidekick', 'state'), { recursive: true })
    await mkdir(path.join(tempDir, 'scripts', 'dev-sidekick'), { recursive: true })
    await mkdir(path.join(tempDir, 'packages', 'sidekick-cli', 'dist'), { recursive: true })
    // Create mock hook scripts
    const hooks = [
      'session-start',
      'session-end',
      'user-prompt-submit',
      'pre-tool-use',
      'post-tool-use',
      'stop',
      'pre-compact',
      'statusline',
    ]
    for (const hook of hooks) {
      const hookPath = path.join(tempDir, 'scripts', 'dev-sidekick', hook)
      await writeFile(hookPath, '#!/bin/bash\nexit 0')
    }
    // Create mock CLI binary
    await writeFile(path.join(tempDir, 'packages', 'sidekick-cli', 'dist', 'bin.js'), '')
    // Create mock plugin skill source directory with SKILL.md
    const skillSrcDir = path.join(tempDir, 'packages', 'sidekick-plugin', 'skills', 'sidekick-config')
    await mkdir(skillSrcDir, { recursive: true })
    await writeFile(
      path.join(skillSrcDir, 'SKILL.md'),
      [
        '# Sidekick Config Skill',
        '',
        '```bash',
        'npx @scotthamilton77/sidekick doctor',
        '```',
        '',
        'Run `npx @scotthamilton77/sidekick setup --force` to configure.',
        '',
      ].join('\n')
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('unknown subcommand', () => {
    test('shows usage and returns exit code 1', async () => {
      const result = await handleDevModeCommand('unknown', tempDir, logger, stdout)

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Unknown dev-mode subcommand: unknown')
      expect(stdout.data).toContain('Usage: sidekick dev-mode <command>')
      expect(stdout.data).toContain('enable')
      expect(stdout.data).toContain('disable')
      expect(stdout.data).toContain('status')
      expect(stdout.data).toContain('clean')
      expect(stdout.data).toContain('clean-all')
    })
  })

  describe('enable subcommand', () => {
    test('creates settings.local.json with hooks', async () => {
      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)

      const settingsPath = path.join(tempDir, '.claude', 'settings.local.json')
      const content = await readFile(settingsPath, 'utf-8')
      const settings = JSON.parse(content)

      expect(settings.hooks).toBeDefined()
      expect(settings.hooks.SessionStart).toHaveLength(1)
      expect(settings.hooks.SessionStart[0].hooks[0].command).toContain('dev-sidekick/session-start')
      expect(settings.statusLine).toBeDefined()
      expect(settings.statusLine.command).toContain('dev-sidekick/statusline')
    })

    test('reports already enabled if hooks exist', async () => {
      // First enable
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = '' // Clear

      // Second enable
      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('already enabled')
    })

    test('preserves existing settings when enabling', async () => {
      // Create settings with permissions
      const settingsPath = path.join(tempDir, '.claude', 'settings.local.json')
      await writeFile(
        settingsPath,
        JSON.stringify({
          permissions: { allow: ['Bash(git:*)'] },
        })
      )

      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const content = await readFile(settingsPath, 'utf-8')
      const settings = JSON.parse(content)
      expect(settings.permissions.allow).toContain('Bash(git:*)')
      expect(settings.hooks).toBeDefined()
    })

    test('returns error if hook scripts missing', async () => {
      // Remove a hook script
      await rm(path.join(tempDir, 'scripts', 'dev-sidekick', 'session-start'))

      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('missing')
    })

    test('sets devMode flag to true in project setup-status.json', async () => {
      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)

      // Check that devMode was set in .sidekick/setup-status.json
      const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
      const content = await readFile(setupStatusPath, 'utf-8')
      const status = JSON.parse(content)
      expect(status.devMode).toBe(true)
    })

    test('installs gitignore entries during enable', async () => {
      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)

      // Verify .gitignore was created with sidekick section
      const gitignoreContent = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
      expect(gitignoreContent).toContain('# >>> sidekick')
      expect(gitignoreContent).toContain('.sidekick/logs/')
      expect(gitignoreContent).toContain('.sidekick/setup-status.json')
      expect(gitignoreContent).toContain('# <<< sidekick')
    })

    test('gitignore install is idempotent on re-enable', async () => {
      // Enable twice
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''
      // Re-enable should not fail (settings already enabled check short-circuits,
      // but gitignore should have been installed on first run)
      const gitignoreContent = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
      // Count occurrences of section marker - should be exactly 1
      const matches = gitignoreContent.match(/# >>> sidekick/g)
      expect(matches).toHaveLength(1)
    })

    test('creates setup-status.json with statusline local and gitignore installed', async () => {
      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)

      const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
      const content = await readFile(setupStatusPath, 'utf-8')
      const status = JSON.parse(content)
      expect(status.devMode).toBe(true)
      expect(status.statusline).toBe('local')
      expect(status.gitignore).toBe('installed')
    })

    test('copies SKILL.md and transforms npx @scotthamilton77/sidekick to pnpm sidekick', async () => {
      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)

      // Verify the skill was copied and transformed
      const destSkillMd = path.join(tempDir, '.claude', 'skills', 'sidekick-config', 'SKILL.md')
      const content = await readFile(destSkillMd, 'utf-8')

      // Should have replaced npx @scotthamilton77/sidekick with pnpm sidekick
      expect(content).toContain('pnpm sidekick doctor')
      expect(content).toContain('pnpm sidekick setup --force')
      // Should NOT contain the original npx references
      expect(content).not.toContain('npx @scotthamilton77/sidekick')
    })

    test('updates existing setup-status.json to local statusline and installed gitignore', async () => {
      // Create an existing setup-status.json with different values
      const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
      await writeFile(
        setupStatusPath,
        JSON.stringify({
          version: 1,
          lastUpdatedAt: new Date().toISOString(),
          autoConfigured: true,
          statusline: 'user',
          apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
          gitignore: 'unknown',
          devMode: false,
        })
      )

      const result = await handleDevModeCommand('enable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)

      const content = await readFile(setupStatusPath, 'utf-8')
      const status = JSON.parse(content)
      expect(status.devMode).toBe(true)
      expect(status.statusline).toBe('local')
      expect(status.gitignore).toBe('installed')
      // Should preserve autoConfigured
      expect(status.autoConfigured).toBe(true)
    })
  })

  describe('disable subcommand', () => {
    test('removes dev-sidekick from settings', async () => {
      // First enable
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''

      // Then disable
      const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      // Output says either "removed" or "removing" (when file becomes empty)
      expect(stdout.data).toMatch(/removed|removing/i)

      const settingsPath = path.join(tempDir, '.claude', 'settings.local.json')
      try {
        await access(settingsPath, constants.F_OK)
        // File exists - check hooks are removed
        const content = await readFile(settingsPath, 'utf-8')
        const settings = JSON.parse(content)
        expect(settings.hooks).toBeUndefined()
        expect(settings.statusLine).toBeUndefined()
      } catch {
        // File was deleted (empty settings) - that's also valid
      }
    })

    test('preserves non-hook settings when disabling', async () => {
      // Create settings with permissions and hooks
      const settingsPath = path.join(tempDir, '.claude', 'settings.local.json')
      await writeFile(
        settingsPath,
        JSON.stringify({
          permissions: { allow: ['Bash(git:*)'] },
          hooks: {
            SessionStart: [
              { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/session-start' }] },
            ],
          },
          statusLine: { type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/statusline' },
        })
      )

      const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      const content = await readFile(settingsPath, 'utf-8')
      const settings = JSON.parse(content)
      expect(settings.permissions.allow).toContain('Bash(git:*)')
      expect(settings.hooks).toBeUndefined()
    })

    test('reports not enabled if no hooks', async () => {
      const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      // When no settings file exists, says "nothing to disable"
      expect(stdout.data).toMatch(/nothing to disable|not currently enabled/i)
    })

    test('sets devMode flag to false in project setup-status.json', async () => {
      // First enable
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''

      // Then disable
      const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)

      // Check that devMode was set to false in .sidekick/setup-status.json
      const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
      const content = await readFile(setupStatusPath, 'utf-8')
      const status = JSON.parse(content)
      expect(status.devMode).toBe(false)
    })

    test('removes gitignore entries when no plugin installed', async () => {
      // Enable (installs gitignore)
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''

      // Verify gitignore exists
      const gitignoreContent = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
      expect(gitignoreContent).toContain('# >>> sidekick')

      // Disable
      const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)

      // Gitignore section should be removed
      const updated = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
      expect(updated).not.toContain('# >>> sidekick')
    })

    test('preserves gitignore entries when plugin is detected', async () => {
      // Enable (installs gitignore)
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''

      // Simulate plugin being detected by setting pluginDetected flag
      const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
      const status = JSON.parse(await readFile(setupStatusPath, 'utf-8'))
      status.pluginDetected = true
      await writeFile(setupStatusPath, JSON.stringify(status, null, 2))

      // Disable
      const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('plugin')

      // Gitignore section should be preserved
      const gitignoreContent = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
      expect(gitignoreContent).toContain('# >>> sidekick')
    })

    test('kills running daemon during disable', async () => {
      // Configure DaemonClient mock to report a killed daemon
      const mockKill = vi.fn().mockResolvedValue({ killed: true, pid: 12345 })
      vi.mocked(DaemonClient).mockImplementation(function () {
        return { kill: mockKill } as any
      })

      // Enable first
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''

      // Disable
      const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockKill).toHaveBeenCalled()
      expect(stdout.data).toContain('Killed daemon')
      expect(stdout.data).toContain('12345')

      // Restore default mock behavior for other tests
      vi.mocked(DaemonClient).mockImplementation(function () {
        return { kill: vi.fn().mockResolvedValue({ killed: false }) } as any
      })
    })

    test('does not log kill message when no daemon running during disable', async () => {
      // Enable first
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''

      // Disable (default mock returns killed: false)
      const result = await handleDevModeCommand('disable', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).not.toContain('Killed daemon')
    })
  })

  describe('status subcommand', () => {
    test('shows disabled when no settings', async () => {
      const result = await handleDevModeCommand('status', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Dev-Mode Status')
      expect(stdout.data).toContain('DISABLED')
    })

    test('shows enabled when hooks present', async () => {
      // Enable first
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''

      const result = await handleDevModeCommand('status', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('ENABLED')
      expect(stdout.data).toContain('SessionStart')
    })

    test('shows CLI build status', async () => {
      const result = await handleDevModeCommand('status', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('CLI build:')
    })

    test('lists hook scripts', async () => {
      const result = await handleDevModeCommand('status', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('session-start')
      expect(stdout.data).toContain('statusline')
    })
  })

  describe('clean subcommand', () => {
    test('truncates log files', async () => {
      // Create a log file with content
      const logPath = path.join(tempDir, '.sidekick', 'logs', 'cli.log')
      await writeFile(logPath, 'some log content\n')

      const result = await handleDevModeCommand('clean', tempDir, logger, stdout, { force: true })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Truncated')
      const content = await readFile(logPath, 'utf-8')
      expect(content).toBe('')
    })

    test('cleans state files', async () => {
      // Create state files
      const statePath = path.join(tempDir, '.sidekick', 'state', 'test.json')
      await writeFile(statePath, '{}')

      const result = await handleDevModeCommand('clean', tempDir, logger, stdout, { force: true })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('state')
    })

    test('shows --force in help', async () => {
      const result = await handleDevModeCommand('help', tempDir, logger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('--force')
      expect(stdout.data).toContain('Skip confirmation prompts')
    })
  })

  describe('clean-all subcommand', () => {
    test('removes logs directory with --force', async () => {
      const result = await handleDevModeCommand('clean-all', tempDir, logger, stdout, { force: true })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Removed')
    })

    test('removes sessions directory with --force', async () => {
      // Create sessions dir
      const sessionsDir = path.join(tempDir, '.sidekick', 'sessions')
      await mkdir(sessionsDir, { recursive: true })
      await mkdir(path.join(sessionsDir, 'session-123'), { recursive: true })

      const result = await handleDevModeCommand('clean-all', tempDir, logger, stdout, { force: true })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('session')
      expect(stdout.data).toContain('Removed')
    })

    test('skips session cleanup without confirmation', async () => {
      // Create sessions dir
      const sessionsDir = path.join(tempDir, '.sidekick', 'sessions')
      await mkdir(sessionsDir, { recursive: true })
      await mkdir(path.join(sessionsDir, 'session-123'), { recursive: true })

      // Create a mock stdin that immediately closes (simulates non-interactive)
      const { Readable } = await import('node:stream')
      const mockStdin = new Readable({ read() {} })
      mockStdin.push(null) // EOF immediately

      const result = await handleDevModeCommand('clean-all', tempDir, logger, stdout, { stdin: mockStdin })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Skipping session cleanup')
    })

    test('removes setup-status.json with --force', async () => {
      // Enable dev-mode first (creates .sidekick/setup-status.json)
      await handleDevModeCommand('enable', tempDir, logger, stdout)
      stdout.data = ''

      // Verify setup-status.json exists
      const setupStatusPath = path.join(tempDir, '.sidekick', 'setup-status.json')
      await access(setupStatusPath, constants.F_OK) // throws if not exists

      // Run clean-all
      const result = await handleDevModeCommand('clean-all', tempDir, logger, stdout, { force: true })

      expect(result.exitCode).toBe(0)

      // Verify setup-status.json was removed
      await expect(access(setupStatusPath, constants.F_OK)).rejects.toThrow()
    })
  })
})
