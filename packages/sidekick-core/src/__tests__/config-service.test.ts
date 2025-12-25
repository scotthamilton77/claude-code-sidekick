/**
 * Configuration Service Tests
 *
 * Tests the YAML-based configuration system per docs/design/CONFIG-SYSTEM.md.
 * Covers:
 * - YAML parsing (valid/invalid domain files)
 * - Domain file cascade precedence
 * - sidekick.config dot-notation parsing
 * - Derived path helpers
 * - ConfigService interface
 * - Immutability requirements
 */

import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import {
  createConfigService,
  createDerivedPaths,
  loadConfig,
  parseUnifiedConfig,
  type CoreConfig,
  type SidekickConfig,
} from '../config'

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

    expect(result.llm).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
    expect(result.core).toEqual({
      logging: { level: 'debug' },
    })
  })

  test('skips comments and empty lines', () => {
    const content = `
# This is a comment
llm.provider=openai

# Another comment
llm.model=gpt-4o
`
    const result = parseUnifiedConfig(content)

    expect(result.llm).toEqual({
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

    expect(result.llm?.debugDumpEnabled).toBe(true)
    expect(result.features?.reminders).toEqual({ enabled: false })
  })

  test('coerces numeric values', () => {
    const content = `
llm.temperature=0.7
llm.timeout=60
transcript.watchDebounceMs=200
`
    const result = parseUnifiedConfig(content)

    expect(result.llm?.temperature).toBe(0.7)
    expect(result.llm?.timeout).toBe(60)
    expect(result.transcript?.watchDebounceMs).toBe(200)
  })

  test('parses JSON arrays', () => {
    const content = `features.test.settings.items=["a","b","c"]`
    const result = parseUnifiedConfig(content)

    expect(result.features?.test).toEqual({
      settings: { items: ['a', 'b', 'c'] },
    })
  })

  test('parses JSON objects', () => {
    const content = `features.test.settings.nested={"key":"value","num":42}`
    const result = parseUnifiedConfig(content)

    expect(result.features?.test).toEqual({
      settings: { nested: { key: 'value', num: 42 } },
    })
  })

  test('handles quoted strings', () => {
    const content = `
llm.model="gpt-4o-mini"
core.paths.state='custom-state'
`
    const result = parseUnifiedConfig(content)

    expect(result.llm?.model).toBe('gpt-4o-mini')
    expect(result.core?.paths).toEqual({ state: 'custom-state' })
  })

  test('ignores malformed lines', () => {
    const content = `
llm.provider=openai
invalid line without equals
single.key
=value without key
llm.model=gpt-4o
`
    const result = parseUnifiedConfig(content)

    expect(result.llm).toEqual({
      provider: 'openai',
      model: 'gpt-4o',
    })
  })

  test('builds deeply nested structures', () => {
    const content = `features.reminders.settings.thresholds.stuck=40`
    const result = parseUnifiedConfig(content)

    expect(result.features?.reminders).toEqual({
      settings: {
        thresholds: { stuck: 40 },
      },
    })
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

  test('returns defaults when no config files exist', () => {
    const config = loadConfig({
      projectRoot: join(tempRoot, 'empty-project'),
      homeDir: join(tempRoot, 'empty-home'),
    })

    // Core defaults
    expect(config.core.logging.level).toBe('info')
    expect(config.core.logging.format).toBe('pretty')
    expect(config.core.paths.state).toBe('.sidekick')

    // LLM defaults
    expect(config.llm.provider).toBe('openrouter')
    expect(config.llm.temperature).toBe(0)
    expect(config.llm.timeout).toBe(30)

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
    })

    // Should fall back to defaults
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
    })

    expect(config.core.logging.level).toBe('warn')
  })

  test('user domain YAML overrides user unified config', () => {
    const homeDir = join(tempRoot, 'home')
    const userSidekick = join(homeDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })

    writeFileSync(join(userSidekick, 'sidekick.config'), `core.logging.level=warn`)
    writeFileSync(join(userSidekick, 'config.yaml'), `logging:\n  level: error`)

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir,
    })

    expect(config.core.logging.level).toBe('error')
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
    })

    expect(config.core.logging.level).toBe('error')
  })

  test('project domain YAML overrides project unified config', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'sidekick.config'), `core.logging.level=warn`)
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: error`)

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir,
    })

    expect(config.core.logging.level).toBe('error')
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

    // User sets LLM config
    writeFileSync(
      join(userSidekick, 'llm.yaml'),
      `
