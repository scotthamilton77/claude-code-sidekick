import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, test } from 'vitest'

import type { ConfigServiceOptions } from '../config'
import { createConfigService, loadConfig, type SidekickConfig } from '../config'

// File-level env var isolation to prevent test pollution across describe blocks
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

describe('loadConfig', () => {
  const tempRoot = join(tmpdir(), 'sidekick-config-tests')

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

    expect(config.logLevel).toBe('info')
    expect(config.features.statusline).toBe(true)
    expect(config.features.sessionSummary).toBe(true)
  })

  test('loads env file and applies to config', () => {
    const homeDir = join(tempRoot, 'home')
    const sidekickDir = join(homeDir, '.sidekick')
    mkdirSync(sidekickDir, { recursive: true })

    writeFileSync(join(sidekickDir, '.env'), 'SIDEKICK_LOG_LEVEL=debug\n')

    const config = loadConfig({ projectRoot: undefined, homeDir })

    expect(config.logLevel).toBe('debug')
  })

  test('JSONC config overrides env variables', () => {
    const homeDir = join(tempRoot, 'home')
    const sidekickDir = join(homeDir, '.sidekick')
    mkdirSync(sidekickDir, { recursive: true })

    writeFileSync(join(sidekickDir, '.env'), 'SIDEKICK_LOG_LEVEL=debug\n')
    writeFileSync(
      join(sidekickDir, 'config.jsonc'),
      `{
  // Override log level
  "logLevel": "warn"
}`
    )

    const config = loadConfig({ projectRoot: undefined, homeDir })

    expect(config.logLevel).toBe('warn')
  })

  test('project config overrides user config', () => {
    const homeDir = join(tempRoot, 'home')
    const projectDir = join(tempRoot, 'project')
    const userSidekick = join(homeDir, '.sidekick')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(userSidekick, { recursive: true })
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(userSidekick, 'config.jsonc'), `{ "logLevel": "warn", "features": { "statusline": false } }`)
    writeFileSync(join(projectSidekick, 'config.jsonc'), `{ "logLevel": "error" }`)

    const config = loadConfig({ projectRoot: projectDir, homeDir })

    expect(config.logLevel).toBe('error')
    // User setting for features should still apply (deep merge)
    expect(config.features.statusline).toBe(false)
  })

  test('project-local .local variant has highest priority', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.jsonc'), `{ "logLevel": "warn" }`)
    writeFileSync(join(projectSidekick, 'config.jsonc.local'), `{ "logLevel": "debug" }`)

    const config = loadConfig({ projectRoot: projectDir, homeDir: join(tempRoot, 'home') })

    expect(config.logLevel).toBe('debug')
  })

  test('deep merges object properties', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(
      join(projectSidekick, 'config.jsonc'),
      `{
  "features": {
    "statusline": true,
    "sessionSummary": false
  },
  "llm": {
    "provider": "openrouter",
    "timeout": 30
  }
}`
    )

    writeFileSync(
      join(projectSidekick, 'config.jsonc.local'),
      `{
  "features": {
    "resume": false
  },
  "llm": {
    "timeout": 60
  }
}`
    )

    const config = loadConfig({ projectRoot: projectDir, homeDir: join(tempRoot, 'home') })

    expect(config.features.statusline).toBe(true)
    expect(config.features.sessionSummary).toBe(false)
    expect(config.features.resume).toBe(false)
    expect(config.llm.provider).toBe('openrouter')
    expect(config.llm.timeout).toBe(60)
  })

  test('throws validation error for invalid config values', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.jsonc'), `{ "logLevel": "invalid-level" }`)

    expect(() => loadConfig({ projectRoot: projectDir, homeDir: join(tempRoot, 'home') })).toThrow(/logLevel/)
  })

  test('throws clear error for malformed JSONC', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.jsonc'), `{ "logLevel": "info", }`) // trailing comma is OK in JSONC
    writeFileSync(join(projectSidekick, 'config.jsonc.local'), `{ not valid json at all`)

    expect(() => loadConfig({ projectRoot: projectDir, homeDir: join(tempRoot, 'home') })).toThrow(/parse|syntax/i)
  })

  test('config object is deeply frozen (immutable per LLD-CONFIG-SYSTEM §2)', () => {
    const config = loadConfig({
      projectRoot: join(tempRoot, 'empty-project'),
      homeDir: join(tempRoot, 'empty-home'),
    })

    // Top-level object should be frozen
    expect(Object.isFrozen(config)).toBe(true)

    // Nested objects should also be frozen
    expect(Object.isFrozen(config.features)).toBe(true)
    expect(Object.isFrozen(config.llm)).toBe(true)
    expect(Object.isFrozen(config.sessionSummary)).toBe(true)
    expect(Object.isFrozen(config.llm.circuitBreaker)).toBe(true)

    // Verify mutation attempts fail (throws in strict mode, silently fails in sloppy mode)
    const originalLogLevel = config.logLevel
    try {
      ;(config as Record<string, unknown>).logLevel = 'debug'
    } catch {
      // Expected in strict mode
    }
    expect(config.logLevel).toBe(originalLogLevel)

    const originalTimeout = config.llm.timeout
    try {
      ;(config.llm as Record<string, unknown>).timeout = 999
    } catch {
      // Expected in strict mode
    }
    expect(config.llm.timeout).toBe(originalTimeout)
  })

  test('rejects unknown keys at top level (strict mode per LLD-SCHEMA-CONTRACTS §6.4)', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(join(projectSidekick, 'config.jsonc'), `{ "logLevel": "info", "unknownKey": "should fail" }`)

    expect(() => loadConfig({ projectRoot: projectDir, homeDir: join(tempRoot, 'home') })).toThrow(
      /unrecognized|unknown/i
    )
  })

  test('rejects unknown keys in nested objects (strict mode)', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })

    writeFileSync(
      join(projectSidekick, 'config.jsonc'),
      `{ "features": { "statusline": true, "unknownFeature": true } }`
    )

    expect(() => loadConfig({ projectRoot: projectDir, homeDir: join(tempRoot, 'home') })).toThrow(
      /unrecognized|unknown/i
    )
  })
})

describe('ConfigService', () => {
  const tempRoot = join(tmpdir(), 'sidekick-config-service-tests')

  beforeEach(() => {
    mkdirSync(tempRoot, { recursive: true })
  })

  afterEach(() => {
    if (existsSync(tempRoot)) {
      rmSync(tempRoot, { recursive: true, force: true })
    }
  })

  test('get() returns typed config values', () => {
    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    expect(service.get('logLevel')).toBe('info')
    expect(typeof service.get('features')).toBe('object')
  })

  test('getAll() returns full config object', () => {
    const service = createConfigService({
      projectRoot: join(tempRoot, 'project'),
      homeDir: join(tempRoot, 'home'),
    })

    const config = service.getAll()

    expect(config).toHaveProperty('logLevel')
    expect(config).toHaveProperty('features')
    expect(config).toHaveProperty('llm')
  })

  test('exposes loaded sources for debugging', () => {
    const projectDir = join(tempRoot, 'project')
    const projectSidekick = join(projectDir, '.sidekick')
    mkdirSync(projectSidekick, { recursive: true })
    writeFileSync(join(projectSidekick, 'config.jsonc'), `{ "logLevel": "warn" }`)

    const service = createConfigService({
      projectRoot: projectDir,
      homeDir: join(tempRoot, 'home'),
    })

    expect(service.sources).toContainEqual(expect.stringContaining('config.jsonc'))
  })
})
