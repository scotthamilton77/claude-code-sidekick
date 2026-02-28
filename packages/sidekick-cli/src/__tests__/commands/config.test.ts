/**
 * Config CLI Command Tests
 *
 * Tests the handleConfigCommand router that dispatches to configGet, configSet,
 * configUnset, and configList from @sidekick/core.
 *
 * These tests exercise the CLI layer (argument routing, stdout formatting,
 * exit codes) against real temp directories — no mocking of @sidekick/core.
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Writable } from 'node:stream'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { AssetResolver, Logger } from '@sidekick/core'
import { handleConfigCommand } from '../../commands/config.js'

// =============================================================================
// Test Helpers
// =============================================================================

/** Captures stdout writes into a string buffer. */
function createTestStdout(): { stdout: Writable; output: () => string } {
  let buffer = ''
  const stdout = new Writable({
    write(chunk, _encoding, callback) {
      buffer += chunk.toString()
      callback()
    },
  })
  return { stdout, output: () => buffer }
}

/** Minimal no-op logger satisfying the Logger interface. */
const noopLogger: Logger = {
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
  child: () => noopLogger,
  flush: () => Promise.resolve(),
} as Logger

/** Standard defaults matching the real bundled assets for core/llm/transcript. */
const TEST_DEFAULTS = {
  core: {
    logging: { level: 'info', format: 'json', consoleEnabled: false },
    paths: { state: '.sidekick' },
    daemon: { idleTimeoutMs: 300000, shutdownTimeoutMs: 30000 },
    ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    development: { enabled: false },
  },
  llm: {
    defaultProfile: 'fast-lite',
    profiles: {
      'fast-lite': {
        provider: 'openrouter',
        model: 'google/gemini-2.0-flash-lite-001',
        temperature: 0,
        maxTokens: 1000,
        timeout: 15,
        timeoutMaxRetries: 2,
      },
    },
    global: { debugDumpEnabled: false },
  },
  transcript: {
    watchDebounceMs: 100,
    metricsPersistIntervalMs: 5000,
  },
}

function createMockAssets(overrides?: {
  core?: Record<string, unknown>
  llm?: Record<string, unknown>
  transcript?: Record<string, unknown>
  features?: Record<string, Record<string, unknown>>
}): AssetResolver {
  return {
    resolve: () => null,
    resolveOrThrow: () => {
      throw new Error('not found')
    },
    resolvePath: () => null,
    resolveJson: () => null,
    resolveYaml: <T>(path: string): T | null => {
      if (path === 'defaults/core.defaults.yaml') {
        return (overrides?.core ?? TEST_DEFAULTS.core) as T
      }
      if (path === 'defaults/llm.defaults.yaml') {
        return (overrides?.llm ?? TEST_DEFAULTS.llm) as T
      }
      if (path === 'defaults/transcript.defaults.yaml') {
        return (overrides?.transcript ?? TEST_DEFAULTS.transcript) as T
      }
      const featureMatch = path.match(/^defaults\/features\/(.+)\.defaults\.yaml$/)
      if (featureMatch && overrides?.features?.[featureMatch[1]]) {
        return overrides.features[featureMatch[1]] as T
      }
      return null
    },
    cascadeLayers: ['/mock/assets'],
  }
}

// =============================================================================
// Environment Isolation
// =============================================================================

let savedEnv: Record<string, string | undefined> = {}
let tempRoot: string

