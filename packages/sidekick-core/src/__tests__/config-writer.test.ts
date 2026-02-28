/**
 * Config Writer Tests (configGet + configSet + configUnset + configList)
 *
 * Tests the config-writer module that provides programmatic access
 * to config values via dot-path notation (e.g., 'core.logging.level').
 *
 * Covers:
 * - parseDotPath: domain extraction and validation
 * - configGet: cascade-resolved reads
 * - configGet with scope: scope-specific reads (user, project, local)
 * - getNestedValue: nested object traversal
 * - configSet: comment-preserving YAML writes with validation
 * - configUnset: key removal with comment preservation
 * - configList: flattened dot-path listing of scope overrides
 */

import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { AssetResolver } from '../assets'
import { configGet, configList, configSet, configUnset, parseDotPath } from '../config-writer'

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

// =============================================================================
// configSet Tests
// =============================================================================

describe('configSet', () => {
  const tempRoot = join(tmpdir(), 'sidekick-config-set-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('writes value to correct file at project scope (default)', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    const result = configSet('core.logging.level', 'debug', {
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(result.domain).toBe('core')
    expect(result.path).toEqual(['logging', 'level'])
    expect(result.value).toBe('debug')
    expect(result.filePath).toBe(join(projectSidekick, 'config.yaml'))

    // Verify file was actually written
    const content = readFileSync(result.filePath, 'utf8')
    expect(content).toContain('debug')
  })

  test('writes to user scope with scope=user', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')

    const result = configSet('core.logging.level', 'warn', {
      scope: 'user',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(result.domain).toBe('core')
    expect(result.path).toEqual(['logging', 'level'])
    expect(result.value).toBe('warn')
    expect(result.filePath).toBe(join(homeDir, '.sidekick', 'config.yaml'))

    // Verify via configGet that the value is in user scope
    const getResult = configGet('core.logging.level', {
      scope: 'user',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })
    expect(getResult!.value).toBe('warn')
  })

  test('writes to local scope with scope=local', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')

    const result = configSet('core.logging.level', 'error', {
      scope: 'local',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(result.domain).toBe('core')
    expect(result.filePath).toBe(join(projectDir, '.sidekick', 'config.local.yaml'))

    // Verify via configGet
    const getResult = configGet('core.logging.level', {
      scope: 'local',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })
    expect(getResult!.value).toBe('error')
  })

  test('auto-detects types: numbers, booleans, strings', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const assets = createMockAssets()

    // Number: '42' -> 42
    const numResult = configSet('transcript.watchDebounceMs', '42', {
      projectRoot: projectDir,
      homeDir,
      assets,
    })
    expect(numResult.value).toBe(42)

    // Boolean: 'true' -> true
    const boolResult = configSet('core.development.enabled', 'true', {
      projectRoot: projectDir,
      homeDir,
      assets,
    })
    expect(boolResult.value).toBe(true)

    // String stays as string
    const strResult = configSet('core.logging.level', 'debug', {
      projectRoot: projectDir,
      homeDir,
      assets,
    })
    expect(strResult.value).toBe('debug')
  })

  test('preserves existing YAML comments when updating a file', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Write a file with comments
    const yamlWithComments = `# Core configuration
logging:
  # Log level: debug, info, warn, error
  level: info
  format: json
  consoleEnabled: false
`
    writeFileSync(join(projectSidekick, 'config.yaml'), yamlWithComments)

    // Update a value
    configSet('core.logging.level', 'debug', {
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    // Read back and verify comments are preserved
    const content = readFileSync(join(projectSidekick, 'config.yaml'), 'utf8')
    expect(content).toContain('# Core configuration')
    expect(content).toContain('# Log level: debug, info, warn, error')
    expect(content).toContain('debug')
    expect(content).not.toContain('level: info')
  })

  test('creates parent directories if they do not exist', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    // Note: NOT creating .sidekick directory beforehand

    const result = configSet('core.logging.level', 'debug', {
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(existsSync(result.filePath)).toBe(true)
    const content = readFileSync(result.filePath, 'utf8')
    expect(content).toContain('debug')
  })

  test('seeds from bundled defaults when creating a new file', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')

    // Create a defaults file with comments in a temp location
    const defaultsDir = join(tempRoot, 'assets')
    mkdirSync(join(defaultsDir, 'defaults'), { recursive: true })
    const defaultsContent = `# Default core configuration
# Managed by Sidekick
logging:
  # Available levels: debug, info, warn, error
  level: info
  format: json
  consoleEnabled: false
paths:
  state: .sidekick
daemon:
  idleTimeoutMs: 300000
  shutdownTimeoutMs: 30000
ipc:
  connectTimeoutMs: 5000
  requestTimeoutMs: 30000
  maxRetries: 3
  retryDelayMs: 100
development:
  enabled: false
`
    writeFileSync(join(defaultsDir, 'defaults', 'core.defaults.yaml'), defaultsContent)

    // Create mock assets that returns real file path for resolvePath
    const assets = createMockAssets()
    const seedAssets: AssetResolver = {
      ...assets,
      resolvePath: (path: string) => {
        if (path === 'defaults/core.defaults.yaml') {
          return join(defaultsDir, 'defaults', 'core.defaults.yaml')
        }
        return null
      },
    }

    configSet('core.logging.level', 'debug', {
      projectRoot: projectDir,
      homeDir,
      assets: seedAssets,
    })

    // Verify the written file has the comments from defaults
    const filePath = join(projectDir, '.sidekick', 'config.yaml')
    const content = readFileSync(filePath, 'utf8')
    expect(content).toContain('# Default core configuration')
    expect(content).toContain('# Available levels: debug, info, warn, error')
    expect(content).toContain('level: debug')
  })

  test('rejects invalid values via cascade validation', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')

    // Try to set an invalid log level (not in the enum)
    expect(() =>
      configSet('core.logging.level', 'verbose', {
        projectRoot: projectDir,
        homeDir,
        assets: createMockAssets(),
      })
    ).toThrow(/validation failed/i)
  })

  test('handles nested dot-paths creating intermediate objects', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')

    configSet('core.logging.level', 'warn', {
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    // Verify the nested structure was created
    const getResult = configGet('core.logging.level', {
      scope: 'project',
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })
    expect(getResult!.value).toBe('warn')
  })

  test('throws when trying to set entire domain (empty keyPath)', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')

    expect(() =>
      configSet('core', '{}', {
        projectRoot: projectDir,
        homeDir,
        assets: createMockAssets(),
      })
    ).toThrow(/cannot set an entire domain/i)
  })
})

