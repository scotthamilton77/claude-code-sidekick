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
      const hookName = payload.hookName as string | undefined
      const reason = payload.reason as string | undefined
      const hookSuffix = hookName ? ` (${hookName})` : ''
      return { label: `Staged: ${name}${hookSuffix}`, ...(reason ? { detail: `reason: ${reason}` } : {}) }
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
      const title = (payload.title as string) || (payload.decision as string) || 'unknown'
      const reason = payload.reason as string | undefined
      return { label: `Decision: ${title}`, ...(reason ? { detail: reason } : {}) }
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
      return { label: 'Snarky Message Start' }
    case 'snarky-message:finish': {
      const msg = payload.generatedMessage as string | undefined
      return {
        label: msg ? `Snarky Message Finish: ${msg.slice(0, 60)}` : 'Snarky Message Finish',
      }
    }
    case 'session-summary:start':
      return { label: 'Session Analysis Start' }
    case 'session-summary:finish': {
      const title = (payload.session_title ?? payload.title) as string | undefined
      return {
        label: title ? `Session Analysis Finish: "${title.slice(0, 60)}"` : 'Session Analysis Finish',
      }
    }
    case 'resume-message:start':
      return { label: 'Resume Message Start' }
    case 'resume-message:finish': {
      const msg = payload.snarky_comment as string | undefined
      return {
        label: msg ? `Resume Message Finish: ${msg.slice(0, 60)}` : 'Resume Message Finish',
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
      if (tokens) parts.push(`${tokens} chat tokens`)
      if (durMs != null) parts.push(`${durMs}ms`)
      const detail = parts.length > 0 ? parts.join(' · ') : undefined
      return { label: 'Statusline called', ...(detail ? { detail } : {}) }
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
 * Always reads aggregate logs (.sidekick/logs/) for pre-migration events.
 * Also reads per-session logs (.sidekick/sessions/{sessionId}/logs/) when
 * they exist (post-rollout). Merges and deduplicates by time+type so that
 * sessions that span the rollout boundary show a complete timeline.
 */
export async function parseTimelineEvents(
  projectDir: string,
  sessionId: string
): Promise<TimelineEvent[]> {
  const sessionLogsDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'logs')
  const aggregateLogsDir = join(projectDir, '.sidekick', 'logs')

  // Run all directory listings in parallel — none depend on each other
  const [sessionCliFiles, sessionDaemonFiles, cliFiles, daemonFiles] = await Promise.all([
    findLogFiles(sessionLogsDir, 'sidekick.'),
    findLogFiles(sessionLogsDir, 'sidekickd.'),
    findLogFiles(aggregateLogsDir, 'sidekick.'),
    findLogFiles(aggregateLogsDir, 'sidekickd.'),
  ])

  const hasSessionLogs = sessionCliFiles.length > 0 || sessionDaemonFiles.length > 0

  // Read all files in parallel
  const allSessionFiles = hasSessionLogs ? [...sessionCliFiles, ...sessionDaemonFiles] : []
  const allAggregateFiles = [...cliFiles, ...daemonFiles]

  // Design intent was per-session-only (O(1) lookup) with aggregate as a fallback for
  // pre-migration sessions. We always read aggregate here because sessions can span the
  // rollout boundary — events from before the feature rollout land in aggregate only.
  // The 4MB aggregate cap (2MB × 2 files) bounds the overhead to an acceptable constant.
  const [sessionResults, aggregateResults] = await Promise.all([
    Promise.all(allSessionFiles.map(readLogFile)),
    Promise.all(allAggregateFiles.map(readLogFile)),
  ])

  const perSessionEntries: RawLogEntry[] = sessionResults.flat()
  const aggregateEntries = aggregateResults
    .flat()
    .filter((entry) => entry.context?.sessionId === sessionId)

  // Merge: per-session is authoritative; aggregate adds entries not already in per-session.
  // Deduplicate aggregate entries against per-session entries by time:type key.
  // This handles the rollout-boundary case where the same event was written to both sinks.
  // Known limitation: two legitimately distinct events of the same type at the exact same
  // millisecond from different sources will collide — the aggregate copy is dropped.
  // In practice this is vanishingly rare given Pino's millisecond-precision timestamps.
  const perSessionKeys = new Set(perSessionEntries.map((e) => `${e.time}:${e.type}`))
  const uniqueAggregateEntries = aggregateEntries.filter(
    (e) => !perSessionKeys.has(`${e.time}:${e.type}`)
  )
  const allEntries: RawLogEntry[] = [...perSessionEntries, ...uniqueAggregateEntries]

  // Filter by timeline-visible event types
  const filtered = allEntries.filter(
    (entry) => TIMELINE_EVENT_TYPES.has(entry.type)
  )

  // Sort by timestamp ascending
  filtered.sort((a, b) => a.time - b.time)

  // Convert to TimelineEvent[], deduplicating transcriptLineId for same-timestamp
  // same-type events (mirrors the dedup scheme in readSidekickEvents).
  const seen = new Map<string, number>()
  return filtered.map((entry) => {
    const { label, detail } = generateLabel(entry.type, entry.payload || {})
    const baseId = `sidekick-${entry.time}-${entry.type}`
    const count = (seen.get(baseId) ?? 0) + 1
    seen.set(baseId, count)
    const stableId = count > 1 ? `${baseId}-${count}` : baseId
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
