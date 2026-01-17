/**
 * State management exports.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

export { StateService, type StateReadResult, type StateServiceOptions } from './state-service.js'
export { StateNotFoundError, StateCorruptError } from './errors.js'

// Typed state accessors (Phase 9.3.7)
export { type StateDescriptor, sessionState, globalState } from './state-descriptor.js'
export { SessionStateAccessor, GlobalStateAccessor } from './typed-accessor.js'

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
  // Descriptors
  TranscriptMetricsDescriptor,
  CompactionHistoryDescriptor,
} from './transcript-schemas.js'

// Log metrics descriptors
export {
  DaemonLogMetricsDescriptor,
  CliLogMetricsDescriptor,
  DaemonGlobalLogMetricsDescriptor,
} from './log-metrics-descriptors.js'

// PathResolver is intentionally NOT exported - it's internal to StateService
