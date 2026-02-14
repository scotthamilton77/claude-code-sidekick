/**
 * Tests for plugin-installer module.
 *
 * Verifies BEHAVIOR of marketplace/plugin detection and installation:
 * - Scope constraint validation (pure function)
 * - Settings JSON merging for project/local marketplace (pure function)
 * - Marketplace detection and installation flow
 * - Plugin detection and installation flow
 * - Force mode defaults
 * - Error handling (CLI not found, command failures)
 *
 * Uses dependency injection for CLI execution (no child_process mocks).
 */
import { Readable, Writable } from 'node:stream'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { describe, expect, test, beforeEach, afterEach } from 'vitest'
import type { Logger } from '@sidekick/types'
import {
  type CommandExecutor,
  getValidPluginScopes,
  isScopeValid,
  ensurePluginInstalled,
  mergeMarketplaceSettings,
  MARKETPLACE_NAME,
  MARKETPLACE_SOURCE,
  PLUGIN_NAME,
} from '../setup/plugin-installer.js'

// ============================================================================
// Test Helpers
// ============================================================================

class CollectingWritable extends Writable {
  data = ''
  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

/**
 * Create a fake stdin that provides answers in sequence.
 */
function createFakeStdin(answers: string[]): NodeJS.ReadableStream {
  const remaining = [...answers]
  return new Readable({
    read() {
      const answer = remaining.shift()
      if (answer !== undefined) {
        this.push(answer + '\n')
      }
    },
  })
}

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

interface RecordingExecutor extends CommandExecutor {
  calls: Array<{ cmd: string; args: string[] }>
}

/**
 * Fake command executor that returns canned responses and records all calls.
 */
function createFakeExecutor(responses: Map<string, { stdout: string; exitCode: number }>): RecordingExecutor {
  const calls: RecordingExecutor['calls'] = []
  return {
    calls,
    exec(cmd: string, args: string[]): Promise<{ stdout: string; exitCode: number }> {
      calls.push({ cmd, args })
      const key = `${cmd} ${args.join(' ')}`
      const response = responses.get(key)
      if (response) return Promise.resolve(response)
      for (const [pattern, resp] of responses) {
        if (key.startsWith(pattern)) return Promise.resolve(resp)
      }
      return Promise.resolve({ stdout: '', exitCode: 1 })
    },
  }
}

/**
 * Create a fake executor that simulates claude CLI not being available.
 */
function createMissingCliExecutor(): CommandExecutor {
  return {
    exec(): Promise<{ stdout: string; exitCode: number }> {
      return Promise.reject(new Error('spawn claude ENOENT'))
    },
  }
}

// ============================================================================
// Pure Function Tests
// ============================================================================

describe('getValidPluginScopes', () => {
  test('marketplace=user allows all plugin scopes', () => {
    expect(getValidPluginScopes('user')).toEqual(['user', 'project', 'local'])
  })

  test('marketplace=project allows project and local', () => {
    expect(getValidPluginScopes('project')).toEqual(['project', 'local'])
  })

  test('marketplace=local allows only local', () => {
    expect(getValidPluginScopes('local')).toEqual(['local'])
  })
})

describe('isScopeValid', () => {
  test('plugin scope at same level as marketplace is valid', () => {
    expect(isScopeValid('user', 'user')).toBe(true)
    expect(isScopeValid('project', 'project')).toBe(true)
    expect(isScopeValid('local', 'local')).toBe(true)
  })

  test('plugin scope narrower than marketplace is valid', () => {
    expect(isScopeValid('user', 'project')).toBe(true)
    expect(isScopeValid('user', 'local')).toBe(true)
    expect(isScopeValid('project', 'local')).toBe(true)
  })

  test('plugin scope broader than marketplace is invalid', () => {
    expect(isScopeValid('project', 'user')).toBe(false)
    expect(isScopeValid('local', 'user')).toBe(false)
    expect(isScopeValid('local', 'project')).toBe(false)
  })
})

describe('mergeMarketplaceSettings', () => {
  test('merges into empty settings', () => {
    const result = mergeMarketplaceSettings({})
    expect(result.extraKnownMarketplaces).toEqual([{ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE }])
    expect(result.enabledPlugins).toEqual([`${PLUGIN_NAME}@${MARKETPLACE_NAME}`])
  })

  test('preserves existing settings', () => {
    const existing = {
      statusLine: { command: 'something' },
      someOtherKey: true,
    }
    const result = mergeMarketplaceSettings(existing)
    expect(result.statusLine).toEqual({ command: 'something' })
    expect(result.someOtherKey).toBe(true)
    expect(result.extraKnownMarketplaces).toHaveLength(1)
  })

  test('does not duplicate marketplace if already present', () => {
    const existing = {
      extraKnownMarketplaces: [{ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE }],
      enabledPlugins: [`${PLUGIN_NAME}@${MARKETPLACE_NAME}`],
    }
    const result = mergeMarketplaceSettings(existing)
    expect(result.extraKnownMarketplaces).toHaveLength(1)
    expect(result.enabledPlugins).toHaveLength(1)
  })

  test('appends to existing marketplaces and plugins', () => {
    const existing = {
      extraKnownMarketplaces: [{ name: 'other-marketplace', source: 'github:other/repo' }],
      enabledPlugins: ['other-plugin@other-marketplace'],
    }
    const result = mergeMarketplaceSettings(existing)
    expect(result.extraKnownMarketplaces).toHaveLength(2)
    expect(result.enabledPlugins).toHaveLength(2)
    expect(result.enabledPlugins).toContain(`${PLUGIN_NAME}@${MARKETPLACE_NAME}`)
  })
})

// ============================================================================
// Integration Tests: ensurePluginInstalled
// ============================================================================

describe('ensurePluginInstalled', () => {
  let tempDir: string
  let projectDir: string
  let output: CollectingWritable
  let logger: Logger

  beforeEach(async () => {
    tempDir = `/tmp/claude/plugin-installer-test-${Date.now()}`
    projectDir = path.join(tempDir, 'project')
    await mkdir(path.join(projectDir, '.claude'), { recursive: true })
    output = new CollectingWritable()
    logger = createTestLogger()
  })

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true })
  })

  describe('force mode', () => {
    test('installs marketplace and plugin at user scope without prompting', async () => {
      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin marketplace add', { stdout: 'Added', exitCode: 0 }],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
      })

      expect(result.marketplaceScope).toBe('user')
      expect(result.pluginScope).toBe('user')
      expect(result.marketplaceAction).toBe('installed')
      expect(result.pluginAction).toBe('installed')
    })

    test('skips installation when both already present', async () => {
      const executor = createFakeExecutor(
        new Map([
          [
            'claude plugin marketplace list --json',
            { stdout: JSON.stringify([{ name: MARKETPLACE_NAME }]), exitCode: 0 },
          ],
          [
            'claude plugin list --json',
            {
              stdout: JSON.stringify([{ id: `sidekick@${MARKETPLACE_NAME}`, scope: 'user', enabled: true }]),
              exitCode: 0,
            },
          ],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
      })

      expect(result.marketplaceAction).toBe('already-installed')
      expect(result.pluginAction).toBe('already-installed')
    })
  })

  describe('scripted mode (explicit scopes)', () => {
    test('installs at specified scopes', async () => {
      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin marketplace add', { stdout: 'Added', exitCode: 0 }],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
        marketplaceScope: 'user',
        pluginScope: 'project',
      })

      expect(result.marketplaceScope).toBe('user')
      expect(result.pluginScope).toBe('project')
      const installCall = executor.calls.find((c) => c.args.includes('install') && c.args.includes('sidekick'))
      expect(installCall?.args).toContain('-s')
      expect(installCall?.args).toContain('project')
    })

    test('rejects plugin scope broader than marketplace scope', async () => {
      const executor = createFakeExecutor(new Map())

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
        marketplaceScope: 'project',
        pluginScope: 'user',
      })

      expect(result.marketplaceAction).toBe('failed')
      expect(result.pluginAction).toBe('failed')
      expect(result.error).toMatch(/scope/)
    })
  })

  describe('marketplace installation at project/local scope', () => {
    test('writes settings JSON for project scope', async () => {
      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
        marketplaceScope: 'project',
        pluginScope: 'project',
      })

      expect(result.marketplaceAction).toBe('installed')

      // Verify settings.json was written
      const settingsPath = path.join(projectDir, '.claude', 'settings.json')
      const content = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(content.extraKnownMarketplaces).toEqual([{ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE }])
      expect(content.enabledPlugins).toContain(`${PLUGIN_NAME}@${MARKETPLACE_NAME}`)
    })

    test('writes settings.local.json for local scope', async () => {
      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
        marketplaceScope: 'local',
        pluginScope: 'local',
      })

      expect(result.marketplaceAction).toBe('installed')

      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json')
      const content = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(content.extraKnownMarketplaces).toEqual([{ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE }])
    })

    test('preserves existing settings when merging marketplace', async () => {
      // Pre-populate settings.json with existing config
      const settingsPath = path.join(projectDir, '.claude', 'settings.json')
      await writeFile(settingsPath, JSON.stringify({ statusLine: { command: 'existing-command' } }))

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
        marketplaceScope: 'project',
        pluginScope: 'project',
      })

      const content = JSON.parse(await readFile(settingsPath, 'utf-8'))
      expect(content.statusLine).toEqual({ command: 'existing-command' })
      expect(content.extraKnownMarketplaces).toHaveLength(1)
    })
  })

  describe('error handling', () => {
    test('handles claude CLI not found gracefully', async () => {
      const executor = createMissingCliExecutor()

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
      })

      expect(result.marketplaceAction).toBe('failed')
      expect(result.error).toMatch(/claude.*not available|ENOENT/i)
      expect(output.data).toMatch(/manual|instructions/i)
    })

    test('handles marketplace add failure gracefully', async () => {
      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin marketplace add', { stdout: 'Error: access denied', exitCode: 1 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
      })

      expect(result.marketplaceAction).toBe('failed')
      expect(result.error).toBeDefined()
    })

    test('handles plugin install failure gracefully', async () => {
      const executor = createFakeExecutor(
        new Map([
          [
            'claude plugin marketplace list --json',
            { stdout: JSON.stringify([{ name: MARKETPLACE_NAME }]), exitCode: 0 },
          ],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Error: install failed', exitCode: 1 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
      })

      expect(result.marketplaceAction).toBe('already-installed')
      expect(result.pluginAction).toBe('failed')
      expect(result.error).toBeDefined()
    })
  })

  describe('marketplace detection for project/local scope', () => {
    test('detects marketplace already in settings.json', async () => {
      const settingsPath = path.join(projectDir, '.claude', 'settings.json')
      await writeFile(
        settingsPath,
        JSON.stringify({
          extraKnownMarketplaces: [{ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE }],
          enabledPlugins: [`${PLUGIN_NAME}@${MARKETPLACE_NAME}`],
        })
      )

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          [
            'claude plugin list --json',
            {
              stdout: JSON.stringify([{ id: `sidekick@${MARKETPLACE_NAME}`, scope: 'project', enabled: true }]),
              exitCode: 0,
            },
          ],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
        marketplaceScope: 'project',
        pluginScope: 'project',
      })

      expect(result.marketplaceAction).toBe('already-installed')
    })

    test('detects marketplace already in settings.local.json', async () => {
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json')
      await writeFile(
        settingsPath,
        JSON.stringify({
          extraKnownMarketplaces: [{ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE }],
          enabledPlugins: [`${PLUGIN_NAME}@${MARKETPLACE_NAME}`],
        })
      )

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          [
            'claude plugin list --json',
            {
              stdout: JSON.stringify([{ id: `sidekick@${MARKETPLACE_NAME}`, scope: 'local', enabled: true }]),
              exitCode: 0,
            },
          ],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
        marketplaceScope: 'local',
        pluginScope: 'local',
      })

      expect(result.marketplaceAction).toBe('already-installed')
    })
  })

  describe('interactive mode', () => {
    test('prompts for marketplace scope and plugin scope', async () => {
      // Answer "1" (user) for marketplace scope, "1" (user) for plugin scope
      const stdin = createFakeStdin(['1', '1'])

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin marketplace add', { stdout: 'Added', exitCode: 0 }],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: false,
        projectDir,
        executor,
        ctx: { stdin, stdout: output },
      })

      expect(result.marketplaceScope).toBe('user')
      expect(result.pluginScope).toBe('user')
      expect(result.marketplaceAction).toBe('installed')
      expect(result.pluginAction).toBe('installed')
    })

    test('constrains plugin scope options based on marketplace scope', async () => {
      // Answer "2" (project) for marketplace, "1" for plugin (first option = project, not user)
      const stdin = createFakeStdin(['2', '1'])

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: false,
        projectDir,
        executor,
        ctx: { stdin, stdout: output },
      })

      expect(result.marketplaceScope).toBe('project')
      // First option when marketplace=project is "project"
      expect(result.pluginScope).toBe('project')
    })

    test('auto-selects local plugin scope when marketplace is local', async () => {
      // Answer "3" (local) for marketplace — plugin scope should be auto-selected
      const stdin = createFakeStdin(['3'])

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: false,
        projectDir,
        executor,
        ctx: { stdin, stdout: output },
      })

      expect(result.marketplaceScope).toBe('local')
      expect(result.pluginScope).toBe('local')
    })

    test('skips all prompts when both already installed', async () => {
      // No stdin answers needed — detection short-circuits before any prompts
      const stdin = createFakeStdin([])

      const executor = createFakeExecutor(
        new Map([
          [
            'claude plugin marketplace list --json',
            { stdout: JSON.stringify([{ name: MARKETPLACE_NAME }]), exitCode: 0 },
          ],
          [
            'claude plugin list --json',
            {
              stdout: JSON.stringify([{ id: `sidekick@${MARKETPLACE_NAME}`, scope: 'user', enabled: true }]),
              exitCode: 0,
            },
          ],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: false,
        projectDir,
        executor,
        ctx: { stdin, stdout: output },
      })

      expect(result.marketplaceAction).toBe('already-installed')
      expect(result.pluginAction).toBe('already-installed')
      // No scope prompts were shown
      expect(output.data).not.toMatch(/Where should/)
    })

    test('skips marketplace prompt when marketplace found, still prompts for plugin scope', async () => {
      // Only one stdin answer needed — for plugin scope ("1" = user)
      const stdin = createFakeStdin(['1'])

      const executor = createFakeExecutor(
        new Map([
          [
            'claude plugin marketplace list --json',
            { stdout: JSON.stringify([{ name: MARKETPLACE_NAME }]), exitCode: 0 },
          ],
          ['claude plugin list --json', { stdout: '[]', exitCode: 0 }],
          ['claude plugin install', { stdout: 'Installed', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: false,
        projectDir,
        executor,
        ctx: { stdin, stdout: output },
      })

      expect(result.marketplaceAction).toBe('already-installed')
      expect(result.pluginAction).toBe('installed')
      expect(result.marketplaceScope).toBe('user')
      // Marketplace prompt was skipped
      expect(output.data).not.toMatch(/Where should the sidekick marketplace/)
    })

    test('skips plugin prompt when plugin found, still prompts for marketplace scope', async () => {
      // Only one stdin answer needed — for marketplace scope ("1" = user)
      const stdin = createFakeStdin(['1'])

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          [
            'claude plugin list --json',
            {
              stdout: JSON.stringify([{ id: `sidekick@${MARKETPLACE_NAME}`, scope: 'user', enabled: true }]),
              exitCode: 0,
            },
          ],
          ['claude plugin marketplace add', { stdout: 'Added', exitCode: 0 }],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: false,
        projectDir,
        executor,
        ctx: { stdin, stdout: output },
      })

      expect(result.marketplaceAction).toBe('installed')
      expect(result.pluginAction).toBe('already-installed')
      // Plugin prompt was skipped
      expect(output.data).not.toMatch(/Where should the sidekick plugin/)
    })
  })

  describe('detect-first across scopes', () => {
    test('detects marketplace in project settings even without explicit scope', async () => {
      // Marketplace NOT at user scope (CLI returns empty), but IS in project settings
      const settingsPath = path.join(projectDir, '.claude', 'settings.json')
      await writeFile(
        settingsPath,
        JSON.stringify({
          extraKnownMarketplaces: [{ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE }],
        })
      )

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          [
            'claude plugin list --json',
            {
              stdout: JSON.stringify([{ id: `sidekick@${MARKETPLACE_NAME}`, scope: 'project', enabled: true }]),
              exitCode: 0,
            },
          ],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
      })

      expect(result.marketplaceAction).toBe('already-installed')
      expect(result.pluginAction).toBe('already-installed')
    })

    test('detects marketplace in local settings even without explicit scope', async () => {
      // Marketplace NOT at user or project scope, but IS in local settings
      const settingsPath = path.join(projectDir, '.claude', 'settings.local.json')
      await writeFile(
        settingsPath,
        JSON.stringify({
          extraKnownMarketplaces: [{ name: MARKETPLACE_NAME, source: MARKETPLACE_SOURCE }],
        })
      )

      const executor = createFakeExecutor(
        new Map([
          ['claude plugin marketplace list --json', { stdout: '[]', exitCode: 0 }],
          [
            'claude plugin list --json',
            {
              stdout: JSON.stringify([{ id: `sidekick@${MARKETPLACE_NAME}`, scope: 'local', enabled: true }]),
              exitCode: 0,
            },
          ],
        ])
      )

      const result = await ensurePluginInstalled({
        logger,
        stdout: output,
        force: true,
        projectDir,
        executor,
      })

      expect(result.marketplaceAction).toBe('already-installed')
      expect(result.pluginAction).toBe('already-installed')
    })
  })
})
