/**
 * Log Parsing Infrastructure
 *
 * NDJSON parser with streaming support for Sidekick log files.
 * Provides session filtering and log merging for time-travel debugging.
 *
 * Log files:
 * - CLI: .sidekick/logs/cli.log
 * - Daemon: .sidekick/logs/sidekickd.log
 *
 * @see docs/design/STRUCTURED-LOGGING.md §2.2 Log File Strategy
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2 Time Travel
 */

import type { SidekickEvent } from '@sidekick/types'
// Use local type guards to avoid CommonJS/ESM interop issues with Vite
import { isHookEvent, isTranscriptEvent } from '../types'

// Re-export type guards for convenience
export { isHookEvent, isTranscriptEvent }

// ============================================================================
// Types
// ============================================================================

/**
 * Pino log record fields added to every log entry.
 * @see docs/design/STRUCTURED-LOGGING.md §3.3 Log Record Format
 */
export interface PinoFields {
  /** Log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) */
  level: number
  /** Unix timestamp in milliseconds */
  time: number
  /** Process ID */
  pid: number
  /** Hostname */
  hostname: string
  /** Logger name (e.g., 'sidekick:cli') */
  name?: string
  /** Log message */
  msg?: string
}

/**
 * Source component that produced the log entry.
 * Used for filtering and display badges.
 */
export type LogSource = 'cli' | 'daemon'

/**
 * Parsed log record combining Pino metadata with Sidekick event data.
 * This bridges the raw NDJSON format with the UI's event model.
 */
export interface ParsedLogRecord {
  /** Pino metadata fields */
  pino: PinoFields
  /** Which component produced this log */
  source: LogSource
  /** Event type identifier (e.g., 'HookReceived', 'SummaryUpdated') */
  type?: string
  /** Event context with session/correlation IDs */
  context?: {
    session_id?: string
    sessionId?: string // Allow both formats for compatibility
    scope?: 'project' | 'user'
    correlation_id?: string
    correlationId?: string
    trace_id?: string
    traceId?: string
    hook?: string
    task_id?: string
  }
  /** Event payload */
  payload?: Record<string, unknown>
  /** Additional metadata (for transcript events) */
  metadata?: Record<string, unknown>
  /** Full event if parseable as SidekickEvent */
  event?: SidekickEvent
  /** Raw JSON for unknown/malformed entries */
  raw: Record<string, unknown>
}

/**
 * Result of parsing an NDJSON line.
 */
export type ParseResult = { ok: true; record: ParsedLogRecord } | { ok: false; error: string; line: string }

// ============================================================================
// NDJSON Parsing
// ============================================================================

/**
 * Parse a single NDJSON line into a ParsedLogRecord.
 *
 * Handles:
 * - Valid JSON with Pino fields
 * - Malformed JSON (returns error result)
 * - Empty lines (returns error result)
 *
 * @param line - Raw NDJSON line
 * @returns ParseResult with either parsed record or error
 */
export function parseLine(line: string): ParseResult {
  const trimmed = line.trim()

  if (!trimmed) {
    return { ok: false, error: 'Empty line', line }
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(trimmed) as Record<string, unknown>
  } catch {
    return { ok: false, error: 'Invalid JSON', line }
  }

  // Extract Pino fields
  const pino: PinoFields = {
    level: typeof parsed.level === 'number' ? parsed.level : 30,
    time: typeof parsed.time === 'number' ? parsed.time : Date.now(),
    pid: typeof parsed.pid === 'number' ? parsed.pid : 0,
    hostname: typeof parsed.hostname === 'string' ? parsed.hostname : 'unknown',
    name: typeof parsed.name === 'string' ? parsed.name : undefined,
    msg: typeof parsed.msg === 'string' ? parsed.msg : undefined,
  }

  // Extract source
  const source: LogSource =
    typeof parsed.source === 'string' && (parsed.source === 'cli' || parsed.source === 'daemon')
      ? parsed.source
      : pino.name?.includes('cli')
        ? 'cli'
        : pino.name?.includes('daemon')
          ? 'daemon'
          : 'cli'

  // Extract event fields
  const type = typeof parsed.type === 'string' ? parsed.type : undefined
  const context =
    typeof parsed.context === 'object' && parsed.context !== null
      ? (parsed.context as ParsedLogRecord['context'])
      : undefined
  const payload =
    typeof parsed.payload === 'object' && parsed.payload !== null
      ? (parsed.payload as Record<string, unknown>)
      : undefined
  const metadata =
    typeof parsed.metadata === 'object' && parsed.metadata !== null
      ? (parsed.metadata as Record<string, unknown>)
      : undefined

  // Try to reconstruct SidekickEvent if it looks like one
  let event: SidekickEvent | undefined
  if (parsed.kind === 'hook' || parsed.kind === 'transcript') {
    // This looks like a direct SidekickEvent in the log
    event = parsed as unknown as SidekickEvent
  }

  return {
    ok: true,
    record: {
      pino,
      source,
      type,
      context,
      payload,
      metadata,
      event,
      raw: parsed,
    },
  }
}

