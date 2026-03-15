import { readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * The 19 Sidekick event types visible in the timeline UI.
 * Mirrors TimelineSidekickEventType from src/types.ts — kept inline to avoid
 * cross-tsconfig imports (server uses tsconfig.node.json, src uses tsconfig.json).
 */
export type TimelineSidekickEventType =
  | 'reminder:staged' | 'reminder:unstaged' | 'reminder:consumed' | 'reminder:cleared'
  | 'decision:recorded'
  | 'session-summary:start' | 'session-summary:finish' | 'session-title:changed' | 'intent:changed'
  | 'snarky-message:start' | 'snarky-message:finish' | 'resume-message:start' | 'resume-message:finish'
  | 'persona:selected' | 'persona:changed'
  | 'statusline:rendered'
  | 'error:occurred'
  | 'hook:received' | 'hook:completed'

/** Timeline event returned by the API. Matches SidekickEvent from src/types.ts. */
export interface TimelineEvent {
  id: string
  timestamp: number
  type: TimelineSidekickEventType
  label: string
  detail?: string
  transcriptLineId: string
}

/**
 * The 19 event types visible in the timeline UI.
 * Any event type not in this set is filtered out.
 */
export const TIMELINE_EVENT_TYPES = new Set<string>([
  'reminder:staged',
  'reminder:unstaged',
  'reminder:consumed',
  'reminder:cleared',
  'decision:recorded',
  'session-summary:start',
  'session-summary:finish',
  'session-title:changed',
  'intent:changed',
  'snarky-message:start',
  'snarky-message:finish',
  'resume-message:start',
  'resume-message:finish',
  'persona:selected',
  'persona:changed',
  'statusline:rendered',
  'error:occurred',
  'hook:received',
  'hook:completed',
])

/** Parsed raw log entry before conversion to SidekickEvent */
export interface RawLogEntry {
  time: number
  type: string
  context?: { sessionId?: string }
  payload?: Record<string, unknown>
}

/**
 * Generate a human-readable label and optional detail from an event type and payload.
 */
export function generateLabel(
  type: TimelineSidekickEventType | string,
  payload: Record<string, unknown>
): { label: string; detail?: string } {
  switch (type) {
    case 'reminder:staged': {
      const name = (payload.reminderName as string) || 'unknown'
      const reason = payload.reason as string | undefined
      return { label: `Staged: ${name}`, ...(reason ? { detail: `reason: ${reason}` } : {}) }
    }
    case 'reminder:unstaged': {
      const name = (payload.reminderName as string) || 'unknown'
      const triggeredBy = payload.triggeredBy as string | undefined
      return { label: `Unstaged: ${name}`, ...(triggeredBy ? { detail: `triggeredBy: ${triggeredBy}` } : {}) }
    }
    case 'reminder:consumed': {
      const name = (payload.reminderName as string) || 'unknown'
      return { label: `Consumed: ${name}` }
    }
    case 'reminder:cleared': {
      const reminderType = (payload.reminderType as string) ?? 'all'
      return { label: `Cleared: ${reminderType}` }
    }
    case 'decision:recorded': {
      const decision = (payload.decision as string) || 'unknown'
      const reason = payload.reason as string | undefined
      return { label: `Decision: ${decision}`, ...(reason ? { detail: reason } : {}) }
    }
    case 'session-title:changed': {
      const newVal = (payload.newValue as string) || 'unknown'
      const confidence = payload.confidence as number | undefined
      return {
        label: `Title → "${newVal}"`,
        ...(confidence != null ? { detail: `confidence: ${confidence}` } : {}),
      }
    }
    case 'intent:changed': {
      const newVal = (payload.newValue as string) || 'unknown'
      const confidence = payload.confidence as number | undefined
      return {
        label: `Intent → "${newVal}"`,
        ...(confidence != null ? { detail: `confidence: ${confidence}` } : {}),
      }
    }
    case 'persona:selected': {
      const id = (payload.personaId as string) || 'unknown'
      return { label: `Persona chosen: ${id}` }
    }
    case 'persona:changed': {
      const from = (payload.personaFrom as string) || 'unknown'
      const to = (payload.personaTo as string) || 'unknown'
      return { label: `Persona: ${from} → ${to}` }
    }
    case 'error:occurred': {
      const errMsg = (payload.errorMessage as string) || 'unknown'
      const stack = payload.errorStack as string | undefined
      return {
        label: `Error: ${errMsg}`,
        ...(stack ? { detail: stack.slice(0, 120) } : {}),
      }
    }
    case 'snarky-message:start':
      return { label: 'Snarky Message…' }
    case 'snarky-message:finish': {
      const msg = payload.generatedMessage as string | undefined
      return {
        label: 'Snarky Message',
        ...(msg ? { detail: msg.slice(0, 80) } : {}),
      }
    }
    case 'session-summary:start':
      return { label: 'Summary Analysis Start' }
    case 'session-summary:finish': {
      const title = payload.title as string | undefined
      return {
        label: 'Summary Analysis Finish',
        ...(title ? { detail: `"${title}"` } : {}),
      }
    }
    case 'resume-message:start':
      return { label: 'Resume Started' }
    case 'resume-message:finish': {
      const msg = payload.snarky_comment as string | undefined
      return {
        label: 'Resume Complete',
        ...(msg ? { detail: msg.slice(0, 80) } : {}),
      }
    }
    case 'statusline:rendered': {
      const mode = payload.displayMode as string | undefined
      const stale = payload.staleData as boolean | undefined
      const tokens = payload.tokens as number | undefined
      const durMs = payload.durationMs as number | undefined
      const parts: string[] = []
      if (mode) parts.push(mode.replace(/_/g, ' '))
      if (stale) parts.push('(stale)')
      if (tokens) parts.push(`${tokens} tokens`)
      if (durMs != null) parts.push(`${durMs}ms`)
      const detail = parts.length > 0 ? parts.join(' · ') : undefined
      return { label: 'Statusline', ...(detail ? { detail } : {}) }
    }
    case 'hook:received': {
      const hookName = (payload.hook as string) || 'unknown'
      return { label: `Hook start: ${hookName}` }
    }
    case 'hook:completed': {
      const hookName = (payload.hook as string) || 'unknown'
      const durMs = payload.durationMs as number | undefined
      return {
        label: `Hook finish: ${hookName}`,
        ...(durMs != null ? { detail: `${durMs}ms` } : {}),
      }
    }
    default: {
      // Humanize: "some-unknown:type" → "Some Unknown Type"
      const humanized = type
        .replace(/[:\-]/g, ' ')
        .replace(/\b\w/g, (c) => c.toUpperCase())
      return { label: humanized }
    }
  }
}

/**
 * Read an NDJSON log file, returning parsed entries.
 * Returns empty array if the file doesn't exist or is empty.
 */
export async function readLogFile(filePath: string): Promise<RawLogEntry[]> {
  let content: string
  try {
    content = await readFile(filePath, 'utf-8')
  } catch {
    return []
  }

  if (!content.trim()) return []

  const entries: RawLogEntry[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.type !== 'string') continue
      if (typeof parsed.time !== 'number') continue

      // Pino flattens payload fields into the root object.
      // Extract everything that isn't Pino metadata or known structural fields as payload.
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { level: _, pid: _p, hostname: _h, name: _n, msg: _m, time, type, context, source: _s, ...payload } = parsed
      entries.push({
        time: time as number,
        type: type as string,
        context: context as { sessionId?: string } | undefined,
        payload,
      })
    } catch {
      // Skip malformed JSON lines
    }
  }

  return entries
}

