/**
 * Tests for setup command handler.
 *
 * Verifies BEHAVIOR of handleSetupCommand in doctor mode:
 * - Reports "not-setup" when no status files exist
 * - Returns exit code 1 when not healthy
 * - Returns exit code 0 when healthy
 *
 * Note: Testing the interactive wizard is complex due to stdin/stdout mocking.
 * Focus on the simpler doctor mode for now.
 *
 * @see setup/index.ts handleSetupCommand
 */
import { Writable } from 'node:stream'
import { mkdir, writeFile, rm } from 'node:fs/promises'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { describe, expect, test, beforeEach, afterEach, vi } from 'vitest'
import { handleSetupCommand } from '../setup'
import type { Logger } from '@sidekick/types'

// Mock child_process.spawn to intercept claude CLI calls
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>()
  return {
    ...actual,
    spawn: vi.fn((cmd: string, args?: string[], options?: { env?: Record<string, string> }) => {
      const proc = new EventEmitter() as EventEmitter & {
        stdout: EventEmitter
        stderr: EventEmitter
        pid: number
        kill: () => void
      }
      proc.stdout = new EventEmitter()
      proc.stderr = new EventEmitter()
      proc.pid = 12345
      proc.kill = () => {}

      // Mock claude plugin list --json
      if (cmd === 'claude' && args?.includes('plugin') && args?.includes('list')) {
        setImmediate(() => {
          // Return sidekick as installed at user scope
          proc.stdout.emit(
            'data',
            Buffer.from(JSON.stringify([{ id: 'sidekick@marketplace', scope: 'user', enabled: true }]))
          )
          proc.emit('close', 0, null)
        })
        return proc
      }

      // Mock claude -p (plugin liveness check)
      if (cmd === 'claude' && args?.includes('-p')) {
        setImmediate(() => {
          // Echo back the safe word from env
          const safeWord = options?.env?.SIDEKICK_SAFE_WORD ?? 'unknown'
          proc.stdout.emit('data', Buffer.from(`The magic word is: ${safeWord}`))
          proc.emit('close', 0, null)
        })
        return proc
      }

      // Default: close immediately
      setImmediate(() => proc.emit('close', 0, null))
      return proc
    }),
  }
})

// CollectingWritable to capture stdout output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Create a simple test logger
const createTestLogger = (): Logger => ({
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => createTestLogger(),
  flush: async () => {},
})