/**
 * Parse multiple NDJSON lines into an array of records.
 * Logs warnings for malformed lines and skips them.
 *
 * @param content - NDJSON content (multiple lines)
 * @param silent - If true, suppress console warnings (default: false)
 * @returns Array of successfully parsed records
 */
export function parseNdjson(content: string, silent = false): ParsedLogRecord[] {
  const lines = content.split('\n')
  const records: ParsedLogRecord[] = []

  for (let i = 0; i < lines.length; i++) {
    const result = parseLine(lines[i])
    if (result.ok) {
      records.push(result.record)
    } else if (result.line.trim()) {
      // Only warn for non-empty lines
      if (!silent) {
        console.warn(`[NDJSON Parser] Skipping malformed line ${i + 1}: ${result.error}`, {
          line: result.line.slice(0, 100), // Truncate long lines
        })
      }
    }
  }

  return records
}

/**
 * Parse NDJSON with error reporting.
 * Returns both successful records and parse errors.
 *
 * @param content - NDJSON content (multiple lines)
 * @returns Object with records array and errors array
 */
export function parseNdjsonWithErrors(content: string): {
  records: ParsedLogRecord[]
  errors: Array<{ line: number; error: string; content: string }>
} {
  const lines = content.split('\n')
  const records: ParsedLogRecord[] = []
  const errors: Array<{ line: number; error: string; content: string }> = []

  for (let i = 0; i < lines.length; i++) {
    const result = parseLine(lines[i])
    if (result.ok) {
      records.push(result.record)
    } else if (result.line.trim()) {
      // Only report non-empty line errors
      errors.push({ line: i + 1, error: result.error, content: result.line })
    }
  }

  return { records, errors }
}

// ============================================================================
// Streaming Parser
// ============================================================================

/**
 * Streaming NDJSON parser for processing large log files incrementally.
 * Handles partial lines across chunks.
 */
export class NdjsonStreamParser {
  private buffer = ''
  private readonly records: ParsedLogRecord[] = []

  /**
   * Process a chunk of NDJSON data.
   * Buffers partial lines until complete.
   *
   * @param chunk - Partial or complete NDJSON content
   * @param silent - If true, suppress console warnings for malformed lines
   * @returns New records parsed from this chunk
   */
  push(chunk: string, silent = false): ParsedLogRecord[] {
    this.buffer += chunk
    const lines = this.buffer.split('\n')

    // Keep the last (potentially incomplete) line in the buffer
    this.buffer = lines.pop() ?? ''

    const newRecords: ParsedLogRecord[] = []
    for (let i = 0; i < lines.length; i++) {
      const result = parseLine(lines[i])
      if (result.ok) {
        newRecords.push(result.record)
        this.records.push(result.record)
      } else if (result.line.trim()) {
        // Only warn for non-empty lines
        if (!silent) {
          console.warn(`[NDJSON Stream Parser] Skipping malformed line: ${result.error}`, {
            line: result.line.slice(0, 100), // Truncate long lines
          })
        }
      }
    }

    return newRecords
  }

