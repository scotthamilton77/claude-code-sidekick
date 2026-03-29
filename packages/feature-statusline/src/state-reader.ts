/**
 * StateReader - Safe file reading with fallback defaults
 *
 * Handles reading state files from .sidekick/sessions/{id}/state/ with:
 * - Graceful fallback on missing/corrupt files
 * - Staleness detection based on content timestamps
 * - Zod validation via typed accessors
 *
 * Uses typed state accessors to encapsulate path construction and schema validation.
 * Storage implementation details are hidden from this module.
 *
 * Resume message discovery is handled by resume-discovery.ts.
 * A backward-compatible wrapper is re-exported here for existing callers.
 *
 * @see docs/design/FEATURE-STATUSLINE.md §5.2 StateReader
 * @see docs/design/FEATURE-RESUME.md §3.1 Artifact Discovery
 */

import {
  StateService,
  SessionStateAccessor,
  GlobalStateAccessor,
  TranscriptMetricsDescriptor,
  DaemonLogMetricsDescriptor,
  CliLogMetricsDescriptor,
  DaemonGlobalLogMetricsDescriptor,
  type PersistedTranscriptState,
} from '@sidekick/core'
import type { MinimalStateService, LogMetricsState } from '@sidekick/types'
import {
  SessionSummaryDescriptor,
  ResumeMessageDescriptor,
  SnarkyMessageDescriptor,
  SessionPersonaDescriptor,
} from '@sidekick/feature-session-summary'
import type {
  SessionSummaryState as FeatureSessionSummaryState,
  SnarkyMessageState,
  SessionPersonaState,
} from '@sidekick/types'

import type {
  ResumeMessageState,
  TranscriptMetricsState,
  SessionSummaryState,
  StateReadResult,
  LogMetricsState as LocalLogMetricsState,
} from './types.js'
import { EMPTY_TRANSCRIPT_STATE, EMPTY_SESSION_SUMMARY, EMPTY_LOG_METRICS } from './types.js'

/** Maximum age (ms) before data is considered stale */
const STALE_THRESHOLD_MS = 60_000 // 60 seconds

/**
 * Configuration for StateReader.
 */
export interface StateReaderConfig {
  /** StateService for state file operations */
  stateService: MinimalStateService
  /** Session ID for state file resolution */
  sessionId: string
  /** Threshold in ms for staleness detection */
  staleThresholdMs?: number
}

/**
 * Reads state files for statusline rendering.
 * Returns fallback defaults if files are missing or corrupt.
 * Uses typed state accessors for encapsulated state access.
 */
export class StateReader {
  private readonly sessionId: string
  private readonly staleThresholdMs: number

  // Session-scoped accessors
  private readonly transcriptMetricsAccessor: SessionStateAccessor<PersistedTranscriptState, null>
  private readonly sessionSummaryAccessor: SessionStateAccessor<FeatureSessionSummaryState, null>
  private readonly resumeMessageAccessor: SessionStateAccessor<ResumeMessageState, null>
  private readonly snarkyMessageAccessor: SessionStateAccessor<SnarkyMessageState, SnarkyMessageState>
  private readonly daemonLogMetricsAccessor: SessionStateAccessor<LogMetricsState, LogMetricsState>
  private readonly cliLogMetricsAccessor: SessionStateAccessor<LogMetricsState, LogMetricsState>
  private readonly sessionPersonaAccessor: SessionStateAccessor<SessionPersonaState, null>

  // Global-scoped accessor (optional, only used when global metrics needed)
  private readonly daemonGlobalLogMetricsAccessor: GlobalStateAccessor<LogMetricsState, LogMetricsState>

  constructor(config: StateReaderConfig) {
    this.sessionId = config.sessionId
    this.staleThresholdMs = config.staleThresholdMs ?? STALE_THRESHOLD_MS

    // Create session-scoped accessors
    this.transcriptMetricsAccessor = new SessionStateAccessor(config.stateService, TranscriptMetricsDescriptor)
    this.sessionSummaryAccessor = new SessionStateAccessor(config.stateService, SessionSummaryDescriptor)
    this.resumeMessageAccessor = new SessionStateAccessor(config.stateService, ResumeMessageDescriptor)
    this.snarkyMessageAccessor = new SessionStateAccessor(config.stateService, SnarkyMessageDescriptor)
    this.daemonLogMetricsAccessor = new SessionStateAccessor(config.stateService, DaemonLogMetricsDescriptor)
    this.cliLogMetricsAccessor = new SessionStateAccessor(config.stateService, CliLogMetricsDescriptor)
    this.sessionPersonaAccessor = new SessionStateAccessor(config.stateService, SessionPersonaDescriptor)

    // Create global-scoped accessor
    this.daemonGlobalLogMetricsAccessor = new GlobalStateAccessor(config.stateService, DaemonGlobalLogMetricsDescriptor)
  }

