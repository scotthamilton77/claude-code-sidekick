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