  /**
   * Flush any remaining buffered content.
   * Call this after the stream ends.
   *
   * @returns Final record if buffer contained valid JSON
   */
  flush(): ParsedLogRecord | null {
    if (!this.buffer.trim()) {
      return null
    }

    const result = parseLine(this.buffer)
    this.buffer = ''

    if (result.ok) {
      this.records.push(result.record)
      return result.record
    }

    return null
  }

  /**
   * Get all records parsed so far.
   */
  getRecords(): ParsedLogRecord[] {
    return [...this.records]
  }

  /**
   * Reset parser state.
   */
  reset(): void {
    this.buffer = ''
    this.records.length = 0
  }
}

// ============================================================================
// Session Filtering
// ============================================================================

/**
 * Get the session ID from a parsed log record.
 * Handles both snake_case and camelCase field names.
 */
export function getSessionId(record: ParsedLogRecord): string | undefined {
  // Check context first
  if (record.context) {
    return record.context.session_id ?? record.context.sessionId
  }

  // Check embedded event
  if (record.event?.context) {
    return record.event.context.sessionId
  }

  // Check raw payload as fallback
  const raw = record.raw
  if (typeof raw.context === 'object' && raw.context !== null) {
    const ctx = raw.context as Record<string, unknown>
    if (typeof ctx.session_id === 'string') return ctx.session_id
    if (typeof ctx.sessionId === 'string') return ctx.sessionId
  }

  return undefined
}

/**
 * Filter log records by session ID.
 *
 * @param records - Array of parsed log records
 * @param sessionId - Session ID to filter by
 * @returns Records matching the given session ID
 */
export function filterBySessionId(records: ParsedLogRecord[], sessionId: string): ParsedLogRecord[] {
  return records.filter((record) => getSessionId(record) === sessionId)
}

// ============================================================================
// Log Merging
// ============================================================================

/**
 * Merge two log streams by timestamp.
 * Used to combine CLI and daemon logs for unified timeline.
 *
 * @param cliRecords - Records from cli.log
 * @param daemonRecords - Records from sidekickd.log
 * @returns Merged array sorted by timestamp (ascending)
 */
export function mergeLogStreams(cliRecords: ParsedLogRecord[], daemonRecords: ParsedLogRecord[]): ParsedLogRecord[] {
  const all = [...cliRecords, ...daemonRecords]

  // Sort by timestamp (ascending - oldest first)
  all.sort((a, b) => a.pino.time - b.pino.time)

  return all
}

/**
 * Merge and filter log streams by session.
 * Convenience function combining merge and filter.
 *
 * @param cliRecords - Records from cli.log
 * @param daemonRecords - Records from sidekickd.log
 * @param sessionId - Session ID to filter by
 * @returns Merged, filtered, and sorted records
 */
export function mergeAndFilterBySession(
  cliRecords: ParsedLogRecord[],
  daemonRecords: ParsedLogRecord[],
  sessionId: string
): ParsedLogRecord[] {
  const merged = mergeLogStreams(cliRecords, daemonRecords)
  return filterBySessionId(merged, sessionId)
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Convert Pino log level number to name.
 */
export function levelToName(level: number): string {
  switch (level) {
    case 10:
      return 'trace'
    case 20:
      return 'debug'
    case 30:
      return 'info'
    case 40:
      return 'warn'
    case 50:
      return 'error'
    case 60:
      return 'fatal'
    default:
      return 'unknown'
  }
}

/**
 * Extract all unique session IDs from records.
 */
export function getUniqueSessions(records: ParsedLogRecord[]): string[] {
  const sessions = new Set<string>()

  for (const record of records) {
    const sessionId = getSessionId(record)
    if (sessionId) {
      sessions.add(sessionId)
    }
  }

  return Array.from(sessions)
}

/**
 * Group records by session ID.
 */
export function groupBySession(records: ParsedLogRecord[]): Map<string, ParsedLogRecord[]> {
  const groups = new Map<string, ParsedLogRecord[]>()

  for (const record of records) {
    const sessionId = getSessionId(record) ?? '__no_session__'
    const group = groups.get(sessionId) ?? []
    group.push(record)
    groups.set(sessionId, group)
  }

  return groups
}
