/**
 * Configuration Service Tests
 *
 * Tests the YAML-based configuration system per docs/design/CONFIG-SYSTEM.md.
 * Covers:
 * - YAML parsing (valid/invalid domain files)
 * - Domain file cascade precedence
 * - sidekick.config dot-notation parsing
 * - ConfigService interface
 * - Immutability requirements
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import { createConfigService, loadConfig, parseUnifiedConfig } from '../config'
import type { AssetResolver } from '../assets'

// =============================================================================
// Test Helpers: Standard Defaults
// =============================================================================

/**
 * Standard test defaults matching assets/sidekick/defaults/ YAML files.
 * Used by tests that need valid config without setting up full YAML files.
 */
const TEST_DEFAULTS = {
  core: {
    logging: { level: 'info', format: 'pretty', consoleEnabled: false },
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

/**
 * Creates a mock AssetResolver that returns standard test defaults.
 * Override specific domains by passing partial defaults.
 * Feature defaults can be specified per-feature in the features map.
 */
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
      // Handle feature defaults: defaults/features/{name}.defaults.yaml
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
  // Save and clear SIDEKICK_* env vars before each test
  for (const key of Object.keys(process.env)) {
    if (key.startsWith('SIDEKICK_')) {
      savedEnv[key] = process.env[key]
      delete process.env[key]
    }
  }
})

