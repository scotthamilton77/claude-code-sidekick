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
import type { ZodTypeAny } from 'zod'

import type { StateReadResult, SessionState, SessionSummaryState, ResumeMessageState } from './types.js'
import {
  SessionStateSchema,
  SessionSummaryStateSchema,
  ResumeMessageStateSchema,
  EMPTY_SESSION_STATE,
  EMPTY_SESSION_SUMMARY,
} from './types.js'

/** Maximum age (ms) before data is considered stale */
const STALE_THRESHOLD_MS = 60_000 // 60 seconds

/**
 * Configuration for StateReader.
 */
export interface StateReaderConfig {
  /** Session state directory (e.g., .sidekick/sessions/{id}/state/) */
  stateDir: string
  /** Threshold in ms for staleness detection */
  staleThresholdMs?: number
}

/**
 * Reads state files for statusline rendering.
 * Returns fallback defaults if files are missing or corrupt.
 */
export class StateReader {
  private readonly stateDir: string
  private readonly staleThresholdMs: number

  constructor(config: StateReaderConfig) {
    this.stateDir = config.stateDir
    this.staleThresholdMs = config.staleThresholdMs ?? STALE_THRESHOLD_MS
  }

  /**
   * Read and parse session state from session-state.json.
   */
  async getSessionState(): Promise<StateReadResult<SessionState>> {
    return this.readAndParse('session-state.json', SessionStateSchema, EMPTY_SESSION_STATE)
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

      const isStale = Date.now() - stat.mtimeMs > this.staleThresholdMs
      return {
        data: parsed.data,
        source: isStale ? 'stale' : 'fresh',
        mtime: stat.mtimeMs,
      }
    } catch {
      return { data: null, source: 'default' }
    }
  }

  /**
   * Read snarky message from snarky-message.txt.
   * Returns empty string if file doesn't exist.
   */
  async getSnarkyMessage(): Promise<StateReadResult<string>> {
    const filePath = path.join(this.stateDir, 'snarky-message.txt')

    try {
      const stat = await fs.stat(filePath)
      const content = await fs.readFile(filePath, 'utf-8')
      const isStale = Date.now() - stat.mtimeMs > this.staleThresholdMs

      return {
        data: content.trim(),
        source: isStale ? 'stale' : 'fresh',
        mtime: stat.mtimeMs,
      }
    } catch {
      return { data: '', source: 'default' }
    }
  }

  /**
   * Generic read-and-parse helper with Zod validation.
   */
  private async readAndParse<T>(filename: string, schema: ZodTypeAny, defaultValue: T): Promise<StateReadResult<T>> {
    const filePath = path.join(this.stateDir, filename)

    try {
      const stat = await fs.stat(filePath)
      const content = await fs.readFile(filePath, 'utf-8')
      const parsed = schema.safeParse(JSON.parse(content))

      if (!parsed.success) {
        return { data: defaultValue, source: 'default' }
      }

      const isStale = Date.now() - stat.mtimeMs > this.staleThresholdMs
      return {
        data: parsed.data as T,
        source: isStale ? 'stale' : 'fresh',
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
export function createStateReader(sessionStateDir: string, options?: { staleThresholdMs?: number }): StateReader {
  return new StateReader({
    stateDir: sessionStateDir,
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

    // Collect resume messages with their mtimes
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
