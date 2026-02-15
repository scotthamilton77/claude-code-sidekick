/**
 * Tests for uninstall command handler.
 *
 * Verifies BEHAVIOR of handleUninstallCommand:
 * - Detects and uninstalls Claude Code plugin
 * - Kills running daemons
 * - Removes sidekick entries from settings.json (surgical)
 * - Removes config files (setup-status.json, features.yaml)
 * - Prompts about .env files containing API keys
 * - Removes transient data (logs, sessions, state, sockets)
 * - Cleans gitignore section
 * - Reports summary of actions taken
 *
 * @see uninstall.ts handleUninstallCommand
 */
import { Writable, Readable } from 'node:stream'
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import type { Logger } from '@sidekick/types'

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

// Create a stdin that auto-responds with a given answer
function createAutoStdin(answer: string): Readable {
  const readable = new Readable({
    read() {
      this.push(answer + '\n')
      this.push(null)
    },
  })
  return readable
}

// Hoisted mocks (must be declared before vi.mock factories)
const { mockDaemonKill, mockExecFile } = vi.hoisted(() => ({
  mockDaemonKill: vi.fn().mockResolvedValue({ killed: false }),
  mockExecFile: vi.fn(),
}))

// Mock @sidekick/core
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    Logger: vi.fn(),
    DaemonClient: vi.fn().mockImplementation(function () {
      return { kill: mockDaemonKill }
    }),
    killAllDaemons: vi.fn().mockResolvedValue([]),
    getSocketPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.sock')),
    getTokenPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.token')),
    getLockPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.lock')),
    getPidPath: vi.fn((dir: string) => path.join(dir, '.sidekick', 'sidekickd.pid')),
    getUserDaemonsDir: vi.fn(() => '/tmp/claude/nonexistent-daemons-dir'),
  }
})

// Mock child_process.execFile for 'claude plugin' CLI calls
vi.mock('node:child_process', () => ({
  execFile: mockExecFile,
}))

import { handleUninstallCommand } from '../uninstall.js'