afterEach(() => {
  // Restore saved env vars after each test
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
// parseUnifiedConfig Tests (sidekick.config dot-notation)
// =============================================================================

describe('parseUnifiedConfig', () => {
  test('parses simple key=value pairs', () => {
    const content = `
llm.provider=openai
llm.model=gpt-4o
core.logging.level=debug
`
    const result = parseUnifiedConfig(content)

    expect(result.config.llm).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
    expect(result.config.core).toEqual({
      logging: { level: 'debug' },
    })
  })

  test('accepts both = and : as delimiters', () => {
    const content = `
llm.provider=openai
llm.model: gpt-4o
core.logging.level:debug
features.reminders.settings.threshold = 10
`
    const result = parseUnifiedConfig(content)

    expect(result.config.llm).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
    expect(result.config.core).toEqual({
      logging: { level: 'debug' },
    })
    expect(result.config.features).toEqual({
      reminders: { settings: { threshold: 10 } },
    })
    expect(result.warnings).toHaveLength(0)
  })

  test('skips comments and empty lines', () => {
    const content = `
# This is a comment
llm.provider=openai

# Another comment
llm.model=gpt-4o
`
    const result = parseUnifiedConfig(content)

    expect(result.config.llm).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
  })

  test('coerces boolean values', () => {
    const content = `
llm.debugDumpEnabled=true
features.reminders.enabled=false
`
    const result = parseUnifiedConfig(content)

    expect(result.config.llm?.debugDumpEnabled).toBe(true)
    expect(result.config.features?.reminders).toEqual({ enabled: false })
  })

  test('coerces numeric values', () => {
    const content = `
llm.temperature=0.7
llm.timeout=60
transcript.watchDebounceMs=200
`
    const result = parseUnifiedConfig(content)

    expect(result.config.llm?.temperature).toBe(0.7)
    expect(result.config.llm?.timeout).toBe(60)
    expect(result.config.transcript?.watchDebounceMs).toBe(200)
  })

  test('parses JSON arrays', () => {
    const content = `features.test.settings.items=["a","b","c"]`
    const result = parseUnifiedConfig(content)

    expect(result.config.features?.test).toEqual({
      settings: { items: ['a', 'b', 'c'] },
    })
  })

  test('parses JSON objects', () => {
    const content = `features.test.settings.nested={"key":"value","num":42}`
    const result = parseUnifiedConfig(content)

    expect(result.config.features?.test).toEqual({
      settings: { nested: { key: 'value', num: 42 } },
    })
  })

  test('handles quoted strings', () => {
    const content = `
llm.model="gpt-4o-mini"
core.paths.state='custom-state'
`
    const result = parseUnifiedConfig(content)

    expect(result.config.llm?.model).toBe('gpt-4o-mini')
    expect(result.config.core?.paths).toEqual({ state: 'custom-state' })
  })

  test('ignores malformed lines and collects warnings', () => {
    const content = `
llm.provider=openai
invalid line without equals
single.key
=value without key
llm.model=gpt-4o
`
    const result = parseUnifiedConfig(content)

    expect(result.config.llm).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
  })

  test('builds deeply nested structures', () => {
    const content = `features.reminders.settings.thresholds.stuck=40`
    const result = parseUnifiedConfig(content)

    expect(result.config.features?.reminders).toEqual({
      settings: {
        thresholds: { stuck: 40 },
      },
    })
  })

  test('collects overrides for logging', () => {
    const content = `
llm.provider=openai
llm.model=gpt-4o
`
    const result = parseUnifiedConfig(content)

    expect(result.overrides).toHaveLength(2)
    expect(result.overrides).toContainEqual({ key: 'llm.provider', value: 'openai' })
    expect(result.overrides).toContainEqual({ key: 'llm.model', value: 'gpt-4o' })
  })

  test('collects warnings for malformed lines', () => {
    const content = `
llm.provider=openai
features.reminders.threshold: 4
no_delimiter_here
single=value
`
    const result = parseUnifiedConfig(content, 'test.config')

    // Line 3 (features.reminders.threshold: 4) is valid now that we accept ':'
    // Line 4 has no delimiter, line 5 has invalid key format (not dot-notation)
    expect(result.warnings).toHaveLength(2)
    expect(result.warnings[0]).toContain('test.config:4')
    expect(result.warnings[0]).toContain("missing '=' or ':'")
    expect(result.warnings[1]).toContain('test.config:5')
    expect(result.warnings[1]).toContain('invalid key format')
  })
})

// =============================================================================
// YAML Parsing Tests
// =============================================================================

describe('loadConfig - YAML parsing', () => {
  const tempRoot = join(tmpdir(), 'sidekick-yaml-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('returns defaults when no config files exist (with assets)', () => {
    // With YAML assets providing defaults, returns those defaults
    const config = loadConfig({
      projectRoot: join(tempRoot, 'empty-project'),
      homeDir: join(tempRoot, 'empty-home'),
      assets: createMockAssets(),
    })

    // Core defaults from mock assets
    expect(config.core.logging.level).toBe('info')
    expect(config.core.logging.format).toBe('pretty')
    expect(config.core.paths.state).toBe('.sidekick')

    // LLM defaults - profile-based structure
    expect(config.llm.defaultProfile).toBe('fast-lite')
    expect(config.llm.profiles['fast-lite'].provider).toBe('openrouter')
    expect(config.llm.profiles['fast-lite'].temperature).toBe(0)
    expect(config.llm.profiles['fast-lite'].timeout).toBe(15)

    // Transcript defaults
    expect(config.transcript.watchDebounceMs).toBe(100)
    expect(config.transcript.metricsPersistIntervalMs).toBe(5000)

    // Features defaults to empty
    expect(config.features).toEqual({})
  })

  test('parses valid YAML config file', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(
      join(projectSidekick, 'config.yaml'),
      `
logging:
  level: debug
  format: json
paths:
  state: custom-state
`
    )

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(config.core.logging.level).toBe('debug')
    expect(config.core.logging.format).toBe('json')
    expect(config.core.paths.state).toBe('custom-state')
  })

  test('throws clear error for malformed YAML', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Invalid YAML: bad indentation
    writeFileSync(
      join(projectSidekick, 'config.yaml'),
      `
logging:
  level: debug
   format: json
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
        assets: createMockAssets(),
      })
    ).toThrow(/parse|yaml/i)
  })

  test('handles empty YAML files gracefully', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.yaml'), '')

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    // Should fall back to defaults from assets
    expect(config.core.logging.level).toBe('info')
  })

  test('rejects unknown keys at top level (strict mode per SCHEMA-CONTRACTS.md §6.4)', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(
      join(projectSidekick, 'config.yaml'),
      `
logging:
  level: info
unknownKey: should-fail
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
      })
    ).toThrow(/unrecognized|unknown/i)
  })

  test('rejects unknown keys in nested objects (strict mode)', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(
      join(projectSidekick, 'config.yaml'),
      `
logging:
  level: info
  unknownSetting: true
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
      })
    ).toThrow(/unrecognized|unknown/i)
  })
})

// =============================================================================
// Domain File Cascade Tests
// =============================================================================

describe('loadConfig - cascade precedence', () => {
  const tempRoot = join(tmpdir(), 'sidekick-cascade-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('env variables override defaults', () => {
    process.env.SIDEKICK_LOG_LEVEL = 'debug'

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(config.core.logging.level).toBe('debug')
  })

  test('user unified config overrides env', () => {
    const homeDir = join(tempRoot, 'home')
    const userSidekick = join(homeDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })

    process.env.SIDEKICK_LOG_LEVEL = 'debug'

    writeFileSync(join(userSidekick, 'sidekick.config'), `core.logging.level=warn`)

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir,
      assets: createMockAssets(),
    })

    expect(config.core.logging.level).toBe('warn')
  })

  test('user unified config overrides user domain YAML', () => {
    const homeDir = join(tempRoot, 'home')
    const userSidekick = join(homeDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })

    writeFileSync(join(userSidekick, 'config.yaml'), `logging:\n  level: error`)
    writeFileSync(join(userSidekick, 'sidekick.config'), `core.logging.level=warn`)

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir,
      assets: createMockAssets(),
    })

    // sidekick.config overrides domain YAML
    expect(config.core.logging.level).toBe('warn')
  })

  test('project unified config overrides user domain YAML', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(userSidekick, 'config.yaml'), `logging:\n  level: warn`)
    writeFileSync(join(projectSidekick, 'sidekick.config'), `core.logging.level=error`)

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(config.core.logging.level).toBe('error')
  })

  test('project unified config overrides project domain YAML', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error`)
    writeFileSync(join(projectSidekick, 'sidekick.config'), `core.logging.level=warn`)

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    // sidekick.config overrides domain YAML
    expect(config.core.logging.level).toBe('warn')
  })

  test('project-local (.yaml.local) has highest priority', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: warn`)
    writeFileSync(join(projectSidekick, 'config.yaml.local'), `logging:\n  level: debug`)

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(config.core.logging.level).toBe('debug')
  })

  test('deep merges across cascade layers', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    // User sets logging level and format
    writeFileSync(
      join(userSidekick, 'config.yaml'),
      `
logging:
  level: warn
  format: json
`
    )

    // Project only overrides level, format should be preserved
    writeFileSync(
      join(projectSidekick, 'config.yaml'),
      `
logging:
  level: error
`
    )

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    expect(config.core.logging.level).toBe('error')
    expect(config.core.logging.format).toBe('json')
  })

  test('arrays are replaced, not merged', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Features with array-like settings
    writeFileSync(
      join(projectSidekick, 'features.yaml'),
      `
test:
  enabled: true
  settings:
    items: [a, b, c]
`
    )

    writeFileSync(
      join(projectSidekick, 'features.yaml.local'),
      `
test:
  settings:
    items: [x, y]
`
    )

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    // Array should be replaced, not concatenated
    expect(config.features.test?.settings?.items).toEqual(['x', 'y'])
  })

  test('multi-domain cascade works independently', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    // User sets LLM profile config (partial - will be merged with defaults)
    writeFileSync(
      join(userSidekick, 'llm.yaml'),
      `
profiles:
  fast-lite:
    provider: openai
    model: gpt-4o
`
    )

    // Project sets core config and overrides LLM profile provider
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: debug`)
    writeFileSync(
      join(projectSidekick, 'llm.yaml'),
      `
profiles:
  fast-lite:
    provider: openrouter
`
    )

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir,
      assets: createMockAssets(),
    })

    // Core from project
    expect(config.core.logging.level).toBe('debug')
    // LLM: provider from project, model from user
    expect(config.llm.profiles['fast-lite'].provider).toBe('openrouter')
    expect(config.llm.profiles['fast-lite'].model).toBe('gpt-4o')
  })
})