beforeEach(() => {
  // Reset before accumulating to prevent stale state if a test throws
  savedEnv = {}

  // Isolate SIDEKICK_* env vars
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SIDEKICK_')) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  }

  // Create unique temp directory per test
  tempRoot = join(tmpdir(), `sidekick-config-cli-tests-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
  mkdirSync(tempRoot, { recursive: true })

  // Isolate home directory so real ~/.sidekick/ cannot influence cascade reads
  const tempHome = join(tempRoot, 'home')
  mkdirSync(tempHome, { recursive: true })
  for (const key of ['HOME', 'USERPROFILE'] as const) {
    if (!(key in savedEnv)) {
      savedEnv[key] = process.env[key]
    }
    process.env[key] = tempHome
  }
})

afterEach(() => {
  // Restore env
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
  savedEnv = {}

  // Clean up temp directory
  if (existsSync(tempRoot)) {
    rmSync(tempRoot, { recursive: true, force: true })
  }
})

// =============================================================================
// Tests
// =============================================================================

describe('handleConfigCommand', () => {
  // ---------------------------------------------------------------------------
  // 1. config get core.logging.level — returns the resolved value
  // ---------------------------------------------------------------------------
  test('config get returns the cascade-resolved default value', () => {
    const projectDir = join(tempRoot, 'project')
    mkdirSync(projectDir, { recursive: true })
    const assets = createMockAssets()
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('get', ['core.logging.level'], projectDir, noopLogger, stdout, {
      assets,
    })

    expect(result.exitCode).toBe(0)
    expect(output()).toContain('info')
  })

  // ---------------------------------------------------------------------------
  // 2. config get core.logging.level --scope=project — scope-specific value
  // ---------------------------------------------------------------------------
  test('config get with scope returns the scope-specific value', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })
    writeFileSync(join(projectSidekick, 'config.yaml'), 'logging:\n  level: debug\n')

    const assets = createMockAssets()
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('get', ['core.logging.level'], projectDir, noopLogger, stdout, {
      scope: 'project',
      assets,
    })

    expect(result.exitCode).toBe(0)
    expect(output()).toContain('debug')
  })

  // ---------------------------------------------------------------------------
  // 3. config get core.nonexistent.path — returns appropriate error
  // ---------------------------------------------------------------------------
  test('config get for nonexistent path returns exit code 1 with error message', () => {
    const projectDir = join(tempRoot, 'project')
    mkdirSync(projectDir, { recursive: true })
    const assets = createMockAssets()
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('get', ['core.nonexistent.path'], projectDir, noopLogger, stdout, {
      assets,
    })

    expect(result.exitCode).toBe(1)
    expect(output()).toContain('No value found')
  })

  // ---------------------------------------------------------------------------
  // 4. config set core.logging.level debug — writes and returns success
  // ---------------------------------------------------------------------------
  test('config set writes value and returns success', () => {
    const projectDir = join(tempRoot, 'project')
    mkdirSync(projectDir, { recursive: true })
    const assets = createMockAssets()
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('set', ['core.logging.level', 'debug'], projectDir, noopLogger, stdout, {
      assets,
    })

    expect(result.exitCode).toBe(0)
    expect(output()).toContain('Set')

    // Verify the file was actually written
    const configPath = join(projectDir, '.sidekick', 'config.yaml')
    expect(existsSync(configPath)).toBe(true)
    const content = readFileSync(configPath, 'utf8')
    expect(content).toContain('debug')
  })

  // ---------------------------------------------------------------------------
  // 5. config set core.logging.level verbose — returns validation error
  // ---------------------------------------------------------------------------
  test('config set with invalid value returns exit code 1 with error', () => {
    const projectDir = join(tempRoot, 'project')
    mkdirSync(projectDir, { recursive: true })
    const assets = createMockAssets()
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('set', ['core.logging.level', 'verbose'], projectDir, noopLogger, stdout, {
      assets,
    })

    expect(result.exitCode).toBe(1)
    expect(output()).toMatch(/validation/i)
  })

  // ---------------------------------------------------------------------------
  // 6. config unset core.logging.level — removes override and returns success
  // ---------------------------------------------------------------------------
  test('config unset removes override and returns success', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // First set a value so there is something to unset
    writeFileSync(join(projectSidekick, 'config.yaml'), 'logging:\n  level: debug\n  format: json\n')

    const assets = createMockAssets()
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('unset', ['core.logging.level'], projectDir, noopLogger, stdout, {
      assets,
    })

    expect(result.exitCode).toBe(0)
    expect(output()).toContain('Unset')

    // Verify the key was actually removed from the file
    const content = readFileSync(join(projectSidekick, 'config.yaml'), 'utf8')
    expect(content).not.toContain('level')
    expect(content).toContain('format: json')
  })

  // ---------------------------------------------------------------------------
  // 7. config list --scope=project — lists all project overrides
  // ---------------------------------------------------------------------------
  test('config list with scope shows all overrides as dot-paths', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.yaml'), 'logging:\n  level: debug\n  format: text\n')

    const assets = createMockAssets()
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('list', [], projectDir, noopLogger, stdout, {
      scope: 'project',
      assets,
    })

    expect(result.exitCode).toBe(0)
    const text = output()
    expect(text).toContain('core.logging.level')
    expect(text).toContain('core.logging.format')
  })

  // ---------------------------------------------------------------------------
  // 8. config --help — shows help text
  // ---------------------------------------------------------------------------
  test('--help shows usage information', () => {
    const projectDir = join(tempRoot, 'project')
    mkdirSync(projectDir, { recursive: true })
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('--help', [], projectDir, noopLogger, stdout, {})

    expect(result.exitCode).toBe(0)
    expect(output()).toContain('Usage')
  })

  // ---------------------------------------------------------------------------
  // 9. Unknown subcommand — shows error
  // ---------------------------------------------------------------------------
  test('unknown subcommand returns error with help text', () => {
    const projectDir = join(tempRoot, 'project')
    mkdirSync(projectDir, { recursive: true })
    const { stdout, output } = createTestStdout()

    const result = handleConfigCommand('invalid', [], projectDir, noopLogger, stdout, {})

    expect(result.exitCode).toBe(1)
    const text = output()
    expect(text).toMatch(/[Uu]nknown/)
    // Should also display help text after the error
    expect(text).toContain('Usage')
  })
})