provider: openai
model: gpt-4o
`
    )

    // Project sets core config and overrides LLM provider
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: debug`)
    writeFileSync(join(projectSidekick, 'llm.yaml'), `provider: openrouter`)

    const config = loadConfig({
      projectRoot: projectDir,
      homeDir,
    })

    // Core from project
    expect(config.core.logging.level).toBe('debug')
    // LLM: provider from project, model from user
    expect(config.llm.provider).toBe('openrouter')
    expect(config.llm.model).toBe('gpt-4o')
  })
})

// =============================================================================
// Derived Paths Tests
// =============================================================================

describe('createDerivedPaths', () => {
  const DEFAULT_SUPERVISOR = { idleTimeoutMs: 300000, shutdownTimeoutMs: 30000 }

  test('generates correct session root path', () => {
    const coreConfig: CoreConfig = {
      logging: { level: 'info', format: 'pretty', consoleEnabled: false },
      paths: { state: '.sidekick' },
      supervisor: DEFAULT_SUPERVISOR,
      ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    }

    const paths = createDerivedPaths(coreConfig, '/project')

    expect(paths.sessionRoot('abc123')).toBe('/project/.sidekick/sessions/abc123')
  })

  test('generates correct staging root path', () => {
    const coreConfig: CoreConfig = {
      logging: { level: 'info', format: 'pretty', consoleEnabled: false },
      paths: { state: '.sidekick' },
      supervisor: DEFAULT_SUPERVISOR,
      ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    }

    const paths = createDerivedPaths(coreConfig, '/project')

    expect(paths.stagingRoot('abc123')).toBe('/project/.sidekick/sessions/abc123/stage')
  })

  test('generates correct hook staging path', () => {
    const coreConfig: CoreConfig = {
      logging: { level: 'info', format: 'pretty', consoleEnabled: false },
      paths: { state: '.sidekick' },
      supervisor: DEFAULT_SUPERVISOR,
      ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    }

    const paths = createDerivedPaths(coreConfig, '/project')

    expect(paths.hookStaging('abc123', 'UserPromptSubmit')).toBe(
      '/project/.sidekick/sessions/abc123/stage/UserPromptSubmit'
    )
  })

  test('generates correct session state path', () => {
    const coreConfig: CoreConfig = {
      logging: { level: 'info', format: 'pretty', consoleEnabled: false },
      paths: { state: '.sidekick' },
      supervisor: DEFAULT_SUPERVISOR,
      ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    }

    const paths = createDerivedPaths(coreConfig, '/project')

    expect(paths.sessionState('abc123', 'session-summary.json')).toBe(
      '/project/.sidekick/sessions/abc123/state/session-summary.json'
    )
  })

  test('generates correct logs directory path', () => {
    const coreConfig: CoreConfig = {
      logging: { level: 'info', format: 'pretty', consoleEnabled: false },
      paths: { state: '.sidekick' },
      supervisor: DEFAULT_SUPERVISOR,
      ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    }

    const paths = createDerivedPaths(coreConfig, '/project')

    expect(paths.logsDir()).toBe('/project/.sidekick/logs')
  })

  test('respects custom state path', () => {
    const coreConfig: CoreConfig = {
      logging: { level: 'info', format: 'pretty', consoleEnabled: false },
      paths: { state: 'custom/state' },
      supervisor: DEFAULT_SUPERVISOR,
      ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    }

    const paths = createDerivedPaths(coreConfig, '/project')

    expect(paths.sessionRoot('abc123')).toBe('/project/custom/state/sessions/abc123')
    expect(paths.logsDir()).toBe('/project/custom/state/logs')
  })

  test('works without project root', () => {
    const coreConfig: CoreConfig = {
      logging: { level: 'info', format: 'pretty', consoleEnabled: false },
      paths: { state: '.sidekick' },
      supervisor: DEFAULT_SUPERVISOR,
      ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
    }

    const paths = createDerivedPaths(coreConfig)

    expect(paths.sessionRoot('abc123')).toBe('.sidekick/sessions/abc123')
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
    })

    expect(service.core.logging.level).toBe('info')
    expect(service.llm.provider).toBe('openrouter')
    expect(service.transcript.watchDebounceMs).toBe(100)
    expect(service.features).toEqual({})
  })

  test('getAll() returns full config object', () => {
    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
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
    })

    interface RemindersSettings {
      stuckThreshold: number
    }

    const feature = service.getFeature<RemindersSettings>('reminders')

    expect(feature.enabled).toBe(false)
    expect(feature.settings.stuckThreshold).toBe(25)
  })

  test('provides derived paths', () => {
    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    expect(service.paths.sessionRoot('test')).toContain('sessions/test')
    expect(service.paths.hookStaging('test', 'PreToolUse')).toContain('stage/PreToolUse')
  })

  test('exposes loaded sources for debugging', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })
    writeFileSync(join(projectSidekick, 'config.yaml'), `logging:\n  level: debug`)

    const service = createConfigService({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
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

    const config = loadConfig({ projectRoot: undefined, homeDir })

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

    const config = loadConfig({ projectRoot: projectDir, homeDir })

    expect(config.core.logging.level).toBe('warn')
  })

  test('.env.local has highest priority among env files', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, '.env'), 'SIDEKICK_LOG_LEVEL=warn\n')
    writeFileSync(join(projectSidekick, '.env.local'), 'SIDEKICK_LOG_LEVEL=debug\n')

    const config = loadConfig({ projectRoot: projectDir, homeDir })

    expect(config.core.logging.level).toBe('debug')
  })

  test('maps LLM env vars correctly', () => {
    process.env.SIDEKICK_LLM_PROVIDER = 'openai'
    process.env.SIDEKICK_LLM_TIMEOUT = '60'
    process.env.SIDEKICK_LLM_TEMPERATURE = '0.5'

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    expect(config.llm.provider).toBe('openai')
    expect(config.llm.timeout).toBe(60)
    expect(config.llm.temperature).toBe(0.5)
  })

  test('maps transcript env vars correctly', () => {
    process.env.SIDEKICK_TRANSCRIPT_WATCH_DEBOUNCE = '200'
    process.env.SIDEKICK_TRANSCRIPT_METRICS_INTERVAL = '10000'

    const config = loadConfig({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    expect(config.transcript.watchDebounceMs).toBe(200)
    expect(config.transcript.metricsPersistIntervalMs).toBe(10000)
  })
})

// =============================================================================
// Validation Tests
// =============================================================================

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
      })
    ).toThrow(/level/)
  })

  test('throws validation error for invalid LLM provider', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'llm.yaml'), `provider: invalid-provider`)

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
      })
    ).toThrow(/provider/)
  })

  test('throws validation error for temperature out of range', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'llm.yaml'), `temperature: 2.0`)

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
      })
    ).toThrow(/temperature/)
  })

  test('throws validation error for timeout out of range', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'llm.yaml'), `timeout: 500`)

    expect(() =>
      loadConfig({
        projectRoot: projectDir,
        homeDir: join(tempRoot, 'home'),
      })
    ).toThrow(/timeout/)
  })
})