// =============================================================================
// ConfigService Tests
// =============================================================================

describe('ConfigService', () => {
  const tempRoot = join(tmpdir(), 'sidekick-service-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('provides domain accessors', () => {
    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(service.core.logging.level).toBe('info')
    expect(service.llm.defaultProfile).toBe('fast-lite')
    expect(service.llm.profiles['fast-lite'].provider).toBe('openrouter')
    expect(service.transcript.watchDebounceMs).toBe(100)
    expect(service.features).toEqual({})
  })

  test('getAll() returns full config object', () => {
    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    const config = service.getAll()

    expect(config).toHaveProperty('core')
    expect(config).toHaveProperty('llm')
    expect(config).toHaveProperty('transcript')
    expect(config).toHaveProperty('features')
  })

  test('getFeature() returns feature config with defaults', () => {
    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    const feature = service.getFeature('nonexistent')

    expect(feature.enabled).toBe(true)
    expect(feature.settings).toEqual({})
  })

  test('getFeature() returns configured feature', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(
      join(projectSidekick, 'features.yaml'),
      `
reminders:
  enabled: false
  settings:
    stuckThreshold: 25
`
    )

    const service = createConfigService({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    interface RemindersSettings {
      stuckThreshold: number
    }

    const feature = service.getFeature<RemindersSettings>('reminders')

    expect(feature.enabled).toBe(false)
    expect(feature.settings.stuckThreshold).toBe(25)
  })

  test('exposes loaded sources for debugging', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: debug`)

    const service = createConfigService({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(service.sources).toContainEqual(expect.stringContaining('config.yaml'))
  })
})

// =============================================================================
// Immutability Tests
// =============================================================================

describe('loadConfig - immutability', () => {
  const tempRoot = join(tmpdir(), 'sidekick-immutable-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('config object is deeply frozen (per CONFIG-SYSTEM.md §2)', () => {
    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    // Top-level object should be frozen
    expect(Object.isFrozen(config)).toBe(true)

    // Domain objects should be frozen
    expect(Object.isFrozen(config.core)).toBe(true)
    expect(Object.isFrozen(config.llm)).toBe(true)
    expect(Object.isFrozen(config.transcript)).toBe(true)
    expect(Object.isFrozen(config.features)).toBe(true)

    // Nested objects should be frozen
    expect(Object.isFrozen(config.core.logging)).toBe(true)
    expect(Object.isFrozen(config.core.paths)).toBe(true)
  })

  test('mutation attempts fail silently or throw', () => {
    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    const originalLevel = config.core.logging.level

    // Attempt to mutate
    try {
      ;(config.core.logging as Record<string, unknown>).level = 'debug'
    } catch {
      // Expected in strict mode
    }

    expect(config.core.logging.level).toBe(originalLevel)
  })
})

// =============================================================================
// Environment Variable Tests
// =============================================================================

describe('loadConfig - environment variables', () => {
  const tempRoot = join(tmpdir(), 'sidekick-env-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('loads env file and applies to config', () => {
    const homeDir = join(tempRoot, 'home')
    const sidekickDir = join(homeDir, '.sidekick')
    mkdirSync(sidekickDir, { recursive: true })

    writeFileSync(join(sidekickDir, '.env'), 'SIDEKICK_LOG_LEVEL=debug\n')

    const config = loadConfig({ projectRoot: undefined, homeDir, assets: createMockAssets() })

    expect(config.core.logging.level).toBe('debug')
  })

  test('project .env overrides user .env', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(userSidekick, '.env'), 'SIDEKICK_LOG_LEVEL=debug\n')
    writeFileSync(join(projectSidekick, '.env'), 'SIDEKICK_LOG_LEVEL=warn\n')

    const config = loadConfig({ projectRoot: projectDir, homeDir, assets: createMockAssets() })

    expect(config.core.logging.level).toBe('warn')
  })

  test('.env.local has highest priority among env files', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, '.env'), 'SIDEKICK_LOG_LEVEL=warn\n')
    writeFileSync(join(projectSidekick, '.env.local'), 'SIDEKICK_LOG_LEVEL=debug\n')

    const config = loadConfig({ projectRoot: projectDir, homeDir, assets: createMockAssets() })

    expect(config.core.logging.level).toBe('debug')
  })

  test('maps LLM env vars correctly', () => {
    // With profile-based config, only global LLM settings can be overridden via env
    process.env.SIDEKICK_LLM_DEBUG_DUMP = 'true'

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(config.llm.global?.debugDumpEnabled).toBe(true)
  })

  test('maps transcript env vars correctly', () => {
    process.env.SIDEKICK_TRANSCRIPT_WATCH_DEBOUNCE = '200'
    process.env.SIDEKICK_TRANSCRIPT_METRICS_INTERVAL = '10000'

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(config.transcript.watchDebounceMs).toBe(200)
    expect(config.transcript.metricsPersistIntervalMs).toBe(10000)
  })
})

// =============================================================================
// Validation Tests
// =============================================================================

// =============================================================================
// External Defaults Tests
// =============================================================================

describe('loadConfig - external defaults', () => {
  const tempRoot = join(tmpdir(), 'sidekick-external-defaults-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('uses external YAML defaults as base layer when assets provided', () => {
    // Create custom defaults with some overridden values
    const mockAssets = createMockAssets({
      core: {
        logging: { level: 'debug', format: 'json', consoleEnabled: false },
        paths: { state: '.custom-state' },
        daemon: TEST_DEFAULTS.core.daemon,
        ipc: TEST_DEFAULTS.core.ipc,
        development: TEST_DEFAULTS.core.development,
      },
      llm: {
        defaultProfile: 'fast-lite',
        profiles: {
          'fast-lite': {
            provider: 'openai',
            model: 'gpt-4',
            temperature: 0.5,
            maxTokens: 4096,
            timeout: 60,
            timeoutMaxRetries: 3,
          },
        },
        global: { debugDumpEnabled: false },
      },
      transcript: { watchDebounceMs: 250, metricsPersistIntervalMs: 10000 },
    })

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: mockAssets,
    })

    expect(config.core.logging.level).toBe('debug')
    expect(config.core.logging.format).toBe('json')
    expect(config.core.paths.state).toBe('.custom-state')
    expect(config.llm.profiles['fast-lite'].provider).toBe('openai')
    expect(config.llm.profiles['fast-lite'].temperature).toBe(0.5)
    expect(config.llm.profiles['fast-lite'].timeout).toBe(60)
    expect(config.transcript.watchDebounceMs).toBe(250)
    expect(config.transcript.metricsPersistIntervalMs).toBe(10000)
  })

  test('user/project config overrides external defaults', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error`)

    // Use createMockAssets with custom core defaults
    const mockAssets = createMockAssets({
      core: {
        ...TEST_DEFAULTS.core,
        logging: { ...TEST_DEFAULTS.core.logging, level: 'debug', format: 'json' },
      },
    })

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: mockAssets,
    })

    expect(config.core.logging.level).toBe('error')
    expect(config.core.logging.format).toBe('json')
  })

  test('throws validation error when assets not provided (no YAML defaults)', () => {
    // Without assets or YAML files, required config values are missing
    expect(() =>
      loadConfig({
        projectRoot: join(tempRoot, 'project'),
        homeDir: join(tempRoot, 'home'),
      })
    ).toThrow(/Configuration validation failed/)
  })

  test('throws validation error when YAML defaults missing', () => {
    const mockAssets: AssetResolver = {
      resolve: () => null,
      resolveOrThrow: () => {
        throw new Error('not found')
      },
      resolvePath: () => null,
      resolveJson: () => null,
      resolveYaml: () => null,
      cascadeLayers: ['/mock/assets'],
    }

    // Without YAML defaults, required config values are missing
    expect(() =>
      loadConfig({
        projectRoot: join(tempRoot, 'project'),
        homeDir: join(tempRoot, 'home'),
        assets: mockAssets,
      })
    ).toThrow(/Configuration validation failed/)
  })

  test('env variables override external defaults', () => {
    process.env.SIDEKICK_LOG_LEVEL = 'warn'

    // Use createMockAssets helper with custom core override
    const mockAssets = createMockAssets({
      core: {
        ...TEST_DEFAULTS.core,
        logging: { ...TEST_DEFAULTS.core.logging, level: 'debug' },
      },
    })

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: mockAssets,
    })

    expect(config.core.logging.level).toBe('warn')
  })
})

