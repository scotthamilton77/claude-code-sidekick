import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import * as childProcess from 'node:child_process'
import { EventEmitter } from 'node:events'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as os from 'node:os'

// Mock child_process spawn for plugin detection tests
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn(),
  }
})

/**
 * Create a mock ChildProcess for spawn tests.
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

import {
  detectActualStatusline,
  detectPluginInstallation,
  detectPluginLiveness,
  spawnWithTimeout,
} from '../plugin-detector.js'

describe('plugin-detector', () => {
  let tempDir: string
  let projectDir: string
  let homeDir: string

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-detector-test-'))
    projectDir = path.join(tempDir, 'project')
    homeDir = path.join(tempDir, 'home')
    await fs.mkdir(projectDir, { recursive: true })
    await fs.mkdir(homeDir, { recursive: true })
  })

  afterEach(async () => {
    vi.resetAllMocks()
    await fs.rm(tempDir, { recursive: true, force: true })
  })

  const writeClaudeSettings = async (scope: 'user' | 'project', settings: Record<string, unknown>): Promise<void> => {
    const settingsPath =
      scope === 'user'
        ? path.join(homeDir, '.claude', 'settings.json')
        : path.join(projectDir, '.claude', 'settings.local.json')
    await fs.mkdir(path.dirname(settingsPath), { recursive: true })
    await fs.writeFile(settingsPath, JSON.stringify(settings, null, 2))
  }

  describe('detectActualStatusline', () => {
    it('returns "none" when no settings files exist', async () => {
      const result = await detectActualStatusline(projectDir, homeDir)
      expect(result).toBe('none')
    })

    it('returns "user" when user settings has sidekick statusline', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'npx @scotthamilton77/sidekick statusline' },
      })
      const result = await detectActualStatusline(projectDir, homeDir)
      expect(result).toBe('user')
    })

    it('returns "project" when project settings has sidekick statusline', async () => {
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'npx @scotthamilton77/sidekick statusline' },
      })
      const result = await detectActualStatusline(projectDir, homeDir)
      expect(result).toBe('project')
    })

    it('returns "both" when both settings have sidekick statusline', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: 'sidekick statusline' },
      })
      const result = await detectActualStatusline(projectDir, homeDir)
      expect(result).toBe('both')
    })

    it('returns "none" when statusLine exists but is not sidekick', async () => {
      await writeClaudeSettings('user', {
        statusLine: { type: 'command', command: 'some-other-tool statusline' },
      })
      const result = await detectActualStatusline(projectDir, homeDir)
      expect(result).toBe('none')
    })

    it('returns "none" when settings exist but no statusLine key', async () => {
      await writeClaudeSettings('user', { someOtherKey: 'value' })
      const result = await detectActualStatusline(projectDir, homeDir)
      expect(result).toBe('none')
    })
  })

  describe('detectPluginInstallation', () => {
    const mockSpawn = vi.mocked(childProcess.spawn)

    const mockPluginList = (plugins: Array<{ id: string; scope: string; enabled: boolean }>): void => {
      mockSpawn.mockImplementation((cmd, args) => {
        if (cmd === 'claude' && args?.includes('plugin') && args?.includes('list') && args?.includes('--json')) {
          const proc = createMockChildProcess()
          setImmediate(() => {
            proc.stdout.emit('data', Buffer.from(JSON.stringify(plugins)))
            proc.emit('close', 0, null)
          })
          return proc as unknown as childProcess.ChildProcess
        }
        const proc = createMockChildProcess()
        setImmediate(() => proc.emit('close', 0, null))
        return proc as unknown as childProcess.ChildProcess
      })
    }

    it('returns "none" when no sidekick plugin and no dev-mode hooks', async () => {
      mockPluginList([{ id: 'beads@beads-marketplace', scope: 'user', enabled: true }])
      const result = await detectPluginInstallation(projectDir, homeDir)
      expect(result).toBe('none')
    })

    it('returns "plugin" when sidekick plugin is in claude plugin list', async () => {
      mockPluginList([{ id: 'sidekick@some-marketplace', scope: 'user', enabled: true }])
      const result = await detectPluginInstallation(projectDir, homeDir)
      expect(result).toBe('plugin')
    })

    it('returns "dev-mode" when hooks contain dev-sidekick path', async () => {
      mockPluginList([])
      await writeClaudeSettings('project', {
        hooks: {
          SessionStart: [
            { hooks: [{ type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/session-start' }] },
          ],
        },
      })
      const result = await detectPluginInstallation(projectDir, homeDir)
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
      const result = await detectPluginInstallation(projectDir, homeDir)
      expect(result).toBe('both')
    })

    it('detects dev-mode from statusLine command', async () => {
      mockPluginList([])
      await writeClaudeSettings('project', {
        statusLine: { type: 'command', command: '$CLAUDE_PROJECT_DIR/scripts/dev-sidekick/statusline' },
      })
      const result = await detectPluginInstallation(projectDir, homeDir)
      expect(result).toBe('dev-mode')
    })

    it('handles CLI error gracefully', async () => {
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
      const result = await detectPluginInstallation(projectDir, homeDir)
      expect(result).toBe('error')
    })

    it('handles invalid JSON from CLI gracefully', async () => {
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
      const result = await detectPluginInstallation(projectDir, homeDir)
      expect(result).toBe('error')
    })

    it('returns "none" when hooks exist but are not sidekick-related', async () => {
      mockPluginList([])
      await writeClaudeSettings('user', {
        hooks: {
          SessionStart: [{ hooks: [{ type: 'command', command: 'some-other-tool hook start' }] }],
        },
      })
      const result = await detectPluginInstallation(projectDir, homeDir)
      expect(result).toBe('none')
    })

    it('handles malformed settings gracefully', async () => {
      mockPluginList([])
      const settingsPath = path.join(homeDir, '.claude', 'settings.json')
      await fs.mkdir(path.dirname(settingsPath), { recursive: true })
      await fs.writeFile(settingsPath, '{invalid json}')
      const result = await detectPluginInstallation(projectDir, homeDir)
      expect(result).toBe('none')
    })
  })

  describe('detectPluginLiveness', () => {
    const mockSpawn = vi.mocked(childProcess.spawn)

    it('returns "active" when Claude responds with the safe word', async () => {
      mockSpawn.mockImplementation((_cmd, _args, options) => {
        const proc = createMockChildProcess()
        const safeWord = (options?.env as Record<string, string>)?.SIDEKICK_LIVENESS_CHECK ?? 'nope'
        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from(`The magic word is: ${safeWord}`))
          proc.emit('close', 0, null)
        })
        return proc as unknown as childProcess.ChildProcess
      })
      const result = await detectPluginLiveness(projectDir)
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
      const result = await detectPluginLiveness(projectDir)
      expect(result).toBe('inactive')
    })

    it('returns "error" when Claude command fails', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()
        setImmediate(() => {
          proc.stderr.emit('data', Buffer.from('Command failed'))
          proc.emit('close', 1, null)
        })
        return proc as unknown as childProcess.ChildProcess
      })
      const result = await detectPluginLiveness(projectDir)
      expect(result).toBe('error')
    })

    it('returns "error" when spawn fails', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()
        setImmediate(() => {
          proc.emit('error', new Error('Command not found'))
        })
        return proc as unknown as childProcess.ChildProcess
      })
      const result = await detectPluginLiveness(projectDir)
      expect(result).toBe('error')
    })
  })

  describe('spawnWithTimeout', () => {
    const mockSpawn = vi.mocked(childProcess.spawn)

    it('resolves with stdout on success', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()
        setImmediate(() => {
          proc.stdout.emit('data', Buffer.from('hello'))
          proc.emit('close', 0, null)
        })
        return proc as unknown as childProcess.ChildProcess
      })
      const result = await spawnWithTimeout('echo', ['hello'], {})
      expect(result.stdout).toBe('hello')
      expect(result.timedOut).toBe(false)
      expect(result.exitCode).toBe(0)
    })

    it('reports timeout when process exceeds timeoutMs', async () => {
      vi.useFakeTimers()
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()
        proc.kill.mockImplementation((signal: string) => {
          setImmediate(() => proc.emit('close', null, signal))
          return true
        })
        return proc as unknown as childProcess.ChildProcess
      })

      const resultPromise = spawnWithTimeout('slow-cmd', [], { timeoutMs: 100 })
      await vi.advanceTimersByTimeAsync(200)
      const result = await resultPromise
      expect(result.timedOut).toBe(true)
      vi.useRealTimers()
    })

    it('captures stderr', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()
        setImmediate(() => {
          proc.stderr.emit('data', Buffer.from('error output'))
          proc.emit('close', 1, null)
        })
        return proc as unknown as childProcess.ChildProcess
      })
      const result = await spawnWithTimeout('failing-cmd', [], {})
      expect(result.stderr).toBe('error output')
      expect(result.exitCode).toBe(1)
    })

    it('handles spawn error', async () => {
      mockSpawn.mockImplementation(() => {
        const proc = createMockChildProcess()
        setImmediate(() => {
          proc.emit('error', new Error('ENOENT'))
        })
        return proc as unknown as childProcess.ChildProcess
      })
      const result = await spawnWithTimeout('nonexistent', [], {})
      expect(result.exitCode).toBe(-1)
    })
  })
})
