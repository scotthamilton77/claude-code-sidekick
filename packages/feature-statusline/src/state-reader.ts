/**
 * StateReader - Safe file reading with fallback defaults
 *
 * Handles reading state files from .sidekick/sessions/{id}/state/ with:
 * - Graceful fallback on missing/corrupt files
 * - Staleness detection based on file mtime
 * - Zod validation with safe parsing
 *
 * Also provides `discoverPreviousResumeMessage()` for artifact discovery:
 * - Scans sessions directory for resume messages from previous sessions
 * - Used by statusline to show context when starting a new session
 *
 * @see docs/design/FEATURE-STATUSLINE.md §5.2 StateReader
 * @see docs/design/FEATURE-RESUME.md §3.1 Artifact Discovery
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { ZodType } from 'zod'

import type {
  ResumeMessageState,
  TranscriptMetricsState,
  SessionSummaryState,
  StateReadResult,
  LogMetricsState,
} from './types.js'
import {
  EMPTY_TRANSCRIPT_STATE,
  EMPTY_SESSION_SUMMARY,
  EMPTY_LOG_METRICS,
  PersistedTranscriptStateSchema,
  ResumeMessageStateSchema,
  SessionSummaryStateSchema,
  LogMetricsStateSchema,
  SnarkyMessageStateSchema,
} from './types.js'

/** Maximum age (ms) before data is considered stale */
const STALE_THRESHOLD_MS = 60_000 // 60 seconds

/**
 * Configuration for StateReader.
 */
export interface StateReaderConfig {
  /** Session state directory (e.g., .sidekick/sessions/{id}/state/) */
  stateDir: string
  /** Project state directory (e.g., .sidekick/state/) for global daemon metrics */
  projectStateDir?: string
  /** Threshold in ms for staleness detection */
  staleThresholdMs?: number
}

/**
 * Reads state files for statusline rendering.
 * Returns fallback defaults if files are missing or corrupt.
 */
export class StateReader {
  private readonly stateDir: string
  private readonly projectStateDir: string | null
  private readonly staleThresholdMs: number

  constructor(config: StateReaderConfig) {
    this.stateDir = config.stateDir
    this.projectStateDir = config.projectStateDir ?? null
    this.staleThresholdMs = config.staleThresholdMs ?? STALE_THRESHOLD_MS
  }

  /**
   * Read and parse transcript metrics from transcript-metrics.json.
   * Returns only fields that are persisted by TranscriptService.
   *
   * Staleness is determined by the `persistedAt` timestamp in the file,
   * not the file mtime. This detects if the Daemon stopped updating.
   */
  async getTranscriptMetrics(): Promise<StateReadResult<TranscriptMetricsState>> {
    const filePath = path.join(this.stateDir, 'transcript-metrics.json')

    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = PersistedTranscriptStateSchema.safeParse(JSON.parse(content))

      if (!parsed.success) {
        return { source: 'default', data: EMPTY_TRANSCRIPT_STATE }
      }

      const persistedState = parsed.data
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
    } catch {
      return { source: 'default', data: EMPTY_TRANSCRIPT_STATE }
    }
  }

  /**
   * @deprecated Use getTranscriptMetrics() instead
   */
  async getSessionState(): Promise<StateReadResult<TranscriptMetricsState>> {
    return this.getTranscriptMetrics()
  }

  /**
   * Read and parse session summary from session-summary.json.
   */
  async getSessionSummary(): Promise<StateReadResult<SessionSummaryState>> {
    return this.readAndParse('session-summary.json', SessionSummaryStateSchema, EMPTY_SESSION_SUMMARY)
  }

  /**
   * Read and parse resume message from resume-message.json.
   * Returns null data if file doesn't exist (not an error case).
   *
   * Content artifacts don't have staleness - they're valid until regenerated.
   */
  async getResumeMessage(): Promise<StateReadResult<ResumeMessageState | null>> {
    const filePath = path.join(this.stateDir, 'resume-message.json')

    try {
      const stat = await fs.stat(filePath)
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = ResumeMessageStateSchema.safeParse(JSON.parse(content))

      if (!parsed.success) {
        return { data: null, source: 'default' }
      }

      return {
        data: parsed.data,
        source: 'fresh',
        mtime: stat.mtimeMs,
      }
    } catch {
      return { data: null, source: 'default' }
    }
  }

  /**
   * Read snarky message from snarky-message.json.
   * Returns empty string if file doesn't exist.
   *
   * Content artifacts don't have staleness - they're valid until regenerated.
   */
  async getSnarkyMessage(): Promise<StateReadResult<string>> {
    const filePath = path.join(this.stateDir, 'snarky-message.json')

    try {
      const stat = await fs.stat(filePath)
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = SnarkyMessageStateSchema.safeParse(JSON.parse(content))

      if (!parsed.success) {
        return { data: '', source: 'default' }
      }

      return {
        data: parsed.data.message,
        source: 'fresh',
        mtime: stat.mtimeMs,
      }
    } catch {
      return { data: '', source: 'default' }
    }
  }

  /**
   * Read and parse log metrics from daemon, CLI, and global metric files.
   * Returns combined warning/error counts for the current session plus global daemon errors.
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
  async getLogMetrics(): Promise<StateReadResult<LogMetricsState>> {
    const daemonPath = path.join(this.stateDir, 'daemon-log-metrics.json')
    const cliPath = path.join(this.stateDir, 'cli-log-metrics.json')

    const readPromises: Promise<StateReadResult<LogMetricsState>>[] = [
      this.readLogMetricsFile(daemonPath),
      this.readLogMetricsFile(cliPath),
    ]

    // Also read global daemon metrics if project state dir is configured
    if (this.projectStateDir) {
      const globalPath = path.join(this.projectStateDir, 'daemon-global-log-metrics.json')
      readPromises.push(this.readLogMetricsFile(globalPath))
    }

    const results = await Promise.all(readPromises)
    const [daemonResult, cliResult, globalResult] = results

    // Sum counts from all sources
    let warningCount = daemonResult.data.warningCount + cliResult.data.warningCount
    let errorCount = daemonResult.data.errorCount + cliResult.data.errorCount
    let lastUpdatedAt = Math.max(daemonResult.data.lastUpdatedAt, cliResult.data.lastUpdatedAt)

    if (globalResult) {
      warningCount += globalResult.data.warningCount
      errorCount += globalResult.data.errorCount
      lastUpdatedAt = Math.max(lastUpdatedAt, globalResult.data.lastUpdatedAt)
    }

    const combined: LogMetricsState = {
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
   * Read and parse a single log metrics file.
   * Internal helper for getLogMetrics().
   */
  private async readLogMetricsFile(filePath: string): Promise<StateReadResult<LogMetricsState>> {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = LogMetricsStateSchema.safeParse(JSON.parse(content))

      if (!parsed.success) {
        return { source: 'default', data: EMPTY_LOG_METRICS }
      }

      const logMetrics = parsed.data

      // Use lastUpdatedAt timestamp for staleness detection
      const isStale = Date.now() - logMetrics.lastUpdatedAt > this.staleThresholdMs

      return {
        source: isStale ? 'stale' : 'fresh',
        data: logMetrics,
        mtime: logMetrics.lastUpdatedAt,
      }
    } catch {
      return { source: 'default', data: EMPTY_LOG_METRICS }
    }
  }

  /**
   * Generic read-and-parse helper with Zod validation.
   *
   * Used for content artifacts which don't have staleness - they're valid until regenerated.
   */
  private async readAndParse<T>(filename: string, schema: ZodType<T>, defaultValue: T): Promise<StateReadResult<T>> {
    const filePath = path.join(this.stateDir, filename)

    try {
      const stat = await fs.stat(filePath)
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = schema.safeParse(JSON.parse(content))

      if (!parsed.success) {
        return { data: defaultValue, source: 'default' }
      }

      return {
        data: parsed.data,
        source: 'fresh',
        mtime: stat.mtimeMs,
      }
    } catch {
      return { data: defaultValue, source: 'default' }
    }
  }
}