// =============================================================================
// Feature Defaults Tests
// =============================================================================

describe('ConfigService - getFeature with external defaults', () => {
  const tempRoot = join(tmpdir(), 'sidekick-feature-defaults-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('getFeature returns YAML defaults when no user config', () => {
    const mockAssets = createMockAssets({
      features: {
        statusline: {
          enabled: true,
          settings: {
            format: '[{model}] | {tokens}',
            confidenceThreshold: 0.6,
            thresholds: { tokens: { warning: 100000 } },
          },
        },
      },
    })

    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: mockAssets,
    })

    interface StatuslineSettings {
      format: string
      confidenceThreshold: number
      thresholds: { tokens: { warning: number } }
    }

    const feature = service.getFeature<StatuslineSettings>('statusline')

    expect(feature.enabled).toBe(true)
    expect(feature.settings.format).toBe('[{model}] | {tokens}')
    expect(feature.settings.confidenceThreshold).toBe(0.6)
    expect(feature.settings.thresholds).toEqual({ tokens: { warning: 100000 } })
  })

  test('user config overrides feature defaults', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // User overrides enabled and format
    writeFileSync(
      join(projectSidekick, 'features.yaml'),
      `
statusline:
  enabled: false
  settings:
    format: "custom format"
`
    )

    const mockAssets = createMockAssets({
      features: {
        statusline: {
          enabled: true,
          settings: {
            format: '[{model}] | {tokens}',
            confidenceThreshold: 0.6,
          },
        },
      },
    })

    const service = createConfigService({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: mockAssets,
    })

    interface StatuslineSettings {
      format: string
      confidenceThreshold: number
    }

    const feature = service.getFeature<StatuslineSettings>('statusline')

    // User overrides should take precedence
    expect(feature.enabled).toBe(false)
    expect(feature.settings.format).toBe('custom format')
    // Defaults should still apply for non-overridden settings
    expect(feature.settings.confidenceThreshold).toBe(0.6)
  })

  test('getFeature falls back gracefully when feature YAML missing', () => {
    // No feature defaults provided - tests fallback behavior
    const mockAssets = createMockAssets()

    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
      assets: mockAssets,
    })

    const feature = service.getFeature('nonexistent')

    // Should return standard defaults
    expect(feature.enabled).toBe(true)
    expect(feature.settings).toEqual({})
  })

  test('deep merges feature settings correctly', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // User only overrides one nested value
    writeFileSync(
      join(projectSidekick, 'features.yaml'),
      `
statusline:
  settings:
    thresholds:
      tokens:
        warning: 50000
`
    )

    const mockAssets = createMockAssets({
      features: {
        statusline: {
          enabled: true,
          settings: {
            format: '[{model}]',
            thresholds: {
              tokens: { warning: 100000, critical: 160000 },
              cost: { warning: 0.5, critical: 1.0 },
            },
          },
        },
      },
    })

    const service = createConfigService({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: mockAssets,
    })

    interface StatuslineSettings {
      format: string
      thresholds: {
        tokens: { warning: number; critical: number }
        cost: { warning: number; critical: number }
      }
    }

    const feature = service.getFeature<StatuslineSettings>('statusline')

    // User override should take precedence
    expect(feature.settings.thresholds.tokens.warning).toBe(50000)
    // Other nested values should be preserved from defaults
    expect(feature.settings.thresholds.tokens.critical).toBe(160000)
    expect(feature.settings.thresholds.cost).toEqual({ warning: 0.5, critical: 1.0 })
    // Format should come from defaults
    expect(feature.settings.format).toBe('[{model}]')
  })
})