describe('handleUninstallCommand', () => {
  let stdout: CollectingWritable
  let logger: Logger
  let tempDir: string
  let userHome: string

  beforeEach(async () => {
    stdout = new CollectingWritable()
    logger = createFakeLogger()
    tempDir = `/tmp/claude/uninstall-test-${Date.now()}`
    userHome = `/tmp/claude/uninstall-home-${Date.now()}`
    await mkdir(path.join(tempDir, '.claude'), { recursive: true })
    await mkdir(path.join(tempDir, '.sidekick'), { recursive: true })
    await mkdir(path.join(userHome, '.claude'), { recursive: true })
    await mkdir(path.join(userHome, '.sidekick'), { recursive: true })

    mockDaemonKill.mockClear()
    mockExecFile.mockClear()
    // Default: no plugin installed
    mockExecFile.mockImplementation(
      (_cmd: string, _args: string[], callback: (err: Error | null, stdout: string, stderr: string) => void) => {
        callback(null, '[]', '')
      }
    )
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
    await rm(userHome, { recursive: true, force: true })
  })

  describe('scope detection', () => {
    test('detects project scope when .sidekick/setup-status.json exists', async () => {
      await writeFile(
        path.join(tempDir, '.sidekick', 'setup-status.json'),
        JSON.stringify({ version: 1, autoConfigured: true })
      )

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('project')
    })

    test('detects project scope via sidekick content in .claude/settings.json (project-level)', async () => {
      // No setup-status.json — detection must fall through to settings files
      const settings = {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
      }
      await writeFile(path.join(tempDir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      // Should detect project scope and report removal
      expect(stdout.data).toContain('project')
      expect(stdout.data).not.toContain('No sidekick installation detected')
    })

    test('detects user scope when ~/.sidekick/setup-status.json exists', async () => {
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('user')
    })

    test('reports nothing to uninstall when no sidekick artifacts found', async () => {
      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('No sidekick installation detected')
    })

    test('respects --scope=project to limit uninstall', async () => {
      // Install artifacts in both scopes
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      // Project setup-status should be gone
      await expect(readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')).rejects.toThrow()
      // User setup-status should still exist
      const userStatus = await readFile(path.join(userHome, '.sidekick', 'setup-status.json'), 'utf-8')
      expect(userStatus).toBeTruthy()
    })
  })

  describe('plugin uninstall', () => {
    test('detects and uninstalls sidekick plugin via claude CLI', async () => {
      // Mock: plugin list returns sidekick
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], callback: (err: Error | null, stdout: string, stderr: string) => void) => {
          if (args.includes('list')) {
            callback(
              null,
              JSON.stringify([{ id: 'sidekick@claude-code-sidekick', version: '0.0.8', scope: 'user', enabled: true }]),
              ''
            )
          } else if (args.includes('uninstall')) {
            callback(null, '', '')
          } else {
            callback(null, '[]', '')
          }
        }
      )

      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      // Verify uninstall was called with correct args
      const uninstallCall = mockExecFile.mock.calls.find((call: any[]) => call[1]?.includes('uninstall'))
      expect(uninstallCall).toBeTruthy()
      expect(uninstallCall![1]).toContain('sidekick')
      expect(stdout.data).toContain('Plugin')
    })

    test('handles missing claude CLI gracefully', async () => {
      mockExecFile.mockImplementation(
        (_cmd: string, _args: string[], callback: (err: Error | null, stdout: string, stderr: string) => void) => {
          callback(new Error('ENOENT: claude not found'), '', '')
        }
      )

      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      // Should still succeed — just skip plugin uninstall
      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('setup-status.json')
    })
  })

  describe('settings.json surgery', () => {
    test('removes sidekick statusline from user settings.json', async () => {
      const settings = {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
        someOtherSetting: true,
      }
      await writeFile(path.join(userHome, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = JSON.parse(await readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8'))
      expect(updated.statusLine).toBeUndefined()
      expect(updated.someOtherSetting).toBe(true)
    })

    test('preserves non-sidekick statusline', async () => {
      const settings = {
        statusLine: {
          type: 'command',
          command: 'some-other-tool statusline',
        },
      }
      await writeFile(path.join(userHome, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = JSON.parse(await readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8'))
      expect(updated.statusLine.command).toBe('some-other-tool statusline')
    })

    test('removes sidekick statusline from project-level .claude/settings.json', async () => {
      const settings = {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
        someOtherSetting: true,
      }
      await writeFile(path.join(tempDir, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = JSON.parse(await readFile(path.join(tempDir, '.claude', 'settings.json'), 'utf-8'))
      expect(updated.statusLine).toBeUndefined()
      expect(updated.someOtherSetting).toBe(true)
    })

    test('removes sidekick hooks from settings.local.json', async () => {
      const settings = {
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: '/path/dev-sidekick/session-start' }] }],
          PostToolUse: [
            { matcher: '*', hooks: [{ type: 'command', command: '/path/dev-sidekick/post-tool-use' }] },
            { matcher: 'Write', hooks: [{ type: 'command', command: 'some-other-hook' }] },
          ],
        },
        statusLine: {
          type: 'command',
          command: '/path/dev-sidekick/statusline',
        },
        someOtherKey: 'keep-me',
      }
      await writeFile(path.join(tempDir, '.claude', 'settings.local.json'), JSON.stringify(settings, null, 2))
      await writeFile(
        path.join(tempDir, '.sidekick', 'setup-status.json'),
        JSON.stringify({ version: 1, devMode: true })
      )

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = JSON.parse(await readFile(path.join(tempDir, '.claude', 'settings.local.json'), 'utf-8'))
      // Sidekick hooks removed, non-sidekick hook preserved
      expect(updated.hooks.SessionStart).toBeUndefined()
      expect(updated.hooks.PostToolUse).toHaveLength(1)
      expect(updated.hooks.PostToolUse[0].hooks[0].command).toBe('some-other-hook')
      // Sidekick statusline removed
      expect(updated.statusLine).toBeUndefined()
      // Other keys preserved
      expect(updated.someOtherKey).toBe('keep-me')
    })

    test('prunes empty object values left after removing sidekick entries', async () => {
      // enabledPlugins becomes {} after sidekick removal — should be pruned
      const settings = {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
        enabledPlugins: { sidekick: true },
        someOtherSetting: true,
      }
      await writeFile(path.join(userHome, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      // Simulate plugin uninstall removing the sidekick key from enabledPlugins externally.
      // cleanSettingsFile only handles statusLine and hooks, so we test that leftover
      // empty objects from ANY source get pruned after sidekick removal.
      // To isolate the pruning behavior, manually remove the plugin key before uninstall
      // so cleanSettingsFile sees { enabledPlugins: {}, someOtherSetting: true } after statusLine removal.
      const preClean = JSON.parse(await readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8'))
      delete preClean.enabledPlugins.sidekick
      await writeFile(path.join(userHome, '.claude', 'settings.json'), JSON.stringify(preClean, null, 2))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = JSON.parse(await readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8'))
      expect(updated.enabledPlugins).toBeUndefined() // empty {} should be pruned
      expect(updated.someOtherSetting).toBe(true)
    })

    test('deletes settings file when only empty objects remain after surgery', async () => {
      // After removing sidekick statusLine, only empty objects remain — file should be deleted
      const settings = {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
        enabledPlugins: {},
        emptySection: {},
      }
      await writeFile(path.join(userHome, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      // File should be deleted — only empty objects remained after statusLine removal
      await expect(readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8')).rejects.toThrow()
    })

    test('prunes nested empty objects recursively', async () => {
      const settings = {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
        outer: { inner: {} },
        someOtherSetting: 'keep',
      }
      await writeFile(path.join(userHome, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = JSON.parse(await readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8'))
      expect(updated.outer).toBeUndefined() // { inner: {} } → {} → pruned
      expect(updated.someOtherSetting).toBe('keep')
    })

    test('does not prune empty arrays or non-object values', async () => {
      const settings = {
        statusLine: {
          type: 'command',
          command: 'npx @scotthamilton77/sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
        emptyArray: [],
        emptyString: '',
        zero: 0,
        nullVal: null,
      }
      await writeFile(path.join(userHome, '.claude', 'settings.json'), JSON.stringify(settings, null, 2))
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = JSON.parse(await readFile(path.join(userHome, '.claude', 'settings.json'), 'utf-8'))
      // These should NOT be pruned — only empty plain objects {}
      expect(updated.emptyArray).toEqual([])
      expect(updated.emptyString).toBe('')
      expect(updated.zero).toBe(0)
      expect(updated.nullVal).toBeNull()
    })

    test('deletes settings.local.json if empty after surgery', async () => {
      const settings = {
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: '/path/dev-sidekick/session-start' }] }],
        },
        statusLine: {
          type: 'command',
          command: '/path/dev-sidekick/statusline',
        },
      }
      await writeFile(path.join(tempDir, '.claude', 'settings.local.json'), JSON.stringify(settings, null, 2))
      await writeFile(
        path.join(tempDir, '.sidekick', 'setup-status.json'),
        JSON.stringify({ version: 1, devMode: true })
      )

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      // File should be deleted since it would be empty
      await expect(readFile(path.join(tempDir, '.claude', 'settings.local.json'), 'utf-8')).rejects.toThrow()
    })
  })

  describe('config file removal', () => {
    test('removes setup-status.json from project scope', async () => {
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      await expect(readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')).rejects.toThrow()
    })

    test('removes features.yaml from user scope', async () => {
      await writeFile(path.join(userHome, '.sidekick', 'features.yaml'), 'personas:\n  enabled: true\n')
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      await expect(readFile(path.join(userHome, '.sidekick', 'features.yaml'), 'utf-8')).rejects.toThrow()
    })
  })

  describe('.env handling', () => {
    test('removes .env when --force is set', async () => {
      await writeFile(path.join(tempDir, '.sidekick', '.env'), 'OPENROUTER_API_KEY=sk-or-test-1234')
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      await expect(readFile(path.join(tempDir, '.sidekick', '.env'), 'utf-8')).rejects.toThrow()
    })

    test('keeps .env when user declines interactive prompt', async () => {
      await writeFile(path.join(tempDir, '.sidekick', '.env'), 'OPENROUTER_API_KEY=sk-or-test-1234')
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        scope: 'project',
        stdin: createAutoStdin('n'),
        userHome,
      })

      expect(result.exitCode).toBe(0)
      // .env should still exist
      const envContent = await readFile(path.join(tempDir, '.sidekick', '.env'), 'utf-8')
      expect(envContent).toContain('OPENROUTER_API_KEY')
    })
  })

  describe('transient data removal', () => {
    test('removes logs, sessions, and state directories', async () => {
      await mkdir(path.join(tempDir, '.sidekick', 'logs'), { recursive: true })
      await mkdir(path.join(tempDir, '.sidekick', 'sessions'), { recursive: true })
      await mkdir(path.join(tempDir, '.sidekick', 'state'), { recursive: true })
      await writeFile(path.join(tempDir, '.sidekick', 'logs', 'sidekick.log'), 'test log')
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      await expect(readFile(path.join(tempDir, '.sidekick', 'logs', 'sidekick.log'), 'utf-8')).rejects.toThrow()
    })
  })

  describe('gitignore cleanup', () => {
    test('removes sidekick section from .gitignore', async () => {
      const gitignoreContent = [
        'node_modules/',
        '',
        '# >>> sidekick',
        '.sidekick/logs/',
        '.sidekick/sessions/',
        '.sidekick/state/',
        '.sidekick/setup-status.json',
        '.sidekick/.env',
        '.sidekick/.env.local',
        '.sidekick/sidekick*.pid',
        '.sidekick/sidekick*.token',
        '# <<< sidekick',
        '',
        'dist/',
      ].join('\n')
      await writeFile(path.join(tempDir, '.gitignore'), gitignoreContent)
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
      expect(updated).toContain('node_modules/')
      expect(updated).toContain('dist/')
      expect(updated).not.toContain('>>> sidekick')
      expect(updated).not.toContain('.sidekick/')
    })
  })

  describe('daemon handling', () => {
    test('kills project daemon during uninstall', async () => {
      await writeFile(path.join(tempDir, '.sidekick', 'sidekickd.pid'), '12345')
      await writeFile(path.join(tempDir, '.sidekick', 'sidekickd.token'), 'test-token')
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
      mockDaemonKill.mockResolvedValue({ killed: true })

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      expect(mockDaemonKill).toHaveBeenCalled()
      // PID and token files should be cleaned up
      await expect(readFile(path.join(tempDir, '.sidekick', 'sidekickd.pid'), 'utf-8')).rejects.toThrow()
      await expect(readFile(path.join(tempDir, '.sidekick', 'sidekickd.token'), 'utf-8')).rejects.toThrow()
    })
  })

  describe('dry-run mode', () => {
    test('reports what would be removed without acting', async () => {
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
      await writeFile(path.join(tempDir, '.sidekick', '.env'), 'OPENROUTER_API_KEY=sk-test')
      await mkdir(path.join(tempDir, '.sidekick', 'logs'), { recursive: true })

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        dryRun: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('dry-run')
      // Files should still exist
      const status = await readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')
      expect(status).toBeTruthy()
      const env = await readFile(path.join(tempDir, '.sidekick', '.env'), 'utf-8')
      expect(env).toBeTruthy()
    })

    test('does not kill daemon or uninstall plugin in dry-run mode', async () => {
      // Mock: plugin list returns sidekick
      mockExecFile.mockImplementation(
        (cmd: string, args: string[], callback: (err: Error | null, stdout: string, stderr: string) => void) => {
          if (args.includes('list')) {
            callback(
              null,
              JSON.stringify([{ id: 'sidekick@claude-code-sidekick', version: '0.0.8', scope: 'user', enabled: true }]),
              ''
            )
          } else if (args.includes('uninstall')) {
            callback(null, '', '')
          } else {
            callback(null, '[]', '')
          }
        }
      )
      mockDaemonKill.mockResolvedValue({ killed: true })

      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
      await writeFile(path.join(tempDir, '.sidekick', 'sidekickd.pid'), '12345')

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        dryRun: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('dry-run')
      // Daemon should NOT have been killed
      expect(mockDaemonKill).not.toHaveBeenCalled()
      // Plugin uninstall should NOT have been called
      const uninstallCall = mockExecFile.mock.calls.find((call: any[]) => call[1]?.includes('uninstall'))
      expect(uninstallCall).toBeUndefined()
      // Files should still exist
      const pid = await readFile(path.join(tempDir, '.sidekick', 'sidekickd.pid'), 'utf-8')
      expect(pid).toBe('12345')
    })

    test('--dry-run flag is propagated through CLI arg parsing (regression)', async () => {
      // This test verifies that the CLI arg parser correctly threads --dry-run
      // through to the uninstall handler. Previously, parseArgs() omitted dry-run
      // from its return value, causing --dry-run to execute a real uninstall.
      const { initializeRuntime } = await import('../../cli.js')

      const { parsed } = initializeRuntime({
        argv: ['uninstall', '--dry-run', '--force'],
        enableFileLogging: false,
      })

      expect(parsed['dry-run']).toBe(true)
      expect(parsed.command).toBe('uninstall')
      expect(parsed.force).toBe(true)
    })
  })

  describe('report', () => {
    test('groups removed artifacts by scope and sorts alphabetically', async () => {
      await writeFile(path.join(tempDir, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))
      await writeFile(path.join(tempDir, '.sidekick', 'features.yaml'), 'personas:\n  enabled: true\n')

      // Trigger user scope too
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Removed')
      // Verify grouped by scope
      expect(stdout.data).toContain('  user:\n')
      expect(stdout.data).toContain('  project:\n')
      // User scope items appear before project scope items
      const userIdx = stdout.data.indexOf('  user:\n')
      const projectIdx = stdout.data.indexOf('  project:\n')
      expect(userIdx).toBeLessThan(projectIdx)
    })
  })

  describe('dev-mode guard', () => {
    /** Write a project setup-status.json with devMode: true (common fixture for guard tests). */
    async function writeDevModeStatus(): Promise<void> {
      await writeFile(
        path.join(tempDir, '.sidekick', 'setup-status.json'),
        JSON.stringify({
          version: 1,
          devMode: true,
          autoConfigured: false,
          statusline: 'local',
          apiKeys: { OPENROUTER_API_KEY: 'missing', OPENAI_API_KEY: 'missing' },
          lastUpdatedAt: new Date().toISOString(),
        })
      )
    }

    test('skips project setup-status.json deletion when dev-mode is active', async () => {
      await writeDevModeStatus()

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      // setup-status.json should still exist
      const content = await readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')
      expect(JSON.parse(content).devMode).toBe(true)
      expect(stdout.data).toContain('dev-mode')
    })

    test('skips gitignore removal when dev-mode is active', async () => {
      await writeDevModeStatus()
      const gitignoreContent = [
        'node_modules/',
        '',
        '# >>> sidekick',
        '.sidekick/logs/',
        '.sidekick/sessions/',
        '.sidekick/state/',
        '.sidekick/setup-status.json',
        '.sidekick/.env',
        '.sidekick/.env.local',
        '.sidekick/sidekick*.pid',
        '.sidekick/sidekick*.token',
        '# <<< sidekick',
      ].join('\n')
      await writeFile(path.join(tempDir, '.gitignore'), gitignoreContent)

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = await readFile(path.join(tempDir, '.gitignore'), 'utf-8')
      expect(updated).toContain('# >>> sidekick')
      expect(stdout.data).toContain('dev-mode')
    })

    test('skips settings.local.json cleanup when dev-mode is active', async () => {
      await writeDevModeStatus()
      const settings = {
        statusLine: { type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/statusline' },
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/session-start' }] },
          ],
        },
      }
      await writeFile(path.join(tempDir, '.claude', 'settings.local.json'), JSON.stringify(settings, null, 2))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      const updated = JSON.parse(await readFile(path.join(tempDir, '.claude', 'settings.local.json'), 'utf-8'))
      expect(updated.statusLine.command).toContain('dev-sidekick')
      expect(updated.hooks.SessionStart).toHaveLength(1)
    })

    test('still allows transient data removal when dev-mode is active', async () => {
      await writeDevModeStatus()
      await mkdir(path.join(tempDir, '.sidekick', 'logs'), { recursive: true })
      await writeFile(path.join(tempDir, '.sidekick', 'logs', 'test.log'), 'log data')

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      await expect(readFile(path.join(tempDir, '.sidekick', 'logs', 'test.log'), 'utf-8')).rejects.toThrow()
    })

    test('still allows user-scope cleanup when dev-mode is active at project scope', async () => {
      await writeDevModeStatus()
      await writeFile(path.join(userHome, '.sidekick', 'setup-status.json'), JSON.stringify({ version: 1 }))

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        userHome,
      })

      expect(result.exitCode).toBe(0)
      await expect(readFile(path.join(userHome, '.sidekick', 'setup-status.json'), 'utf-8')).rejects.toThrow()
      const projectStatus = await readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')
      expect(JSON.parse(projectStatus).devMode).toBe(true)
    })

    test('non-dev-mode uninstall behavior unchanged', async () => {
      await writeFile(
        path.join(tempDir, '.sidekick', 'setup-status.json'),
        JSON.stringify({ version: 1, autoConfigured: true })
      )

      const result = await handleUninstallCommand(tempDir, logger, stdout, {
        force: true,
        scope: 'project',
        userHome,
      })

      expect(result.exitCode).toBe(0)
      await expect(readFile(path.join(tempDir, '.sidekick', 'setup-status.json'), 'utf-8')).rejects.toThrow()
    })
  })
})
