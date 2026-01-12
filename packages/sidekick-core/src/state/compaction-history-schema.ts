/**
 * Zod schemas for compaction history state files.
 *
 * These schemas validate the compaction-history.json files written by TranscriptService.
 * Includes pruning utility to keep history bounded.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 * @see docs/design/TRANSCRIPT-PROCESSING.md §4.2
 */

import { z } from 'zod'

// ============================================================================
// Constants
// ============================================================================

/** Maximum compaction entries to keep (oldest are pruned) */
export const MAX_COMPACTION_ENTRIES = 50

// ============================================================================
// Token Usage Schema
// ============================================================================

/**
 * Schema for cache tier breakdown.
 */
export const CacheTiersSchema = z.object({
  ephemeral: z.number(),
  shortTerm: z.number(),
  longTerm: z.number(),
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
  /** Unix timestamp of last metrics update */
  lastUpdatedAt: z.number(),
})

export type TranscriptMetricsState = z.infer<typeof TranscriptMetricsSchema>

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
