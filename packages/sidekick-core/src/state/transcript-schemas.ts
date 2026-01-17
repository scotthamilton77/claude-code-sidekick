/**
 * Zod schemas for transcript state files.
 *
 * These schemas validate state files written by TranscriptService:
 * - transcript-metrics.json (via PersistedTranscriptStateSchema)
 * - compaction-history.json (via CompactionHistorySchema)
 *
 * Includes pruning utility to keep compaction history bounded.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 * @see docs/design/TRANSCRIPT-PROCESSING.md §4.2
 */

import { z } from 'zod'
import { sessionState } from './state-descriptor.js'

// ============================================================================
// Constants
// ============================================================================

/** Maximum compaction entries to keep (oldest are pruned) */
export const MAX_COMPACTION_ENTRIES = 50

// ============================================================================
// Transcript Entry Schemas (minimal validation)
// ============================================================================

/**
 * Minimal schema for raw transcript JSONL entries.
 * Uses passthrough to allow any fields - Claude Code's format may vary.
 * Only validates that the entry is an object with optional common fields.
 *
 * Note: This is intentionally loose. TranscriptEntry is Record<string, unknown>
 * and we only validate enough to ensure safe parsing, not full structure.
 */
export const TranscriptEntrySchema = z.object({}).passthrough()

/**
 * Schema for extracting UUID from transcript entries.
 * Used by parseUuid() for minimal validation.
 */
export const TranscriptUuidSchema = z.object({
  uuid: z.string().optional(),
}).passthrough()

// ============================================================================
// Token Usage Schema
// ============================================================================

/**
 * Schema for cache tier breakdown.
 * Matches TokenUsageMetrics.cacheTiers from @sidekick/types.
 */
export const CacheTiersSchema = z.object({
  /** cache_creation.ephemeral_5m_input_tokens */
  ephemeral5mInputTokens: z.number(),
  /** cache_creation.ephemeral_1h_input_tokens */
  ephemeral1hInputTokens: z.number(),
})

/**
 * Schema for per-model token breakdown.
 */
export const ModelTokenStatsSchema = z.object({
  inputTokens: z.number(),
  outputTokens: z.number(),
  requestCount: z.number(),
})

/**
 * Schema for token usage metrics.
 * Matches the TokenUsageMetrics interface from @sidekick/types.
 */
export const TokenUsageMetricsSchema = z.object({
  /** Sum of usage.input_tokens across all assistant responses */
  inputTokens: z.number(),
  /** Sum of usage.output_tokens across all assistant responses */
  outputTokens: z.number(),
  /** inputTokens + outputTokens */
  totalTokens: z.number(),
  /** Sum of cache_creation_input_tokens */
  cacheCreationInputTokens: z.number(),
  /** Sum of cache_read_input_tokens (cache hits) */
  cacheReadInputTokens: z.number(),
  /** Cache tier breakdown */
  cacheTiers: CacheTiersSchema,
  /** Service tier tracking (for cost/performance analysis) */
  serviceTierCounts: z.record(z.string(), z.number()),
  /** Per-model breakdown (sessions may span model switches) */
  byModel: z.record(z.string(), ModelTokenStatsSchema),
})

export type TokenUsageMetricsState = z.infer<typeof TokenUsageMetricsSchema>

// ============================================================================
// Transcript Metrics Schema
// ============================================================================

/**
 * Schema for transcript metrics.
 * Matches the TranscriptMetrics interface from @sidekick/types.
 */
export const TranscriptMetricsSchema = z.object({
  /** Total user prompts in session */
  turnCount: z.number(),
  /** Tools since last UserPrompt (reset on UserPrompt) */
  toolsThisTurn: z.number(),
  /** Total tool invocations across session */
  toolCount: z.number(),
  /** Total messages (user + assistant + system) */
  messageCount: z.number(),
  /** Token usage metrics from API responses */
  tokenUsage: TokenUsageMetricsSchema,
  /** Current context window tokens (null if indeterminate) */
  currentContextTokens: z.number().nullable(),
  /** True after compact_boundary detected until first usage block */
  isPostCompactIndeterminate: z.boolean(),
  /** Derived ratio: toolCount / turnCount */
  toolsPerTurn: z.number(),
  /** Watermark: last processed line number */
  lastProcessedLine: z.number(),
  /** Unix timestamp of last metrics update */
  lastUpdatedAt: z.number(),
})

export type TranscriptMetricsState = z.infer<typeof TranscriptMetricsSchema>

// ============================================================================
// Persisted Transcript State Schema
// ============================================================================

/**
 * Schema for persisted transcript state.
 * Wraps TranscriptMetrics with session tracking metadata.
 * Stored in .sidekick/sessions/{sessionId}/state/transcript-metrics.json
 */
export const PersistedTranscriptStateSchema = z.object({
  /** Session ID for verification */
  sessionId: z.string(),
  /** The transcript metrics */
  metrics: TranscriptMetricsSchema,
  /** When this state was persisted (Unix ms) */
  persistedAt: z.number(),
})

export type PersistedTranscriptState = z.infer<typeof PersistedTranscriptStateSchema>

// ============================================================================
// Compaction Entry Schema
// ============================================================================

/**
 * Schema for a single compaction entry.
 * Records metadata about a compaction event for timeline tracking.
 */
export const CompactionEntrySchema = z.object({
  /** When compaction occurred (Unix ms) */
  compactedAt: z.number(),
  /** Path to pre-compact transcript snapshot */
  transcriptSnapshotPath: z.string(),
  /** Metrics at time of compaction */
  metricsAtCompaction: TranscriptMetricsSchema,
  /** Lines remaining after compaction */
  postCompactLineCount: z.number(),
})

export type CompactionEntryState = z.infer<typeof CompactionEntrySchema>

// ============================================================================
// Compaction History Schema
// ============================================================================

/**
 * Schema for the compaction history array.
 * Stored in .sidekick/sessions/{sessionId}/state/compaction-history.json
 */
export const CompactionHistorySchema = z.array(CompactionEntrySchema)

export type CompactionHistoryState = z.infer<typeof CompactionHistorySchema>

// ============================================================================
// Pruning Utility
// ============================================================================

/**
 * Prune compaction history to keep only the most recent entries.
 *
 * @param history - Array of compaction entries
 * @param maxEntries - Maximum entries to keep (default: MAX_COMPACTION_ENTRIES)
 * @returns Pruned array with oldest entries removed
 */
export function pruneCompactionHistory(
  history: CompactionEntryState[],
  maxEntries: number = MAX_COMPACTION_ENTRIES
): CompactionEntryState[] {
  if (history.length <= maxEntries) {
    return history
  }

  // Keep the most recent entries (assume history is in chronological order)
  return history.slice(history.length - maxEntries)
}

// ============================================================================
// State Descriptors
// ============================================================================

/**
 * Transcript metrics state descriptor.
 * Written by TranscriptService, read by feature-statusline.
 * Default: null (file may not exist until first metrics are persisted)
 */
export const TranscriptMetricsDescriptor = sessionState('transcript-metrics.json', PersistedTranscriptStateSchema, null)

/**
 * Compaction history state descriptor.
 * Written by TranscriptService during compaction events.
 * Default: empty array (no compactions yet)
 */
export const CompactionHistoryDescriptor = sessionState('compaction-history.json', CompactionHistorySchema, [])