/**
 * Factory function to create StateReader for a session.
 */
export function createStateReader(
  sessionStateDir: string,
  options?: { staleThresholdMs?: number; projectStateDir?: string }
): StateReader {
  return new StateReader({
    stateDir: sessionStateDir,
    projectStateDir: options?.projectStateDir,
    staleThresholdMs: options?.staleThresholdMs,
  })
}

/**
 * Discovery result for finding resume messages from previous sessions.
 */
export interface DiscoveryResult {
  /** Resume message data if found */
  data: ResumeMessageState | null
  /** Session ID that the resume message belongs to */
  sessionId: string | null
  /** Source of the data */
  source: 'discovered' | 'not_found'
}

/**
 * Discover the most recent resume message from a PREVIOUS session.
 * Scans the sessions directory for other sessions with valid resume-message.json.
 *
 * Per docs/design/FEATURE-RESUME.md §3.1:
 * - Used when current session is new (no session-summary.json yet)
 * - Returns the most recent OTHER session's resume-message.json
 *
 * @param sessionsDir - Path to .sidekick/sessions/ directory
 * @param currentSessionId - Current session ID to exclude from results
 * @returns Discovery result with most recent previous session's resume message
 */
export async function discoverPreviousResumeMessage(
  sessionsDir: string,
  currentSessionId: string
): Promise<DiscoveryResult> {
  try {
    // List all session directories
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true })
    const sessionDirs = entries.filter((e) => e.isDirectory() && e.name !== currentSessionId)

    if (sessionDirs.length === 0) {
      return { data: null, sessionId: null, source: 'not_found' }
    }

    // Collect resume messages with their modification times
    const resumeCandidates: { sessionId: string; data: ResumeMessageState; mtime: number }[] = []

    for (const dir of sessionDirs) {
      const resumePath = path.join(sessionsDir, dir.name, 'state', 'resume-message.json')
      try {
        const stat = await fs.stat(resumePath)
        const content = await fs.readFile(resumePath, 'utf-8')
        const parsed = ResumeMessageStateSchema.safeParse(JSON.parse(content))

        if (parsed.success) {
          resumeCandidates.push({
            sessionId: dir.name,
            data: parsed.data,
            mtime: stat.mtimeMs,
          })
        }
      } catch {
        // File doesn't exist or is invalid - skip this session
        continue
      }
    }

    if (resumeCandidates.length === 0) {
      return { data: null, sessionId: null, source: 'not_found' }
    }

    // Sort by mtime descending (most recent first)
    resumeCandidates.sort((a, b) => b.mtime - a.mtime)

    const mostRecent = resumeCandidates[0]
    return {
      data: mostRecent.data,
      sessionId: mostRecent.sessionId,
      source: 'discovered',
    }
  } catch {
    // Sessions directory doesn't exist or other error
    return { data: null, sessionId: null, source: 'not_found' }
  }
}
