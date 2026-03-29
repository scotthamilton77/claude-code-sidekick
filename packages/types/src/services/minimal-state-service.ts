/**
 * MinimalStateService Interface & Session State Snapshot
 *
 * The core state service abstraction and the unified session state response type.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.C State Inspector
 */

import type { ZodType } from 'zod'
import type { SessionSummaryState, ResumeMessageState } from './session-state.js'
import type {
  TranscriptMetricsState,
  SessionContextMetrics,
  LLMMetricsState,
  LogMetricsState,
} from './metrics-state.js'
import type { StagedRemindersSnapshot, CompactionHistoryState } from './reminder-state.js'

// ============================================================================
// StateService Interface
// ============================================================================

/**
 * Result of a state read operation.
 * Source indicates how the data was obtained.
 */
export interface StateReadResult<T> {
  /** The validated data */
  data: T
  /** How the data was obtained: fresh, stale (older than threshold), default (file missing), recovered (from .bak) */
  source: 'fresh' | 'stale' | 'default' | 'recovered'
  /** File modification time (ms) if file exists */
  mtime?: number
}

/**
 * Minimal StateService interface for DaemonContext.
 * Provides atomic writes with schema validation and corrupt file recovery.
 *
 * The actual implementation lives in @sidekick/core and is injected via DaemonContext.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */
export interface MinimalStateService {
  /**
   * Read state file with Zod validation.
   * @param path - Absolute path to state file
   * @param schema - Zod schema for validation
   * @param defaultValue - Optional default if file missing/corrupt.
   *                       Pass null to get null back when file is missing (source: 'default').
   *                       Omit to throw StateNotFoundError when file is missing.
   * @throws StateNotFoundError if file missing and no default
   * @throws StateCorruptError if validation fails and no default
   */
  read<T>(path: string, schema: ZodType<T>, defaultValue?: T | null | (() => T | null)): Promise<StateReadResult<T>>

  /**
   * Atomic write with Zod validation.
   * Uses tmp + rename pattern to prevent corruption.
   * @param path - Absolute path to state file
   * @param data - Data to write
   * @param schema - Zod schema for validation
   * @param options - Optional write options (trackHistory for dev mode backups)
   */
  write<T>(path: string, data: T, schema: ZodType<T>, options?: { trackHistory?: boolean }): Promise<void>

  /**
   * Delete state file if it exists.
   * @param path - Absolute path to state file
   * @returns true if the file was actually deleted, false if it didn't exist
   */
  delete(path: string): Promise<boolean>

  /**
   * Get absolute path for a session state file.
   * @param sessionId - Session identifier
   * @param filename - State file name (e.g., 'session-summary.json')
   */
  sessionStatePath(sessionId: string, filename: string): string

  /**
   * Get absolute path for a global state file.
   * @param filename - State file name (e.g., 'global-metrics.json')
   */
  globalStatePath(filename: string): string

  /**
   * Get root state directory (.sidekick or user config root).
   */
  rootDir(): string

  /**
   * Get sessions directory (.sidekick/sessions).
   */
  sessionsDir(): string

  /**
   * Get session root directory (.sidekick/sessions/{sessionId}).
   * @param sessionId - Session identifier
   */
  sessionRootDir(sessionId: string): string

  /**
   * Get logs directory (.sidekick/logs).
   */
  logsDir(): string
}

// ============================================================================
// Unified Session State Response
// ============================================================================

/**
 * Complete session state snapshot for UI State Inspector.
 * Aggregates all state domains into a single response.
 *
 * This is the primary response type for the monitoring UI's state panel.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.C State Inspector
 */
export interface SessionStateSnapshot {
  /** Session identifier */
  sessionId: string
  /** Unix timestamp (ms) of this snapshot */
  timestamp: number
  /** Session summary state (if available) */
  summary?: SessionSummaryState
  /** Resume message state (if available) */
  resume?: ResumeMessageState
  /** Transcript metrics (if available) */
  metrics?: TranscriptMetricsState
  /** Context metrics for this session (if available) */
  contextMetrics?: SessionContextMetrics
  /** Staged reminders (if any) */
  stagedReminders?: StagedRemindersSnapshot
  /** Compaction history (if any) */
  compactionHistory?: CompactionHistoryState
  /** LLM metrics for this session (if available) */
  llmMetrics?: LLMMetricsState
  /** Log metrics (warnings/errors) for this session (if available) */
  logMetrics?: LogMetricsState
}
