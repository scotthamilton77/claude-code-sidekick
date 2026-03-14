import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/**
 * The 16 Sidekick event types visible in the timeline UI.
 * Mirrors TimelineSidekickEventType from src/types.ts — kept inline to avoid
 * cross-tsconfig imports (server uses tsconfig.node.json, src uses tsconfig.json).
 */
export type TimelineSidekickEventType =
  | 'reminder:staged' | 'reminder:unstaged' | 'reminder:consumed'
  | 'decision:recorded'
  | 'session-summary:start' | 'session-summary:finish' | 'session-title:changed' | 'intent:changed'
  | 'snarky-message:start' | 'snarky-message:finish' | 'resume-message:start' | 'resume-message:finish'
  | 'persona:selected' | 'persona:changed'
  | 'statusline:rendered'
  | 'error:occurred'

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
 * The 16 event types visible in the timeline UI.
 * Any event type not in this set is filtered out.
 */
const TIMELINE_EVENT_TYPES = new Set<string>([
  'reminder:staged',
  'reminder:unstaged',
  'reminder:consumed',
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
])

/** Parsed raw log entry before conversion to SidekickEvent */
interface RawLogEntry {
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
    case 'decision:recorded': {
      const category = (payload.category as string) || 'unknown'
      const reasoning = payload.reasoning as string | undefined
      return { label: `Decision: ${category}`, ...(reasoning ? { detail: reasoning } : {}) }
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
      return { label: `Persona: ${id}` }
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
      return { label: 'Summary Started' }
    case 'session-summary:finish':
      return { label: 'Summary Complete' }
    case 'resume-message:start':
      return { label: 'Resume Started' }
    case 'resume-message:finish': {
      const msg = payload.generatedMessage as string | undefined
      return {
        label: 'Resume Complete',
        ...(msg ? { detail: msg.slice(0, 80) } : {}),
      }
    }
    case 'statusline:rendered': {
      const mode = payload.displayMode as string | undefined
      const stale = payload.staleData as boolean | undefined
      const detail = mode ? `${mode}${stale ? ' (stale)' : ''}` : undefined
      return { label: 'Statusline', ...(detail ? { detail } : {}) }
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
async function readLogFile(filePath: string): Promise<RawLogEntry[]> {
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

      entries.push({
        time: parsed.time as number,
        type: parsed.type as string,
        context: parsed.context as { sessionId?: string } | undefined,
        payload: (parsed.payload as Record<string, unknown>) || {},
      })
    } catch {
      // Skip malformed JSON lines
    }
  }

  return entries
}

/**
 * Parse timeline events from sidekick log files for a given session.
 *
 * Reads both cli.log and sidekickd.log, filters by session ID and
 * UI-visible event types, merges, and sorts by timestamp ascending.
 */
export async function parseTimelineEvents(
  projectDir: string,
  sessionId: string
): Promise<TimelineEvent[]> {
  const logsDir = join(projectDir, '.sidekick', 'logs')

  const [cliEntries, daemonEntries] = await Promise.all([
    readLogFile(join(logsDir, 'cli.log')),
    readLogFile(join(logsDir, 'sidekickd.log')),
  ])

  const allEntries = [...cliEntries, ...daemonEntries]

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
    return {
      id: randomUUID(),
      timestamp: entry.time,
      type: entry.type as TimelineSidekickEventType,
      label,
      ...(detail !== undefined ? { detail } : {}),
      transcriptLineId: '',
    }
  })
}