// =============================================================================
// configUnset Tests
// =============================================================================

describe('configUnset', () => {
  const tempRoot = join(tmpdir(), 'sidekick-config-unset-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('removes a key from the scope file', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Set a value first
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: debug\n  format: json\n`)

    const result = configUnset('core.logging.level', {
      projectRoot: projectDir,
      homeDir,
    })

    expect(result.existed).toBe(true)
    expect(result.domain).toBe('core')
    expect(result.path).toEqual(['logging', 'level'])
    expect(result.filePath).toBe(join(projectSidekick, 'config.yaml'))

    // Verify key is gone but sibling remains
    const content = readFileSync(join(projectSidekick, 'config.yaml'), 'utf8')
    expect(content).not.toContain('level')
    expect(content).toContain('format: json')
  })

  test('preserves YAML comments in remaining content', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    const yamlWithComments = `# Core configuration
logging:
  # Log level setting
  level: debug
  # Output format
  format: json
`
    writeFileSync(join(projectSidekick, 'config.yaml'), yamlWithComments)

    configUnset('core.logging.level', {
      projectRoot: projectDir,
      homeDir,
    })

    const content = readFileSync(join(projectSidekick, 'config.yaml'), 'utf8')
    expect(content).toContain('# Core configuration')
    expect(content).toContain('# Output format')
    expect(content).toContain('format: json')
    expect(content).not.toContain('level: debug')
  })

  test('returns existed: false for nonexistent file (no error)', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    // Note: NOT creating .sidekick directory or file

    const result = configUnset('core.logging.level', {
      projectRoot: projectDir,
      homeDir,
    })

    expect(result.existed).toBe(false)
  })

  test('after unset, cascade falls through to lower-priority scope', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    // User scope has 'warn', project scope has 'error'
    writeFileSync(join(userSidekick, 'config.yaml'), `logging:\n  level: warn\n`)
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error\n`)

    // Cascade before unset: project overrides user -> 'error'
    const before = configGet('core.logging.level', {
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })
    expect(before!.value).toBe('error')

    // Unset from project scope
    configUnset('core.logging.level', {
      scope: 'project',
      projectRoot: projectDir,
      homeDir,
    })

    // Cascade after unset: falls through to user -> 'warn'
    const after = configGet('core.logging.level', {
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })
    expect(after!.value).toBe('warn')
  })

  test('returns existed: false when key is not present in existing file', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // File exists but does not contain the key we're unsetting
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: info\n`)

    const result = configUnset('core.logging.nonexistent', {
      scope: 'project',
      projectRoot: projectDir,
      homeDir,
    })

    expect(result.existed).toBe(false)
    // File should still have the original content
    const content = readFileSync(join(projectSidekick, 'config.yaml'), 'utf8')
    expect(content).toContain('level: info')
  })

  test('throws when trying to unset entire domain (empty keyPath)', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')

    expect(() =>
      configUnset('core', {
        projectRoot: projectDir,
        homeDir,
      })
    ).toThrow(/cannot unset an entire domain/i)
  })
})

// =============================================================================
// configList Tests
// =============================================================================

describe('configList', () => {
  const tempRoot = join(tmpdir(), 'sidekick-config-list-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('returns all overrides at project scope', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: debug\n`)

    const result = configList({
      scope: 'project',
      projectRoot: projectDir,
      homeDir,
    })

    expect(result.scope).toBe('project')
    expect(result.entries).toContainEqual({ path: 'core.logging.level', value: 'debug' })
  })

  test('returns overrides across all domain files at a scope', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: debug\n`)
    writeFileSync(join(projectSidekick, 'transcript.yaml'), `watchDebounceMs: 200\n`)

    const result = configList({
      scope: 'project',
      projectRoot: projectDir,
      homeDir,
    })

    expect(result.scope).toBe('project')
    expect(result.entries).toContainEqual({ path: 'core.logging.level', value: 'debug' })
    expect(result.entries).toContainEqual({ path: 'transcript.watchDebounceMs', value: 200 })
  })

  test('returns empty entries when no files exist at scope', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    // No .sidekick directories created

    const result = configList({
      scope: 'project',
      projectRoot: projectDir,
      homeDir,
    })

    expect(result.scope).toBe('project')
    expect(result.entries).toEqual([])
  })

  test('flattens nested values into dot-path format', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(
      join(projectSidekick, 'config.yaml'),
      `logging:\n  level: warn\n  format: text\ndevelopment:\n  enabled: true\n`
    )

    const result = configList({
      scope: 'project',
      projectRoot: projectDir,
      homeDir,
    })

    expect(result.entries).toContainEqual({ path: 'core.logging.level', value: 'warn' })
    expect(result.entries).toContainEqual({ path: 'core.logging.format', value: 'text' })
    expect(result.entries).toContainEqual({ path: 'core.development.enabled', value: true })
  })
})