describe('loadConfig - validation', () => {
  const tempRoot = join(tmpdir(), 'sidekick-validation-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('throws validation error for invalid log level', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: invalid`)

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
        assets: createMockAssets(),
      })
    ).toThrow(/level/)
  })

  test('throws validation error for invalid LLM provider', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Override the default profile's provider with an invalid value
    writeFileSync(
      join(projectSidekick, 'llm.yaml'),
      `
profiles:
  fast-lite:
    provider: invalid-provider
    model: test
    temperature: 0
    maxTokens: 1000
    timeout: 30
    timeoutMaxRetries: 2
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
        assets: createMockAssets(),
      })
    ).toThrow(/provider/)
  })

  test('throws validation error for temperature out of range', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Override the default profile's temperature with out-of-range value
    writeFileSync(
      join(projectSidekick, 'llm.yaml'),
      `
profiles:
  fast-lite:
    provider: openrouter
    model: test
    temperature: 5.0
    maxTokens: 1000
    timeout: 30
    timeoutMaxRetries: 2
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
        assets: createMockAssets(),
      })
    ).toThrow(/temperature/)
  })

  test('throws validation error for timeout out of range', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Override the default profile's timeout with out-of-range value
    writeFileSync(
      join(projectSidekick, 'llm.yaml'),
      `
profiles:
  fast-lite:
    provider: openrouter
    model: test
    temperature: 0
    maxTokens: 1000
    timeout: 500
    timeoutMaxRetries: 2
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
        assets: createMockAssets(),
      })
    ).toThrow(/timeout/)
  })

  test('throws validation error for invalid profile reference in feature config', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Feature references a profile that doesn't exist
    writeFileSync(
      join(projectSidekick, 'features.yaml'),
      `
session-summary:
  enabled: true
  settings:
    llm:
      sessionSummary:
        profile: nonexistent-profile
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
        assets: createMockAssets(),
      })
    ).toThrow(/Unknown profile "nonexistent-profile"/)
  })

  test('throws validation error when profile references fallback as primary', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Add the fallback to llm config so it exists
    writeFileSync(
      join(projectSidekick, 'llm.yaml'),
      `
fallbacks:
  cheap-fallback:
    provider: openrouter
    model: test-model
    temperature: 0
    maxTokens: 1000
    timeout: 30
    timeoutMaxRetries: 2
`
    )

    // Feature uses fallback profile ID as primary profile
    writeFileSync(
      join(projectSidekick, 'features.yaml'),
      `
session-summary:
  enabled: true
  settings:
    llm:
      sessionSummary:
        profile: cheap-fallback
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
        assets: createMockAssets(),
      })
    ).toThrow(/is a fallback profile, not a primary profile/)
  })

  test('throws validation error for invalid fallback profile reference', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Feature references a fallback that doesn't exist
    writeFileSync(
      join(projectSidekick, 'features.yaml'),
      `
session-summary:
  enabled: true
  settings:
    llm:
      sessionSummary:
        profile: fast-lite
        fallbackProfile: nonexistent-fallback
`
    )

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
        assets: createMockAssets(),
      })
    ).toThrow(/Unknown fallback "nonexistent-fallback"/)
  })

  test('passes validation with valid profile references', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    // Set up valid profiles including the default profile
    writeFileSync(
      join(projectSidekick, 'llm.yaml'),
      `
defaultProfile: custom-profile
profiles:
  custom-profile:
    provider: openrouter
    model: test-model
    temperature: 0.5
    maxTokens: 2000
    timeout: 30
    timeoutMaxRetries: 2
fallbacks:
  custom-fallback:
    provider: openrouter
    model: fallback-model
    temperature: 0
    maxTokens: 1000
    timeout: 30
    timeoutMaxRetries: 2
`
    )

    // Feature references valid profiles
    writeFileSync(
      join(projectSidekick, 'features.yaml'),
      `
session-summary:
  enabled: true
  settings:
    llm:
      sessionSummary:
        profile: custom-profile
        fallbackProfile: custom-fallback
`
    )

    // Should not throw
    const config = loadConfig({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
      assets: createMockAssets(),
    })

    expect(config.llm.profiles['custom-profile']).toBeDefined()
    expect(config.llm.fallbacks['custom-fallback']).toBeDefined()
  })
})
