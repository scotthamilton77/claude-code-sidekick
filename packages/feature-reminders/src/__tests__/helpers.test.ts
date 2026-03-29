/**
 * Tests for extracted helper functions
 *
 * Covers:
 * - getRemindersConfig: config read+merge helper
 * - checkShouldReactivate: turn-based reactivation check
 * - resolveReminder structured logging (logger option)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getRemindersConfig, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../types'
import { checkShouldReactivate } from '../handlers/staging/staging-handler-utils'
import { resolveReminder } from '../reminder-utils'

// ============================================================================
// getRemindersConfig
// ============================================================================

describe('getRemindersConfig', () => {
  it('returns defaults when feature has no settings', () => {
    const configSource = {
      getFeature: vi.fn().mockReturnValue({ enabled: true, settings: undefined }),
    }

    const result = getRemindersConfig(configSource)

    expect(result.pause_and_reflect_threshold).toBe(DEFAULT_REMINDERS_SETTINGS.pause_and_reflect_threshold)
    expect(result.source_code_patterns).toEqual(DEFAULT_REMINDERS_SETTINGS.source_code_patterns)
    expect(configSource.getFeature).toHaveBeenCalledWith('reminders')
  })

  it('merges user settings over defaults', () => {
    const userSettings: Partial<RemindersSettings> = {
      pause_and_reflect_threshold: 100,
      max_verification_cycles: 3,
    }
    const configSource = {
      getFeature: vi.fn().mockReturnValue({ enabled: true, settings: userSettings }),
    }

    const result = getRemindersConfig(configSource)

    expect(result.pause_and_reflect_threshold).toBe(100)
    expect(result.max_verification_cycles).toBe(3)
    // Defaults still present for unset fields
    expect(result.source_code_patterns).toEqual(DEFAULT_REMINDERS_SETTINGS.source_code_patterns)
  })

  it('handles empty settings object', () => {
    const configSource = {
      getFeature: vi.fn().mockReturnValue({ enabled: true, settings: {} }),
    }

    const result = getRemindersConfig(configSource)

    expect(result).toEqual(DEFAULT_REMINDERS_SETTINGS)
  })
})

// ============================================================================
// checkShouldReactivate
// ============================================================================

describe('checkShouldReactivate', () => {
  it('returns true when current turn is newer', () => {
    const result = checkShouldReactivate({ turnCount: 5, toolsThisTurn: 10 }, 3)
    expect(result).toBe(true)
  })

  it('returns false when same turn and no threshold check', () => {
    const result = checkShouldReactivate({ turnCount: 3, toolsThisTurn: 10 }, 3)
    expect(result).toBe(false)
  })

  it('returns false when older turn and no threshold check', () => {
    // Shouldn't happen in practice but tests the boundary
    const result = checkShouldReactivate({ turnCount: 2, toolsThisTurn: 10 }, 3)
    expect(result).toBe(false)
  })

  it('returns true when threshold exceeded on same turn', () => {
    const result = checkShouldReactivate({ turnCount: 3, toolsThisTurn: 80 }, 3, {
      effectiveBaseline: 10,
      threshold: 60,
    })
    expect(result).toBe(true)
  })

  it('returns false when below threshold on same turn', () => {
    const result = checkShouldReactivate({ turnCount: 3, toolsThisTurn: 50 }, 3, {
      effectiveBaseline: 10,
      threshold: 60,
    })
    expect(result).toBe(false)
  })

  it('returns true when exactly at threshold boundary', () => {
    const result = checkShouldReactivate({ turnCount: 3, toolsThisTurn: 70 }, 3, {
      effectiveBaseline: 10,
      threshold: 60,
    })
    expect(result).toBe(true)
  })

  it('new turn takes priority over threshold check', () => {
    // Even if below threshold, new turn should reactivate
    const result = checkShouldReactivate({ turnCount: 5, toolsThisTurn: 1 }, 3, {
      effectiveBaseline: 10,
      threshold: 60,
    })
    expect(result).toBe(true)
  })
})

// ============================================================================
// resolveReminder structured logging
// ============================================================================

describe('resolveReminder structured logging', () => {
  const testAssetsDir = '/tmp/claude/test-assets-helpers'

  beforeEach(() => {
    mkdirSync(join(testAssetsDir, 'reminders'), { recursive: true })
  })

  afterEach(() => {
    rmSync(testAssetsDir, { recursive: true, force: true })
  })

  it('uses structured logger when provided', () => {
    const malformedYaml = 'this is not: valid: yaml: content:'
    writeFileSync(join(testAssetsDir, 'reminders', 'bad.yaml'), malformedYaml)

    const mockLogger = { error: vi.fn() } as any

    const result = resolveReminder('bad', { assetsDir: testAssetsDir, logger: mockLogger })

    expect(result).toBeNull()
    expect(mockLogger.error).toHaveBeenCalledWith('Failed to load reminder', {
      reminderId: 'bad',
      error: expect.any(String),
    })
  })

  it('falls back to console.error when no logger provided', () => {
    const malformedYaml = 'this is not: valid: yaml: content:'
    writeFileSync(join(testAssetsDir, 'reminders', 'bad2.yaml'), malformedYaml)

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const result = resolveReminder('bad2', { assetsDir: testAssetsDir })

    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining('Failed to load reminder bad2'), expect.any(Error))
    consoleSpy.mockRestore()
  })
})
