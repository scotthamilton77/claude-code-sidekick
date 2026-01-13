/**
 * Tests for transcript state schemas and related types.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

import { describe, it, expect } from 'vitest'
import {
  CompactionEntrySchema,
  CompactionHistorySchema,
  PersistedTranscriptStateSchema,
  pruneCompactionHistory,
  MAX_COMPACTION_ENTRIES,
  TokenUsageMetricsSchema,
  TranscriptMetricsSchema,
  type CompactionEntryState,
  type PersistedTranscriptState,
  type TokenUsageMetricsState,
  type TranscriptMetricsState,
} from '../transcript-schemas.js'

// ============================================================================
// Test Data Factories
// ============================================================================

function createTokenUsageMetrics(overrides = {}): TokenUsageMetricsState {
  return {
    inputTokens: 1000,
    outputTokens: 500,
    totalTokens: 1500,
    cacheCreationInputTokens: 200,
    cacheReadInputTokens: 100,
    cacheTiers: {
      ephemeral5mInputTokens: 50,
      ephemeral1hInputTokens: 30,
    },
    serviceTierCounts: { default: 5 },
    byModel: {
      'claude-sonnet-4-20250514': { inputTokens: 800, outputTokens: 400, requestCount: 3 },
    },
    ...overrides,
  }
}

function createTranscriptMetrics(overrides = {}): TranscriptMetricsState {
  return {
    turnCount: 5,
    toolsThisTurn: 2,
    toolCount: 10,
    messageCount: 15,
    tokenUsage: createTokenUsageMetrics(),
    currentContextTokens: 5000,
    isPostCompactIndeterminate: false,
    toolsPerTurn: 2, // 10 tools / 5 turns
    lastProcessedLine: 100,
    lastUpdatedAt: Date.now(),
    ...overrides,
  }
}

function createPersistedTranscriptState(overrides = {}): PersistedTranscriptState {
  return {
    sessionId: 'test-session-id',
    metrics: createTranscriptMetrics(),
    persistedAt: Date.now(),
    ...overrides,
  }
}

function createCompactionEntry(overrides = {}): CompactionEntryState {
  return {
    compactedAt: Date.now(),
    transcriptSnapshotPath: '/.sidekick/sessions/test-session/transcripts/pre-compact-1234567890.jsonl',
    metricsAtCompaction: createTranscriptMetrics(),
    postCompactLineCount: 0,
    ...overrides,
  }
}

// ============================================================================
// TokenUsageMetricsSchema Tests
// ============================================================================

describe('TokenUsageMetricsSchema', () => {
  it('validates valid token usage metrics', () => {
    const metrics = createTokenUsageMetrics()
    const result = TokenUsageMetricsSchema.safeParse(metrics)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.inputTokens).toBe(1000)
      expect(result.data.cacheTiers.ephemeral5mInputTokens).toBe(50)
      expect(result.data.cacheTiers.ephemeral1hInputTokens).toBe(30)
      expect(result.data.serviceTierCounts).toEqual({ default: 5 })
      expect(result.data.byModel['claude-sonnet-4-20250514'].requestCount).toBe(3)
    }
  })

  it('rejects missing required fields', () => {
    const invalid = { inputTokens: 100 } // missing other fields
    const result = TokenUsageMetricsSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })

  it('rejects non-number token values', () => {
    const invalid = createTokenUsageMetrics({ inputTokens: 'not a number' })
    const result = TokenUsageMetricsSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })
})

// ============================================================================
// TranscriptMetricsSchema Tests
// ============================================================================

describe('TranscriptMetricsSchema', () => {
  it('validates valid transcript metrics', () => {
    const metrics = createTranscriptMetrics()
    const result = TranscriptMetricsSchema.safeParse(metrics)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.turnCount).toBe(5)
      expect(result.data.tokenUsage.inputTokens).toBe(1000)
      expect(result.data.toolsPerTurn).toBe(2)
      expect(result.data.lastProcessedLine).toBe(100)
    }
  })

  it('accepts null for currentContextTokens', () => {
    const metrics = createTranscriptMetrics({ currentContextTokens: null })
    const result = TranscriptMetricsSchema.safeParse(metrics)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.currentContextTokens).toBe(null)
    }
  })

  it('rejects invalid nested tokenUsage', () => {
    const invalid = createTranscriptMetrics({
      tokenUsage: { invalid: 'structure' },
    })
    const result = TranscriptMetricsSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })
})

// ============================================================================
// PersistedTranscriptStateSchema Tests
// ============================================================================

describe('PersistedTranscriptStateSchema', () => {
  it('validates valid persisted state', () => {
    const state = createPersistedTranscriptState()
    const result = PersistedTranscriptStateSchema.safeParse(state)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sessionId).toBe('test-session-id')
      expect(result.data.metrics.turnCount).toBe(5)
      expect(result.data.persistedAt).toBeDefined()
    }
  })

  it('rejects missing sessionId', () => {
    const { sessionId: _, ...invalid } = createPersistedTranscriptState()
    const result = PersistedTranscriptStateSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })

  it('rejects invalid metrics', () => {
    const invalid = createPersistedTranscriptState({
      metrics: { invalid: 'metrics' },
    })
    const result = PersistedTranscriptStateSchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })

  it('validates state with empty model stats', () => {
    const state = createPersistedTranscriptState({
      metrics: createTranscriptMetrics({
        tokenUsage: createTokenUsageMetrics({
          serviceTierCounts: {},
          byModel: {},
        }),
      }),
    })
    const result = PersistedTranscriptStateSchema.safeParse(state)

    expect(result.success).toBe(true)
  })
})

// ============================================================================
// CompactionEntrySchema Tests
// ============================================================================

describe('CompactionEntrySchema', () => {
  it('validates valid compaction entry', () => {
    const entry = createCompactionEntry()
    const result = CompactionEntrySchema.safeParse(entry)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.compactedAt).toBeDefined()
      expect(result.data.transcriptSnapshotPath).toContain('pre-compact')
      expect(result.data.postCompactLineCount).toBe(0)
    }
  })

  it('rejects missing transcriptSnapshotPath', () => {
    const { transcriptSnapshotPath: _, ...invalid } = createCompactionEntry()
    const result = CompactionEntrySchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })

  it('rejects invalid metricsAtCompaction', () => {
    const invalid = createCompactionEntry({
      metricsAtCompaction: { invalid: 'metrics' },
    })
    const result = CompactionEntrySchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })
})

// ============================================================================
// CompactionHistorySchema Tests
// ============================================================================

describe('CompactionHistorySchema', () => {
  it('validates empty history', () => {
    const history: unknown[] = []
    const result = CompactionHistorySchema.safeParse(history)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(0)
    }
  })

  it('validates history with multiple entries', () => {
    const history = [
      createCompactionEntry({ compactedAt: 1000 }),
      createCompactionEntry({ compactedAt: 2000 }),
      createCompactionEntry({ compactedAt: 3000 }),
    ]
    const result = CompactionHistorySchema.safeParse(history)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toHaveLength(3)
    }
  })

  it('rejects history with invalid entries', () => {
    const invalid = [createCompactionEntry(), { invalid: 'entry' }]
    const result = CompactionHistorySchema.safeParse(invalid)

    expect(result.success).toBe(false)
  })

  it('rejects non-array input', () => {
    const result = CompactionHistorySchema.safeParse({ not: 'array' })

    expect(result.success).toBe(false)
  })
})

// ============================================================================
// Pruning Tests
// ============================================================================

describe('pruneCompactionHistory', () => {
  it('returns unchanged when under limit', () => {
    const history = [createCompactionEntry({ compactedAt: 1000 }), createCompactionEntry({ compactedAt: 2000 })]

    const pruned = pruneCompactionHistory(history)

    expect(pruned).toHaveLength(2)
    expect(pruned).toEqual(history)
  })

  it('prunes to MAX_COMPACTION_ENTRIES keeping most recent', () => {
    // Create more entries than the limit
    const history = Array.from({ length: MAX_COMPACTION_ENTRIES + 10 }, (_, i) =>
      createCompactionEntry({ compactedAt: i * 1000 })
    )

    const pruned = pruneCompactionHistory(history)

    expect(pruned).toHaveLength(MAX_COMPACTION_ENTRIES)
    // Should keep the most recent entries (highest timestamps)
    expect(pruned[0].compactedAt).toBe(10 * 1000) // First entry after pruning
    expect(pruned[pruned.length - 1].compactedAt).toBe((MAX_COMPACTION_ENTRIES + 9) * 1000)
  })

  it('handles exactly MAX_COMPACTION_ENTRIES', () => {
    const history = Array.from({ length: MAX_COMPACTION_ENTRIES }, (_, i) =>
      createCompactionEntry({ compactedAt: i * 1000 })
    )

    const pruned = pruneCompactionHistory(history)

    expect(pruned).toHaveLength(MAX_COMPACTION_ENTRIES)
    expect(pruned).toEqual(history)
  })

  it('handles empty history', () => {
    const pruned = pruneCompactionHistory([])

    expect(pruned).toHaveLength(0)
  })

  it('allows custom limit via parameter', () => {
    const history = Array.from({ length: 10 }, (_, i) => createCompactionEntry({ compactedAt: i * 1000 }))

    const pruned = pruneCompactionHistory(history, 5)

    expect(pruned).toHaveLength(5)
    // Should keep entries 5-9 (most recent)
    expect(pruned[0].compactedAt).toBe(5 * 1000)
  })
})

// ============================================================================
// MAX_COMPACTION_ENTRIES Tests
// ============================================================================

describe('MAX_COMPACTION_ENTRIES', () => {
  it('is a reasonable default', () => {
    expect(MAX_COMPACTION_ENTRIES).toBeGreaterThan(0)
    expect(MAX_COMPACTION_ENTRIES).toBeLessThanOrEqual(100)
  })
})
