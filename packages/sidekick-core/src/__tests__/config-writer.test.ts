/**
 * Config Writer Tests (configGet)
 *
 * Tests the config-writer module that provides programmatic access
 * to config values via dot-path notation (e.g., 'core.logging.level').
 *
 * Covers:
 * - parseDotPath: domain extraction and validation
 * - configGet: cascade-resolved reads
 * - configGet with scope: scope-specific reads (user, project, local)
 * - getNestedValue: nested object traversal
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { AssetResolver } from '../assets'
import { configGet, parseDotPath } from '../config-writer'

// =============================================================================
// Test Helpers: Standard Defaults (same pattern as config-service.test.ts)
// =============================================================================

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
// Test Setup: Environment Isolation
// =============================================================================

let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SIDEKICK_')) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  }
})

afterEach(() => {
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
  savedEnv = {}
})

// =============================================================================
// parseDotPath Tests
// =============================================================================

describe('parseDotPath', () => {
  test('extracts domain and keyPath for core domain', () => {
    const result = parseDotPath('core.logging.level')
    expect(result.domain).toBe('core')
    expect(result.keyPath).toEqual(['logging', 'level'])
  })

  test('extracts domain and keyPath for llm domain', () => {
    const result = parseDotPath('llm.defaultProfile')
    expect(result.domain).toBe('llm')
    expect(result.keyPath).toEqual(['defaultProfile'])
  })

  test('extracts domain and keyPath for transcript domain', () => {
    const result = parseDotPath('transcript.watchDebounceMs')
    expect(result.domain).toBe('transcript')
    expect(result.keyPath).toEqual(['watchDebounceMs'])
  })

  test('extracts domain and keyPath for features domain', () => {
    const result = parseDotPath('features.statusline.enabled')
    expect(result.domain).toBe('features')
    expect(result.keyPath).toEqual(['statusline', 'enabled'])
  })

  test('returns empty keyPath when only domain is specified', () => {
    const result = parseDotPath('core')
    expect(result.domain).toBe('core')
    expect(result.keyPath).toEqual([])
  })

  test('throws for unknown domain', () => {
    expect(() => parseDotPath('unknown.key')).toThrow(/unknown domain/i)
  })

  test('throws for empty path', () => {
    expect(() => parseDotPath('')).toThrow()
  })
})

// =============================================================================
// configGet - Cascade-Resolved Tests
// =============================================================================

describe('configGet - cascade-resolved', () => {
  const tempRoot = join(tmpdir(), 'sidekick-config-writer-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('returns cascade-resolved value for a leaf dot-path', () => {
    const result = configGet('core.logging.level', {
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(result).not.toBeUndefined()
    expect(result!.value).toBe('info')
    expect(result!.domain).toBe('core')
    expect(result!.path).toEqual(['logging', 'level'])
  })

  test('returns nested object when path points to a branch', () => {
    const result = configGet('core.logging', {
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(result).not.toBeUndefined()
    const value = result!.value as Record<string, unknown>
    expect(value).toHaveProperty('level', 'info')
    expect(value).toHaveProperty('format', 'json')
    expect(value).toHaveProperty('consoleEnabled', false)
  })

  test('returns entire domain when only domain is specified', () => {
    const result = configGet('transcript', {
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(result).not.toBeUndefined()
    const value = result!.value as Record<string, unknown>
    expect(value).toHaveProperty('watchDebounceMs', 100)
    expect(value).toHaveProperty('metricsPersistIntervalMs', 5000)
  })

  test('returns undefined for nonexistent paths', () => {
    const result = configGet('core.logging.nonexistent', {
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(result).toBeUndefined()
  })

  test('returns undefined for deeply nonexistent paths', () => {
    const result = configGet('core.a.b.c.d', {
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(result).toBeUndefined()
  })

  test('reflects project override in cascade', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: debug`)

    const result = configGet('core.logging.level', {
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(result!.value).toBe('debug')
  })
})

// =============================================================================
// configGet - Scope-Specific Tests
// =============================================================================

describe('configGet - scope-specific reads', () => {
  const tempRoot = join(tmpdir(), 'sidekick-config-writer-scope-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('scope=project returns only the project scope value', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(userSidekick, 'config.yaml'), `logging:\n  level: warn`)
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error`)

    const result = configGet('core.logging.level', {
      scope: 'project',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(result).not.toBeUndefined()
    expect(result!.value).toBe('error')
  })

  test('scope=user returns only the user scope value', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(userSidekick, 'config.yaml'), `logging:\n  level: warn`)
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error`)

    const result = configGet('core.logging.level', {
      scope: 'user',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(result).not.toBeUndefined()
    expect(result!.value).toBe('warn')
  })

  test('scope=local returns only the local override value', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error`)
    writeFileSync(join(projectSidekick, 'config.local.yaml'), `logging:\n  level: debug`)

    const result = configGet('core.logging.level', {
      scope: 'local',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(result).not.toBeUndefined()
    expect(result!.value).toBe('debug')
  })

  test('scope=local returns undefined when no local file exists', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })

    writeFileSync(join(userSidekick, 'config.yaml'), `logging:\n  level: warn`)

    const result = configGet('core.logging.level', {
      scope: 'local',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(result).toBeUndefined()
  })

  test('cascade returns project value when both user and project exist', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(userSidekick, 'config.yaml'), `logging:\n  level: warn`)
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error`)

    // No scope = cascade-resolved (should return 'error' since project overrides user)
    const cascadeResult = configGet('core.logging.level', {
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(cascadeResult!.value).toBe('error')

    // scope=user should return 'warn'
    const userResult = configGet('core.logging.level', {
      scope: 'user',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(userResult!.value).toBe('warn')
  })

  test('scope=user returns undefined when user file has no value for the path', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Only project has the value, user file does not exist
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error`)

    const result = configGet('core.logging.level', {
      scope: 'user',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(result).toBeUndefined()
  })
})
