/**
 * StateJournal — append-only JSONL session state journal.
 *
 * Writes one line per state change to:
 *   .sidekick/sessions/{sessionId}/state-history.jsonl
 *
 * Deduplicates by comparing JSON.stringify(data) against the last written
 * value per (sessionId, file) pair. Primes the dedup map from the existing
 * journal on first write to a session so restarts don't re-emit unchanged state.
 */

import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join, dirname } from 'node:path'

// ============================================================================
// Types
// ============================================================================

export interface JournalEntry {
  ts: number
  file: string
  data: Record<string, unknown> | null
}

// ============================================================================
// Constants
// ============================================================================

const ALLOWLIST = new Set([
  'session-summary',
  'session-persona',
  'snarky-message',
  'resume-message',
  'summary-countdown',
])

// ============================================================================
// StateJournal
// ============================================================================

export class StateJournal {
  private readonly projectRoot: string

  /**
   * Per-session dedup map: sessionId → (file → last JSON.stringify(data))
   * Null sentinel stored for deletion entries.
   */
  private readonly dedupMaps = new Map<string, Map<string, string | null>>()

  /** Sessions whose dedup map has been primed from the existing journal. */
  private readonly primedSessions = new Set<string>()

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Append a state change entry for an allowlisted file if the data has changed.
   * Skips the write when `data` serialises identically to the last written value.
   */
  async appendIfChanged(sessionId: string, file: string, data: Record<string, unknown>): Promise<void> {
    if (!ALLOWLIST.has(file)) return

    await this.ensurePrimed(sessionId)

    const serialised = JSON.stringify(data)
    const dedupMap = this.getOrCreateDedupMap(sessionId)

    if (dedupMap.get(file) === serialised) return

    const entry: JournalEntry = { ts: Date.now(), file, data }
    await this.appendEntry(sessionId, entry)

    dedupMap.set(file, serialised)
  }

  /**
   * Append a deletion entry (data: null) for an allowlisted file.
   * Clears the dedup cache for that file so the next write is not suppressed.
   */
  async appendDeletion(sessionId: string, file: string): Promise<void> {
    if (!ALLOWLIST.has(file)) return

    await this.ensurePrimed(sessionId)

    const entry: JournalEntry = { ts: Date.now(), file, data: null }
    await this.appendEntry(sessionId, entry)

    // Clear dedup so subsequent writes with any data go through
    const dedupMap = this.getOrCreateDedupMap(sessionId)
    dedupMap.delete(file)
  }

  // --------------------------------------------------------------------------
  // Path helpers
  // --------------------------------------------------------------------------

  journalPath(sessionId: string): string {
    return join(this.projectRoot, '.sidekick', 'sessions', sessionId, 'state-history.jsonl')
  }

  // --------------------------------------------------------------------------
  // Private
  // --------------------------------------------------------------------------

  private getOrCreateDedupMap(sessionId: string): Map<string, string | null> {
    let map = this.dedupMaps.get(sessionId)
    if (!map) {
      map = new Map()
      this.dedupMaps.set(sessionId, map)
    }
    return map
  }

  /**
   * On first write to a session, read the existing journal (if any) and
   * build the dedup map from the last value written for each file key.
   * Corrupt lines are silently skipped.
   */
  private async ensurePrimed(sessionId: string): Promise<void> {
    if (this.primedSessions.has(sessionId)) return
    this.primedSessions.add(sessionId)

    let raw: string
    try {
      raw = await readFile(this.journalPath(sessionId), 'utf-8')
    } catch {
      // File doesn't exist yet — start fresh
      return
    }

    const dedupMap = this.getOrCreateDedupMap(sessionId)

    for (const line of raw.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let entry: JournalEntry
      try {
        entry = JSON.parse(trimmed) as JournalEntry
      } catch {
        // Corrupt line — skip it and continue
        continue
      }

      if (!ALLOWLIST.has(entry.file)) continue

      if (entry.data === null) {
        dedupMap.delete(entry.file)
      } else {
        dedupMap.set(entry.file, JSON.stringify(entry.data))
      }
    }
  }

  private async appendEntry(sessionId: string, entry: JournalEntry): Promise<void> {
    const path = this.journalPath(sessionId)
    await mkdir(dirname(path), { recursive: true })
    await appendFile(path, JSON.stringify(entry) + '\n')
  }
}
