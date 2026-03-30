/**
 * Tests for transcript-persistence module.
 *
 * Validates metrics persistence, state recovery, compaction history,
 * and path generation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  persistMetrics,
  loadPersistedState,
  getMetricsStatePath,
  persistCompactionHistory,
  loadCompactionHistory,
  getCompactionHistoryPath,
  schedulePersistence,
} from '../transcript-persistence'
import { createDefaultMetrics } from '../transcript-helpers'
import { StateNotFoundError } from '../state/index'
import type { Logger, MinimalStateService } from '@sidekick/types'

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn(() => createMockLogger()),
    flush: vi.fn(() => Promise.resolve()),
  }
}

function createMockStateService(storage: Map<string, unknown> = new Map()): MinimalStateService {
  return {
    write: vi.fn((path: string, data: unknown) => {
      storage.set(path, data)
      return Promise.resolve()
    }) as any,
    read: vi.fn((path: string, _schema: unknown, defaultValue?: unknown) => {
      const data = storage.get(path)
      if (!data && defaultValue === undefined) {
        throw new StateNotFoundError(path)
      }
      return Promise.resolve({ data: data ?? defaultValue, source: 'file' })
    }) as any,
    delete: vi.fn() as any,
    sessionStatePath: vi.fn() as any,
    globalStatePath: vi.fn() as any,
    rootDir: vi.fn() as any,
    sessionsDir: vi.fn() as any,
    sessionRootDir: vi.fn() as any,
    logsDir: vi.fn() as any,
  }
}

// ============================================================================
// getMetricsStatePath
// ============================================================================

describe('getMetricsStatePath', () => {
  it('returns null for null sessionId', () => {
    expect(getMetricsStatePath(null, '/state')).toBeNull()
  })

  it('constructs correct path', () => {
    const path = getMetricsStatePath('session-123', '/state')
    expect(path).toBe('/state/sessions/session-123/state/transcript-metrics.json')
  })
})

// ============================================================================
// getCompactionHistoryPath
// ============================================================================

describe('getCompactionHistoryPath', () => {
  it('returns null for null sessionId', () => {
    expect(getCompactionHistoryPath(null, '/state')).toBeNull()
  })

  it('constructs correct path', () => {
    const path = getCompactionHistoryPath('session-123', '/state')
    expect(path).toBe('/state/sessions/session-123/state/compaction-history.json')
  })
})

// ============================================================================
// persistMetrics
// ============================================================================

describe('persistMetrics', () => {
  let logger: Logger

  beforeEach(() => {
    logger = createMockLogger()
  })

  it('persists metrics and returns new timestamp', async () => {
    const stateService = createMockStateService()
    const metrics = createDefaultMetrics()
    metrics.turnCount = 5

    const result = await persistMetrics('session-1', metrics, 1000, stateService, '/state', false, 0, 100, logger)

    expect(result).toBeGreaterThan(0)
    expect(stateService.write).toHaveBeenCalled()
  })

  it('skips persistence when too recent and not immediate', async () => {
    const stateService = createMockStateService()
    const metrics = createDefaultMetrics()

    const result = await persistMetrics(
      'session-1',
      metrics,
      1000,
      stateService,
      '/state',
      false,
      Date.now(),
      5000,
      logger
    )

    expect(stateService.write).not.toHaveBeenCalled()
  })

  it('persists when immediate even if recent', async () => {
    const stateService = createMockStateService()
    const metrics = createDefaultMetrics()

    const result = await persistMetrics(
      'session-1',
      metrics,
      1000,
      stateService,
      '/state',
      true,
      Date.now(),
      5000,
      logger
    )

    expect(stateService.write).toHaveBeenCalled()
  })

  it('returns original timestamp on null sessionId', async () => {
    const stateService = createMockStateService()
    const metrics = createDefaultMetrics()

    const result = await persistMetrics(null, metrics, 0, stateService, '/state', true, 42, 100, logger)

    expect(result).toBe(42)
  })

  it('returns original timestamp on write error', async () => {
    const stateService = createMockStateService()
    ;(stateService.write as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('disk full'))
    const metrics = createDefaultMetrics()

    const result = await persistMetrics('session-1', metrics, 0, stateService, '/state', true, 42, 100, logger)

    expect(result).toBe(42)
    expect(logger.error).toHaveBeenCalled()
  })
})

// ============================================================================
// loadPersistedState
// ============================================================================

describe('loadPersistedState', () => {
  let logger: Logger

  beforeEach(() => {
    logger = createMockLogger()
  })

  it('returns metrics and byte offset from persisted state', async () => {
    const storage = new Map<string, unknown>()
    const metrics = createDefaultMetrics()
    metrics.turnCount = 10
    storage.set('/state/sessions/session-1/state/transcript-metrics.json', {
      sessionId: 'session-1',
      metrics,
      persistedAt: Date.now(),
      lastProcessedByteOffset: 5000,
    })
    const stateService = createMockStateService(storage)

    const result = await loadPersistedState('session-1', stateService, '/state', logger)

    expect(result).not.toBeNull()
    expect(result!.metrics.turnCount).toBe(10)
    expect(result!.byteOffset).toBe(5000)
  })

  it('returns null for StateNotFoundError', async () => {
    const stateService = createMockStateService()

    const result = await loadPersistedState('session-1', stateService, '/state', logger)

    expect(result).toBeNull()
    // Should NOT log warning for expected error
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('returns null on session ID mismatch', async () => {
    const storage = new Map<string, unknown>()
    storage.set('/state/sessions/session-1/state/transcript-metrics.json', {
      sessionId: 'different-session',
      metrics: createDefaultMetrics(),
      persistedAt: Date.now(),
    })
    const stateService = createMockStateService(storage)

    const result = await loadPersistedState('session-1', stateService, '/state', logger)

    expect(result).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('returns null for null sessionId', async () => {
    const stateService = createMockStateService()
    const result = await loadPersistedState(null, stateService, '/state', logger)
    expect(result).toBeNull()
  })
})

// ============================================================================
// persistCompactionHistory
// ============================================================================

describe('persistCompactionHistory', () => {
  it('persists and returns pruned history', async () => {
    const logger = createMockLogger()
    const stateService = createMockStateService()

    const history = [
      {
        compactedAt: Date.now(),
        transcriptSnapshotPath: '/snap1',
        metricsAtCompaction: createDefaultMetrics(),
        postCompactLineCount: 0,
      },
    ]

    const result = await persistCompactionHistory(history, 'session-1', stateService, '/state', logger)

    expect(result).toHaveLength(1)
    expect(stateService.write).toHaveBeenCalled()
  })

  it('returns original history when sessionId is null', async () => {
    const logger = createMockLogger()
    const stateService = createMockStateService()

    const history = [
      {
        compactedAt: Date.now(),
        transcriptSnapshotPath: '/snap1',
        metricsAtCompaction: createDefaultMetrics(),
        postCompactLineCount: 0,
      },
    ]

    const result = await persistCompactionHistory(history, null, stateService, '/state', logger)

    expect(result).toEqual(history)
    expect(stateService.write).not.toHaveBeenCalled()
  })
})

// ============================================================================
// loadCompactionHistory
// ============================================================================

describe('loadCompactionHistory', () => {
  it('returns empty array for new session', async () => {
    const logger = createMockLogger()
    const stateService = createMockStateService()

    const result = await loadCompactionHistory('session-1', stateService, '/state', logger)

    // Should use default value (empty array)
    expect(result).toEqual([])
  })

  it('returns loaded history', async () => {
    const logger = createMockLogger()
    const storage = new Map<string, unknown>()
    const history = [
      {
        compactedAt: Date.now(),
        transcriptSnapshotPath: '/snap1',
        metricsAtCompaction: createDefaultMetrics(),
        postCompactLineCount: 0,
      },
    ]
    storage.set('/state/sessions/session-1/state/compaction-history.json', history)
    const stateService = createMockStateService(storage)

    const result = await loadCompactionHistory('session-1', stateService, '/state', logger)

    expect(result).toHaveLength(1)
  })
})

// ============================================================================
// schedulePersistence
// ============================================================================

describe('schedulePersistence', () => {
  it('returns a timer handle', () => {
    const logger = createMockLogger()
    const callback = vi.fn()

    const timer = schedulePersistence(null, 100, callback, logger, 'session-1')

    expect(timer).toBeDefined()
    clearTimeout(timer)
  })

  it('clears existing timer before creating new one', () => {
    const logger = createMockLogger()
    const callback = vi.fn()

    const timer1 = schedulePersistence(null, 100, callback, logger, 'session-1')
    const timer2 = schedulePersistence(timer1, 100, callback, logger, 'session-1')

    expect(timer2).toBeDefined()
    clearTimeout(timer2)
  })
})
