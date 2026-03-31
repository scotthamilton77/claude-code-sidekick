/**
 * Transcript Persistence
 *
 * Handles persisting and loading transcript metrics and compaction history.
 * Extracted from TranscriptServiceImpl.
 *
 * @see docs/design/TRANSCRIPT-PROCESSING.md
 */

import { join } from 'node:path'
import {
  PersistedTranscriptStateSchema,
  CompactionHistorySchema,
  pruneCompactionHistory,
  StateNotFoundError,
  type PersistedTranscriptState,
} from './state/index.js'
import type { TranscriptMetrics, CompactionEntry, MinimalStateService, Logger } from '@sidekick/types'

// ============================================================================
// Metrics Persistence
// ============================================================================

/**
 * Persist transcript metrics to state service.
 *
 * @param sessionId - Session identifier
 * @param metrics - Current metrics snapshot (deep cloned by caller)
 * @param lastProcessedByteOffset - Current byte offset in transcript file
 * @param stateService - State service for atomic writes
 * @param stateDir - Base state directory
 * @param immediate - If true, skip recency check
 * @param lastPersistedAt - Timestamp of last persistence
 * @param debounceMs - Minimum interval between persists
 * @param logger - Logger for observability
 * @returns Updated lastPersistedAt timestamp, or original if skipped
 */
export async function persistMetrics(
  sessionId: string | null,
  metrics: TranscriptMetrics,
  lastProcessedByteOffset: number,
  stateService: MinimalStateService,
  stateDir: string,
  immediate: boolean,
  lastPersistedAt: number,
  debounceMs: number,
  logger: Logger
): Promise<number> {
  if (!sessionId) return lastPersistedAt

  const now = Date.now()
  const timeSinceLastPersist = now - lastPersistedAt
  // Skip if recently persisted (unless immediate)
  if (!immediate && timeSinceLastPersist < debounceMs) {
    logger.debug('persistMetrics skipped (too recent)', {
      sessionId,
      immediate,
      timeSinceLastPersist,
      threshold: debounceMs,
    })
    return lastPersistedAt
  }

  logger.debug('persistMetrics writing', {
    sessionId,
    immediate,
    timeSinceLastPersist,
  })

  const statePath = getMetricsStatePath(sessionId, stateDir)
  if (!statePath) return lastPersistedAt

  const state: PersistedTranscriptState = {
    sessionId,
    metrics,
    persistedAt: now,
    lastProcessedByteOffset,
  }

  try {
    await stateService.write(statePath, state, PersistedTranscriptStateSchema)
    return now
  } catch (err) {
    logger.error('Failed to persist transcript metrics', { err, statePath })
    return lastPersistedAt
  }
}

/**
 * Load previously persisted transcript state.
 *
 * @param sessionId - Session identifier
 * @param stateService - State service for reads
 * @param stateDir - Base state directory
 * @param logger - Logger for observability
 * @returns Recovered metrics and byte offset, or null if not found/mismatched
 */
export async function loadPersistedState(
  sessionId: string | null,
  stateService: MinimalStateService,
  stateDir: string,
  logger: Logger
): Promise<{ metrics: TranscriptMetrics; byteOffset: number } | null> {
  const statePath = getMetricsStatePath(sessionId, stateDir)
  if (!statePath) return null

  try {
    const result = await stateService.read(
      statePath,
      PersistedTranscriptStateSchema,
      undefined // No default - return null if missing
    )

    // Verify session ID matches
    if (result.data.sessionId !== sessionId) {
      logger.warn('Session ID mismatch in persisted state', {
        expectedSessionId: sessionId,
        foundSessionId: result.data.sessionId,
      })
      return null
    }

    // Schema-validated data is already in correct format
    return {
      metrics: result.data.metrics,
      byteOffset: result.data.lastProcessedByteOffset ?? 0,
    }
  } catch (err) {
    // StateNotFoundError is expected for new sessions - don't log warning
    if (err instanceof StateNotFoundError) {
      return null
    }
    logger.warn('Failed to load persisted transcript state', { err, statePath })
    return null
  }
}

/**
 * Get the file path for persisted metrics state.
 */
export function getMetricsStatePath(sessionId: string | null, stateDir: string): string | null {
  if (!sessionId) return null
  return join(stateDir, 'sessions', sessionId, 'state', 'transcript-metrics.json')
}

// ============================================================================
// Compaction History Persistence
// ============================================================================

/**
 * Persist compaction history to state service.
 * Prunes history to keep bounded.
 *
 * @returns The pruned history array
 */
export async function persistCompactionHistory(
  compactionHistory: CompactionEntry[],
  sessionId: string | null,
  stateService: MinimalStateService,
  stateDir: string,
  logger: Logger
): Promise<CompactionEntry[]> {
  const historyPath = getCompactionHistoryPath(sessionId, stateDir)
  if (!historyPath) return compactionHistory

  // Prune history to keep bounded
  const prunedHistory = pruneCompactionHistory(compactionHistory)

  try {
    await stateService.write(historyPath, prunedHistory, CompactionHistorySchema)
    return prunedHistory
  } catch (err) {
    logger.error('Failed to persist compaction history', { err, historyPath })
    return compactionHistory
  }
}

/**
 * Load compaction history from state service.
 */
export async function loadCompactionHistory(
  sessionId: string | null,
  stateService: MinimalStateService,
  stateDir: string,
  logger: Logger
): Promise<CompactionEntry[]> {
  const historyPath = getCompactionHistoryPath(sessionId, stateDir)
  if (!historyPath) return []

  try {
    const result = await stateService.read(
      historyPath,
      CompactionHistorySchema,
      [] // Default to empty array for new sessions
    )
    return result.data as CompactionEntry[]
  } catch (err) {
    logger.warn('Failed to load compaction history', { err, historyPath })
    return []
  }
}

/**
 * Get the file path for compaction history.
 */
export function getCompactionHistoryPath(sessionId: string | null, stateDir: string): string | null {
  if (!sessionId) return null
  return join(stateDir, 'sessions', sessionId, 'state', 'compaction-history.json')
}

// ============================================================================
// Persistence Scheduling
// ============================================================================

/**
 * Schedule a debounced metrics persistence.
 * Returns a timer handle that the caller should track.
 *
 * @param existingTimer - Existing debounce timer to clear
 * @param debounceMs - Debounce interval
 * @param persistCallback - Callback to invoke when timer fires
 * @param logger - Logger for observability
 * @param sessionId - Session identifier (for logging)
 * @returns New timer handle
 */
export function schedulePersistence(
  existingTimer: ReturnType<typeof setTimeout> | null,
  debounceMs: number,
  persistCallback: () => void,
  logger: Logger,
  sessionId: string | null
): ReturnType<typeof setTimeout> {
  logger.debug('schedulePersistence called', {
    sessionId,
    debounceMs,
  })
  if (existingTimer) {
    clearTimeout(existingTimer)
  }
  return setTimeout(persistCallback, debounceMs)
}
