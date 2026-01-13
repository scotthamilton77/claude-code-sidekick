/**
 * State management exports.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

export { StateService, type StateReadResult, type StateServiceOptions } from './state-service.js'
export { StateNotFoundError, StateCorruptError } from './errors.js'

// Transcript state schemas and utilities
export {
  // Schemas
  CacheTiersSchema,
  ModelTokenStatsSchema,
  TokenUsageMetricsSchema,
  TranscriptMetricsSchema,
  PersistedTranscriptStateSchema,
  CompactionEntrySchema,
  CompactionHistorySchema,
  // Utilities
  pruneCompactionHistory,
  MAX_COMPACTION_ENTRIES,
  // Types
  type TokenUsageMetricsState,
  type TranscriptMetricsState,
  type PersistedTranscriptState,
  type CompactionEntryState,
  type CompactionHistoryState,
} from './transcript-schemas.js'

// PathResolver is intentionally NOT exported - it's internal to StateService
