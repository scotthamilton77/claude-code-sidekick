/**
 * Tests for pure functions and constants extracted from Daemon class.
 *
 * @see daemon-helpers.ts
 */
import { describe, expect, it, vi } from 'vitest'
import {
  VERSION,
  IDLE_CHECK_INTERVAL_MS,
  HEARTBEAT_INTERVAL_MS,
  EVICTION_INTERVAL_MS,
  REGISTRY_HEARTBEAT_INTERVAL_MS,
  diffConfigs,
  resolveTranscriptPath,
  getPersonaInjectionEnabled,
} from '../daemon-helpers.js'
import type { SidekickConfig, ConfigService, Logger } from '@sidekick/core'

// ── Constants ───────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('VERSION should be a semver-like string', () => {
    expect(typeof VERSION).toBe('string')
    expect(VERSION).toMatch(/^\d+\.\d+\.\d+/)
  })

  it('IDLE_CHECK_INTERVAL_MS should be 30 seconds', () => {
    expect(IDLE_CHECK_INTERVAL_MS).toBe(30_000)
  })

  it('HEARTBEAT_INTERVAL_MS should be 5 seconds', () => {
    expect(HEARTBEAT_INTERVAL_MS).toBe(5_000)
  })

  it('EVICTION_INTERVAL_MS should be 5 minutes', () => {
    expect(EVICTION_INTERVAL_MS).toBe(300_000)
  })

  it('REGISTRY_HEARTBEAT_INTERVAL_MS should be 1 hour', () => {
    expect(REGISTRY_HEARTBEAT_INTERVAL_MS).toBe(3_600_000)
  })
})

// ── diffConfigs ─────────────────────────────────────────────────────────────

describe('diffConfigs', () => {
  const base = { core: { logging: { level: 'info' } } } as unknown as SidekickConfig

  it('should return empty array for identical objects', () => {
    const result = diffConfigs(base, base)
    expect(result).toEqual([])
  })

  it('should detect flat value change', () => {
    const oldCfg = { a: 1 } as unknown as SidekickConfig
    const newCfg = { a: 2 } as unknown as SidekickConfig
    const result = diffConfigs(oldCfg, newCfg)
    expect(result).toEqual([{ path: 'a', old: 1, new: 2 }])
  })

  it('should detect nested change', () => {
    const oldCfg = { core: { logging: { level: 'info' } } } as unknown as SidekickConfig
    const newCfg = { core: { logging: { level: 'debug' } } } as unknown as SidekickConfig
    const result = diffConfigs(oldCfg, newCfg)
    expect(result).toEqual([{ path: 'core.logging.level', old: 'info', new: 'debug' }])
  })

  it('should detect added key', () => {
    const oldCfg = { a: 1 } as unknown as SidekickConfig
    const newCfg = { a: 1, b: 2 } as unknown as SidekickConfig
    const result = diffConfigs(oldCfg, newCfg)
    expect(result).toEqual([{ path: 'b', old: undefined, new: 2 }])
  })

  it('should detect removed key', () => {
    const oldCfg = { a: 1, b: 2 } as unknown as SidekickConfig
    const newCfg = { a: 1 } as unknown as SidekickConfig
    const result = diffConfigs(oldCfg, newCfg)
    expect(result).toEqual([{ path: 'b', old: 2, new: undefined }])
  })

  it('should detect array change', () => {
    const oldCfg = { items: [1, 2, 3] } as unknown as SidekickConfig
    const newCfg = { items: [1, 2, 4] } as unknown as SidekickConfig
    const result = diffConfigs(oldCfg, newCfg)
    expect(result).toEqual([{ path: 'items', old: [1, 2, 3], new: [1, 2, 4] }])
  })
})

// ── resolveTranscriptPath ───────────────────────────────────────────────────

vi.mock('@sidekick/core', async (importOriginal) => {
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  const actual = (await importOriginal()) as Record<string, unknown>
  return {
    ...actual,
    reconstructTranscriptPath: vi.fn().mockReturnValue('/mock/transcript/path'),
  }
})

describe('resolveTranscriptPath', () => {
  const mockLogger = {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn() as any,
  } as Logger

  it('should return the provided path when given', () => {
    const result = resolveTranscriptPath('/project', 'sess-1', '/custom/path', mockLogger)
    expect(result).toBe('/custom/path')
  })

  it('should call reconstructTranscriptPath when no path is provided', async () => {
    const { reconstructTranscriptPath: mockReconstruct } = await import('@sidekick/core')
    const result = resolveTranscriptPath('/project', 'sess-1', undefined, mockLogger)
    expect(result).toBe('/mock/transcript/path')
    expect(mockReconstruct).toHaveBeenCalledWith('/project', 'sess-1')
  })
})

// ── getPersonaInjectionEnabled ──────────────────────────────────────────────

describe('getPersonaInjectionEnabled', () => {
  function makeConfig(value?: boolean): ConfigService {
    return {
      getFeature: () => ({
        enabled: true,
        settings: value !== undefined ? { personas: { injectPersonaIntoClaude: value } } : {},
      }),
    } as unknown as ConfigService
  }

  it('should return true when explicitly enabled', () => {
    expect(getPersonaInjectionEnabled(makeConfig(true))).toBe(true)
  })

  it('should return false when explicitly disabled', () => {
    expect(getPersonaInjectionEnabled(makeConfig(false))).toBe(false)
  })

  it('should default to true when config is missing', () => {
    expect(getPersonaInjectionEnabled(makeConfig())).toBe(true)
  })
})
