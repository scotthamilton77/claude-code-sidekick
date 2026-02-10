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
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises'
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
    test('reports none when no status files exist', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, { checkOnly: true, homeDir })

      expect(result.exitCode).toBe(1)
      // With new schema, 'none' means "not configured anywhere"
      expect(output.data).toContain('Statusline: none')
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
        statusline: 'user',
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
        statusline: 'user',
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
        statusline: 'user',
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
        statusline: 'user', // New schema: where configured, not boolean-ish
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
  })

  describe('scripted mode - dev-mode statusline protection', () => {
    test('skips statusline when dev-mode is active at project scope', async () => {
      // Pre-populate project settings with dev-sidekick statusline
      const claudeDir = path.join(projectDir, '.claude')
      await mkdir(claudeDir, { recursive: true })
      const settingsPath = path.join(claudeDir, 'settings.local.json')
      const devModeSettings = {
        statusLine: {
          type: 'command',
          command: '/path/to/dev-sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
      }
      await writeFile(settingsPath, JSON.stringify(devModeSettings, null, 2) + '\n')

      const result = await handleSetupCommand(projectDir, logger, output, {
        statuslineScope: 'project',
        homeDir,
      })

      expect(result.exitCode).toBe(0)
      // Should warn about dev-mode
      expect(output.data).toContain('dev-mode')
      expect(output.data).toContain('skipped')

      // File should remain unchanged
      const afterContent = await readFile(settingsPath, 'utf-8')
      const afterSettings = JSON.parse(afterContent)
      expect(afterSettings.statusLine.command).toContain('dev-sidekick')
    })

    test('writes statusline when dev-mode is NOT active at project scope', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, {
        statuslineScope: 'project',
        homeDir,
      })

      expect(result.exitCode).toBe(0)
      expect(output.data).toContain('Statusline configured')

      // Should have written the npx command
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json')
      const content = await readFile(settingsPath, 'utf-8')
      const settings = JSON.parse(content)
      expect(settings.statusLine.command).toContain('npx @scotthamilton77/sidekick')
    })

    test('preserves devMode flag in project setup-status.json during force mode', async () => {
      // Pre-populate project setup-status.json with devMode: true
      const projectSidekickDir = path.join(projectDir, '.sidekick')
      await mkdir(projectSidekickDir, { recursive: true })
      const statusPath = path.join(projectSidekickDir, 'setup-status.json')
      const existingStatus = {
        version: 1,
        lastUpdatedAt: new Date().toISOString(),
        autoConfigured: false,
        statusline: 'user',
        apiKeys: {
          OPENROUTER_API_KEY: 'missing',
          OPENAI_API_KEY: 'not-required',
        },
        gitignore: 'unknown',
        devMode: true,
      }
      await writeFile(statusPath, JSON.stringify(existingStatus, null, 2) + '\n')

      // --force runs through runWizard() which calls writeStatusFiles()
      const result = await handleSetupCommand(projectDir, logger, output, {
        force: true,
        homeDir,
      })

      expect(result.exitCode).toBe(0)

      // Project setup-status.json should still have devMode: true
      const afterContent = await readFile(statusPath, 'utf-8')
      const afterStatus = JSON.parse(afterContent)
      expect(afterStatus.devMode).toBe(true)
    })

    test('writes statusline to user scope even when dev-mode is active at project scope', async () => {
      // Set up dev-mode statusline at project scope
      const projectClaudeDir = path.join(projectDir, '.claude')
      await mkdir(projectClaudeDir, { recursive: true })
      const projectSettingsPath = path.join(projectClaudeDir, 'settings.local.json')
      const devModeSettings = {
        statusLine: {
          type: 'command',
          command: '/path/to/dev-sidekick statusline --project-dir=$CLAUDE_PROJECT_DIR',
        },
      }
      await writeFile(projectSettingsPath, JSON.stringify(devModeSettings, null, 2) + '\n')

      // Request user-scope statusline — should succeed (different file)
      const result = await handleSetupCommand(projectDir, logger, output, {
        statuslineScope: 'user',
        homeDir,
      })

      expect(result.exitCode).toBe(0)
      expect(output.data).toContain('Statusline configured')

      // User-level settings should have the npx command
      const userSettingsPath = path.join(homeDir, '.claude', 'settings.json')
      const content = await readFile(userSettingsPath, 'utf-8')
      const settings = JSON.parse(content)
      expect(settings.statusLine.command).toContain('npx @scotthamilton77/sidekick')

      // Project-level dev-mode statusline should remain unchanged
      const projectContent = await readFile(projectSettingsPath, 'utf-8')
      const projectSettings = JSON.parse(projectContent)
      expect(projectSettings.statusLine.command).toContain('dev-sidekick')
    })
  })

  describe('scripted mode - project status file', () => {
    test('writes setup-status.json when using CLI flags', async () => {
      const result = await handleSetupCommand(projectDir, logger, output, {
        statuslineScope: 'project',
        personas: true,
        homeDir,
      })

      expect(result.exitCode).toBe(0)
      // setup-status.json should exist
      const statusPath = path.join(projectDir, '.sidekick', 'setup-status.json')
      const content = await readFile(statusPath, 'utf-8')
      const status = JSON.parse(content)
      expect(status.version).toBe(1)
      expect(status.statusline).toBe('project')
    })

    test('preserves devMode when writing setup-status.json in scripted mode', async () => {
      // Pre-populate with a valid project status including devMode: true
      const sidekickDir = path.join(projectDir, '.sidekick')
      await mkdir(sidekickDir, { recursive: true })
      await writeFile(
        path.join(sidekickDir, 'setup-status.json'),
        JSON.stringify({
          version: 1,
          lastUpdatedAt: new Date().toISOString(),
          autoConfigured: false,
          statusline: 'user',
          apiKeys: { OPENROUTER_API_KEY: 'not-required', OPENAI_API_KEY: 'not-required' },
          gitignore: 'installed',
          devMode: true,
        })
      )

      const result = await handleSetupCommand(projectDir, logger, output, {
        statuslineScope: 'project',
        homeDir,
      })

      expect(result.exitCode).toBe(0)
      const content = await readFile(path.join(sidekickDir, 'setup-status.json'), 'utf-8')
      const status = JSON.parse(content)
      expect(status.devMode).toBe(true)
      expect(status.statusline).toBe('project')
    })
  })

  describe('doctor mode', () => {
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
        statusline: 'user',
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
        statusline: 'user',
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
