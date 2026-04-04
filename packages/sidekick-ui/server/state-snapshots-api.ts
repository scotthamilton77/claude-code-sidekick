import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

// ============================================================================
// Types
// ============================================================================

export interface ApiStateSnapshot {
  timestamp: number
  sessionSummary?: Record<string, unknown>
  sessionPersona?: Record<string, unknown>
  snarkyMessage?: Record<string, unknown>
  resumeMessage?: Record<string, unknown>
  summaryCountdown?: Record<string, unknown>
}

interface JournalEntry {
  ts: number
  file: string
  data: Record<string, unknown> | null
}

// ============================================================================
// Constants
// ============================================================================

const FILE_KEY_TO_PROP: Record<string, keyof Omit<ApiStateSnapshot, 'timestamp'>> = {
  'session-summary': 'sessionSummary',
  'session-persona': 'sessionPersona',
  'snarky-message': 'snarkyMessage',
  'resume-message': 'resumeMessage',
  'summary-countdown': 'summaryCountdown',
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse state snapshots for a session.
 *
 * Tries to read state-history.jsonl and reconstruct cumulative snapshots.
 * Falls back to reading current state files if the journal doesn't exist.
 */
export async function parseStateSnapshots(projectDir: string, sessionId: string): Promise<ApiStateSnapshot[]> {
  const journalPath = join(projectDir, '.sidekick', 'sessions', sessionId, 'state-history.jsonl')

  let content: string
  try {
    content = await readFile(journalPath, 'utf-8')
  } catch (err) {
    if (isEnoent(err)) {
      return fallbackFromCurrentFiles(projectDir, sessionId)
    }
    throw err
  }

  return reconstructFromJournal(content)
}

// ============================================================================
// Private — journal reconstruction
// ============================================================================

function reconstructFromJournal(content: string): ApiStateSnapshot[] {
  if (!content.trim()) return []

  // Parse and validate entries
  const entries: JournalEntry[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue

    let parsed: unknown
    try {
      parsed = JSON.parse(trimmed)
    } catch {
      continue // skip malformed lines
    }

    if (!isValidEntry(parsed)) continue
    if (!(parsed.file in FILE_KEY_TO_PROP)) continue

    entries.push(parsed)
  }

  if (entries.length === 0) return []

  // Sort ascending by timestamp
  entries.sort((a, b) => a.ts - b.ts)

  // Walk entries chronologically, maintaining cumulative accumulator
  const accumulator = new Map<string, Record<string, unknown>>()
  const snapshots: ApiStateSnapshot[] = []

  for (const entry of entries) {
    const prop = FILE_KEY_TO_PROP[entry.file]

    if (entry.data === null) {
      accumulator.delete(prop)
    } else {
      accumulator.set(prop, entry.data)
    }

    const snapshot = buildSnapshot(entry.ts, accumulator)

    // Collapse same-timestamp entries into one snapshot (update last in-place)
    if (snapshots.length > 0 && snapshots[snapshots.length - 1].timestamp === entry.ts) {
      snapshots[snapshots.length - 1] = snapshot
    } else {
      snapshots.push(snapshot)
    }
  }

  return snapshots
}

function buildSnapshot(timestamp: number, accumulator: Map<string, Record<string, unknown>>): ApiStateSnapshot {
  const snapshot: ApiStateSnapshot = { timestamp }
  for (const [prop, data] of accumulator) {
    ;(snapshot as unknown as Record<string, unknown>)[prop] = data
  }
  return snapshot
}

function isValidEntry(value: unknown): value is JournalEntry {
  if (typeof value !== 'object' || value === null) return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry['ts'] === 'number' &&
    typeof entry['file'] === 'string' &&
    (entry['data'] === null ||
      (typeof entry['data'] === 'object' && entry['data'] !== null && !Array.isArray(entry['data'])))
  )
}

// ============================================================================
// Private — fallback from current state files
// ============================================================================

async function fallbackFromCurrentFiles(projectDir: string, sessionId: string): Promise<ApiStateSnapshot[]> {
  const stateDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'state')

  let files: string[]
  try {
    files = await readdir(stateDir)
  } catch {
    return []
  }

  // Only consider files whose stem is a known key
  const knownFiles = files.filter((f) => {
    const stem = f.replace(/\.json$/, '')
    return stem in FILE_KEY_TO_PROP
  })

  if (knownFiles.length === 0) return []

  // Read file contents and mtimes in parallel
  const results = await Promise.allSettled(
    knownFiles.map(async (filename) => {
      const filePath = join(stateDir, filename)
      const [rawContent, fileStat] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)])
      const stem = filename.replace(/\.json$/, '')
      const prop = FILE_KEY_TO_PROP[stem]
      const data = JSON.parse(rawContent) as Record<string, unknown>
      return { prop, data, mtime: fileStat.mtime.getTime() }
    })
  )

  const snapshot: ApiStateSnapshot = { timestamp: 0 }
  let maxMtime = 0
  let hasData = false

  for (const result of results) {
    if (result.status !== 'fulfilled') continue
    const { prop, data, mtime } = result.value
    ;(snapshot as unknown as Record<string, unknown>)[prop] = data
    if (mtime > maxMtime) maxMtime = mtime
    hasData = true
  }

  if (!hasData) return []

  snapshot.timestamp = maxMtime
  return [snapshot]
}

// ============================================================================
// Utility
// ============================================================================

function isEnoent(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}