describe('handleSetupCommand', () => {
  let tempDir: string
  let projectDir: string
  let homeDir: string
  let output: CollectingWritable
  let logger: Logger

  beforeEach(async () => {
    // Use /tmp/claude for sandbox compatibility
    tempDir = `/tmp/claude/setup-cmd-test-${Date.now()}`
    projectDir = path.join(tempDir, 'project')
    homeDir = path.join(tempDir, 'home')
    await mkdir(projectDir, { recursive: true })
    await mkdir(homeDir, { recursive: true })

    output = new CollectingWritable()
    logger = createTestLogger()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('doctor mode', () => {
    test('reports not-setup when no status files exist', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('not-setup')
      expect(output.data).toContain('Sidekick Doctor')
    })

    test('returns exit code 1 when statusline configured but API key missing', async () => {
      // Create a user status with configured statusline but missing API key
      const sidekickDir = path.join(homeDir, '.sidekick')
      await mkdir(sidekickDir, { recursive: true })
      const statusPath = path.join(sidekickDir, 'setup-status.json')
      const userStatus = {
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        preferences: {
          autoConfigureProjects: true,
          defaultStatuslineScope: 'user',
          defaultApiKeyScope: 'user',
        },
        statusline: 'configured',
        apiKeys: {
          OPENROUTER_API_KEY: 'missing',
          OPENAI_API_KEY: 'not-required',
        },
      }
      await writeFile(statusPath, JSON.stringify(userStatus, null, 2))

      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('needs attention')
    })

    test('returns exit code 1 when API key invalid', async () => {
      // Create a user status with invalid API key
      const sidekickDir = path.join(homeDir, '.sidekick')
      await mkdir(sidekickDir, { recursive: true })
      const statusPath = path.join(sidekickDir, 'setup-status.json')
      const userStatus = {
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        preferences: {
          autoConfigureProjects: true,
          defaultStatuslineScope: 'user',
          defaultApiKeyScope: 'user',
        },
        statusline: 'configured',
        apiKeys: {
          OPENROUTER_API_KEY: 'invalid',
          OPENAI_API_KEY: 'not-required',
        },
      }
      await writeFile(statusPath, JSON.stringify(userStatus, null, 2))

      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('needs attention')
    })

    test('returns exit code 0 when healthy with healthy API key', async () => {
      // Create actual Claude settings with sidekick statusline AND hooks (doctor checks both)
      const claudeDir = path.join(homeDir, '.claude')
      await mkdir(claudeDir, { recursive: true })
      const settingsPath = path.join(claudeDir, 'settings.json')
      await writeFile(
        settingsPath,
        JSON.stringify(
          {
            statusLine: { command: 'npx @scotthamilton77/sidekick statusline' },
            hooks: {
              SessionStart: [
                { hooks: [{ type: 'command', command: 'npx @scotthamilton77/sidekick hook session-start' }] },
              ],
            },
          },
          null,
          2
        )
      )

      // Create .env file with API key (doctor checks for actual key)
      const sidekickDir = path.join(homeDir, '.sidekick')
      await mkdir(sidekickDir, { recursive: true })
      const envPath = path.join(sidekickDir, '.env')
      await writeFile(envPath, 'OPENROUTER_API_KEY=sk-or-test-key\n')

      // Create user status cache
      const statusPath = path.join(sidekickDir, 'setup-status.json')
      const userStatus = {
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
      }
      await writeFile(statusPath, JSON.stringify(userStatus, null, 2))

      // Create gitignore with complete sidekick section (required for healthy status)
      const gitignorePath = path.join(projectDir, '.gitignore')
      const completeGitignore = [
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
      await writeFile(gitignorePath, completeGitignore + '\n')

      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(0)
      expect(output.data).toContain('healthy')
    })

    test('returns exit code 0 when healthy with not-required API key', async () => {
      // Create actual Claude settings with sidekick statusline AND hooks (doctor checks both)
      const claudeDir = path.join(homeDir, '.claude')
      await mkdir(claudeDir, { recursive: true })
      const settingsPath = path.join(claudeDir, 'settings.json')
      await writeFile(
        settingsPath,
        JSON.stringify(
          {
            statusLine: { command: 'npx @scotthamilton77/sidekick statusline' },
            hooks: {
              SessionStart: [
                { hooks: [{ type: 'command', command: 'npx @scotthamilton77/sidekick hook session-start' }] },
              ],
            },
          },
          null,
          2
        )
      )

      // Create user status cache with not-required API key
      const sidekickDir = path.join(homeDir, '.sidekick')
      await mkdir(sidekickDir, { recursive: true })
      const statusPath = path.join(sidekickDir, 'setup-status.json')
      const userStatus = {
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        preferences: {
          autoConfigureProjects: true,
          defaultStatuslineScope: 'user',
          defaultApiKeyScope: 'skip',
        },
        statusline: 'configured',
        apiKeys: {
          OPENROUTER_API_KEY: 'not-required',
          OPENAI_API_KEY: 'not-required',
        },
      }
      await writeFile(statusPath, JSON.stringify(userStatus, null, 2))

      // Create gitignore with complete sidekick section (required for healthy status)
      const gitignorePath = path.join(projectDir, '.gitignore')
      const completeGitignore = [
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
      await writeFile(gitignorePath, completeGitignore + '\n')

      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(0)
      expect(output.data).toContain('healthy')
    })

    test('displays statusline health status', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('Statusline:')
    })

    test('displays API key health status', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('OpenRouter API Key:')
    })

    test('displays overall health status', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('Overall:')
    })

    test('displays gitignore health status', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('Gitignore:')
    })

    test('suggests running setup when not healthy', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('sidekick setup')
    })

    test('respects project-level status over user-level', async () => {
      // Create user-level status (missing key)
      const userSidekickDir = path.join(homeDir, '.sidekick')
      await mkdir(userSidekickDir, { recursive: true })
      const userStatusPath = path.join(userSidekickDir, 'setup-status.json')
      const userStatus = {
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        preferences: {
          autoConfigureProjects: true,
          defaultStatuslineScope: 'user',
          defaultApiKeyScope: 'user',
        },
        statusline: 'configured',
        apiKeys: {
          OPENROUTER_API_KEY: 'missing',
          OPENAI_API_KEY: 'not-required',
        },
      }
      await writeFile(userStatusPath, JSON.stringify(userStatus, null, 2))

      // Create project-level status (healthy, references user key)
      const projectSidekickDir = path.join(projectDir, '.sidekick')
      await mkdir(projectSidekickDir, { recursive: true })
      const projectStatusPath = path.join(projectSidekickDir, 'setup-status.json')
      const projectStatus = {
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        autoConfigured: false,
        statusline: 'configured',
        apiKeys: {
          OPENROUTER_API_KEY: 'user',
          OPENAI_API_KEY: 'not-required',
        },
      }
      await writeFile(projectStatusPath, JSON.stringify(projectStatus, null, 2))

      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      // Project says statusline is configured, but API key is 'user' (referencing user-level),
      // which is 'missing' - so overall should be unhealthy
      expect(result.exitCode).toBe(1)
      expect(output.data).toContain('needs attention')
    })
  })
})