  /**
   * Read and parse transcript metrics from transcript-metrics.json.
   * Returns only fields that are persisted by TranscriptService.
   *
   * Staleness is determined by the `persistedAt` timestamp in the file,
   * not the file mtime. This detects if the Daemon stopped updating.
   */
  async getTranscriptMetrics(): Promise<StateReadResult<TranscriptMetricsState>> {
    const result = await this.transcriptMetricsAccessor.read(this.sessionId)

    // 'default' = file missing, 'recovered' = file corrupt (default used after backup)
    if (result.source === 'default' || result.source === 'recovered' || result.data === null) {
      return { source: 'default', data: EMPTY_TRANSCRIPT_STATE }
    }

    const persistedState = result.data
    const metrics = persistedState.metrics

    // Use persistedAt timestamp for staleness, not file mtime
    // This detects if Daemon stopped updating (default interval: 5s)
    const isStale = Date.now() - persistedState.persistedAt > this.staleThresholdMs

    const state: TranscriptMetricsState = {
      sessionId: persistedState.sessionId,
      lastUpdatedAt: metrics.lastUpdatedAt,
      tokens: {
        input: metrics.tokenUsage.inputTokens,
        output: metrics.tokenUsage.outputTokens,
        total: metrics.tokenUsage.totalTokens,
        cacheCreation: metrics.tokenUsage.cacheCreationInputTokens,
        cacheRead: metrics.tokenUsage.cacheReadInputTokens,
      },
      currentContextTokens: metrics.currentContextTokens,
      isPostCompactIndeterminate: metrics.isPostCompactIndeterminate,
    }

    return {
      source: isStale ? 'stale' : 'fresh',
      data: state,
      mtime: persistedState.persistedAt,
    }
  }

  /**
   * Read and parse session summary from session-summary.json.
   * Uses SessionSummaryDescriptor from feature-session-summary.
   */
  async getSessionSummary(): Promise<StateReadResult<SessionSummaryState>> {
    const result = await this.sessionSummaryAccessor.read(this.sessionId)

    // 'default' = file missing, 'recovered' = file corrupt (default used after backup)
    if (result.source === 'default' || result.source === 'recovered' || result.data === null) {
      return { source: 'default', data: EMPTY_SESSION_SUMMARY }
    }

    return {
      source: 'fresh',
      data: result.data,
      mtime: result.mtime,
    }
  }

  /**
   * Read and parse resume message from resume-message.json.
   * Returns null data if file doesn't exist (not an error case).
   * Uses ResumeMessageDescriptor from feature-session-summary.
   *
   * Content artifacts don't have staleness - they're valid until regenerated.
   */
  async getResumeMessage(): Promise<StateReadResult<ResumeMessageState | null>> {
    const result = await this.resumeMessageAccessor.read(this.sessionId)

    // 'default' = file missing, 'recovered' = file corrupt (default used after backup)
    if (result.source === 'default' || result.source === 'recovered' || result.data === null) {
      return { data: null, source: 'default' }
    }

    return {
      data: result.data,
      source: 'fresh',
      mtime: result.mtime,
    }
  }

  /**
   * Read snarky message from snarky-message.json.
   * Returns empty string if file doesn't exist.
   * Uses SnarkyMessageDescriptor from feature-session-summary.
   *
   * Content artifacts don't have staleness - they're valid until regenerated.
   */
  async getSnarkyMessage(): Promise<StateReadResult<string>> {
    const result = await this.snarkyMessageAccessor.read(this.sessionId)

    // 'default' = file missing, 'recovered' = file corrupt (default used after backup)
    if (result.source === 'default' || result.source === 'recovered') {
      return { data: '', source: 'default' }
    }

    return {
      data: result.data.message,
      source: 'fresh',
      mtime: result.mtime,
    }
  }

  /**
   * Read session persona state from session-persona.json.
   * Returns null data if file doesn't exist (not an error case).
   * Uses SessionPersonaDescriptor from feature-session-summary.
   *
   * @see docs/design/PERSONA-PROFILES-DESIGN.md
   */
  async getSessionPersona(): Promise<StateReadResult<SessionPersonaState | null>> {
    const result = await this.sessionPersonaAccessor.read(this.sessionId)

    // 'default' = file missing, 'recovered' = file corrupt (default used after backup)
    if (result.source === 'default' || result.source === 'recovered' || result.data === null) {
      return { data: null, source: 'default' }
    }

    return {
      data: result.data,
      source: 'fresh',
      mtime: result.mtime,
    }
  }