/**
 * Find all log files matching a prefix in the logs directory.
 * Handles pino-roll rotation: sidekick.log, sidekick.1.log, sidekick.2.log, etc.
 */
export async function findLogFiles(logsDir: string, prefix: string): Promise<string[]> {
  try {
    const files = await readdir(logsDir)
    return files
      .filter((f) => f.startsWith(prefix) && f.endsWith('.log'))
      .map((f) => join(logsDir, f))
  } catch {
    return []
  }
}

/**
 * Parse timeline events from sidekick log files for a given session.
 *
 * Reads all sidekick*.log and sidekickd*.log files (including rotated),
 * filters by session ID and UI-visible event types, merges, and sorts
 * by timestamp ascending.
 */
export async function parseTimelineEvents(
  projectDir: string,
  sessionId: string
): Promise<TimelineEvent[]> {
  const logsDir = join(projectDir, '.sidekick', 'logs')

  const [cliFiles, daemonFiles] = await Promise.all([
    findLogFiles(logsDir, 'sidekick.'),
    findLogFiles(logsDir, 'sidekickd.'),
  ])

  const allFiles = [...cliFiles, ...daemonFiles]
  const fileResults = await Promise.all(allFiles.map(readLogFile))
  const allEntries = fileResults.flat()

  // Filter by sessionId, then by timeline-visible event types
  const filtered = allEntries.filter(
    (entry) =>
      entry.context?.sessionId === sessionId &&
      TIMELINE_EVENT_TYPES.has(entry.type)
  )

  // Sort by timestamp ascending
  filtered.sort((a, b) => a.time - b.time)

  // Convert to TimelineEvent[]
  return filtered.map((entry) => {
    const { label, detail } = generateLabel(entry.type, entry.payload || {})
    // Use stable ID based on timestamp + type so timeline events can reference
    // the corresponding transcript line (sidekick events interleaved in transcript
    // use the same ID format).
    const stableId = `sidekick-${entry.time}-${entry.type}`
    return {
      id: randomUUID(),
      timestamp: entry.time,
      type: entry.type as TimelineSidekickEventType,
      label,
      ...(detail !== undefined ? { detail } : {}),
      transcriptLineId: stableId,
    }
  })
}