  /**
   * Read and parse log metrics from daemon, CLI, and global metric files.
   * Returns combined warning/error counts for the current session plus global daemon errors.
   * Uses log metrics accessors from typed state accessors.
   *
   * Daemon writes daemon-log-metrics.json (per-session),
   * CLI writes cli-log-metrics.json (per-session), and daemon writes
   * daemon-global-log-metrics.json (project-level, for logs without session context).
   * StatuslineService reads and sums all three.
   *
   * Staleness is determined by the `lastUpdatedAt` timestamp in the files.
   * This detects if the Daemon or CLI stopped updating.
   *
   * @see docs/design/FEATURE-STATUSLINE.md §6.2
   */
  async getLogMetrics(): Promise<StateReadResult<LocalLogMetricsState>> {
    // Read session-scoped metrics via accessors
    const [daemonResult, cliResult, globalResult] = await Promise.all([
      this.readSessionLogMetrics(this.daemonLogMetricsAccessor),
      this.readSessionLogMetrics(this.cliLogMetricsAccessor),
      this.readGlobalLogMetrics(),
    ])

    // Sum counts from all sources
    let warningCount = daemonResult.data.warningCount + cliResult.data.warningCount
    let errorCount = daemonResult.data.errorCount + cliResult.data.errorCount
    let lastUpdatedAt = Math.max(daemonResult.data.lastUpdatedAt, cliResult.data.lastUpdatedAt)

    if (globalResult) {
      warningCount += globalResult.data.warningCount
      errorCount += globalResult.data.errorCount
      lastUpdatedAt = Math.max(lastUpdatedAt, globalResult.data.lastUpdatedAt)
    }

    const combined: LocalLogMetricsState = {
      sessionId: daemonResult.data.sessionId || cliResult.data.sessionId || '',
      warningCount,
      errorCount,
      lastUpdatedAt,
    }

    // Determine combined source status
    const isStale =
      daemonResult.source === 'stale' ||
      cliResult.source === 'stale' ||
      (globalResult !== undefined && globalResult.source === 'stale')
    const isAllDefault =
      daemonResult.source === 'default' &&
      cliResult.source === 'default' &&
      (!globalResult || globalResult.source === 'default')

    return {
      source: isStale ? 'stale' : isAllDefault ? 'default' : 'fresh',
      data: combined,
      mtime: combined.lastUpdatedAt,
    }
  }

  /**
   * Read session-scoped log metrics via accessor.
   * Internal helper for getLogMetrics().
   */
  private async readSessionLogMetrics(
    accessor: SessionStateAccessor<LogMetricsState, LogMetricsState>
  ): Promise<StateReadResult<LocalLogMetricsState>> {
    const result = await accessor.read(this.sessionId)

    // 'default' = file missing, 'recovered' = file corrupt (default used after backup)
    if (result.source === 'default' || result.source === 'recovered') {
      return { source: 'default', data: EMPTY_LOG_METRICS }
    }

    const logMetrics = result.data

    // Use lastUpdatedAt timestamp for staleness detection
    const isStale = Date.now() - logMetrics.lastUpdatedAt > this.staleThresholdMs

    return {
      source: isStale ? 'stale' : 'fresh',
      data: logMetrics,
      mtime: logMetrics.lastUpdatedAt,
    }
  }

  /**
   * Read global log metrics via accessor.
   * Internal helper for getLogMetrics().
   */
  private async readGlobalLogMetrics(): Promise<StateReadResult<LocalLogMetricsState> | undefined> {
    const result = await this.daemonGlobalLogMetricsAccessor.read()

    // 'default' = file missing, 'recovered' = file corrupt (default used after backup)
    if (result.source === 'default' || result.source === 'recovered') {
      return { source: 'default', data: EMPTY_LOG_METRICS }
    }

    const logMetrics = result.data

    // Use lastUpdatedAt timestamp for staleness detection
    const isStale = Date.now() - logMetrics.lastUpdatedAt > this.staleThresholdMs

    return {
      source: isStale ? 'stale' : 'fresh',
      data: logMetrics,
      mtime: logMetrics.lastUpdatedAt,
    }
  }
}

/**
 * Factory function to create StateReader for a session.
 */
export function createStateReader(
  stateService: MinimalStateService,
  sessionId: string,
  options?: { staleThresholdMs?: number }
): StateReader {
  return new StateReader({
    stateService,
    sessionId,
    staleThresholdMs: options?.staleThresholdMs,
  })
}

// Re-export from dedicated resume-discovery module for backward compatibility
import {
  discoverPreviousResumeMessage as _discoverPreviousResumeMessage,
  projectRootFromSessionsDir,
  type DiscoveryResult,
} from './resume-discovery.js'
export type { DiscoveryResult }

/**
 * Backward-compatible wrapper for discoverPreviousResumeMessage.
 * Constructs a StateService internally to preserve the original call signature.
 * New callers should use the version from resume-discovery.ts directly with DI.
 *
 * @deprecated Use discoverPreviousResumeMessage from './resume-discovery.js' with injected StateService
 */
export async function discoverPreviousResumeMessage(
  sessionsDir: string,
  currentSessionId: string
): Promise<DiscoveryResult> {
  const projectRoot = projectRootFromSessionsDir(sessionsDir)
  const stateService = new StateService(projectRoot)
  return _discoverPreviousResumeMessage({ sessionsDir, currentSessionId }, stateService)
}
