# State Snapshot Viewer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Populate the existing StateTab component with historical state snapshots by adding a JSONL journal writer, API endpoint, and frontend hook.

**Architecture:** Three layers — (1) append-only JSONL journal writer hooking into `SessionStateAccessor.write()`/`delete()`, (2) API endpoint that reads the journal and reconstructs cumulative snapshots, (3) React hook that fetches and delivers snapshots to the already-built `StateTab`.

**Tech Stack:** TypeScript, Node.js `fs/promises`, itty-router, React hooks, Vitest

**Spec:** `docs/superpowers/specs/2026-04-04-state-snapshot-viewer-design.md`

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/sidekick-core/src/state/state-journal.ts` | Journal appender: allowlist, change detection, append, deletion entries |
| Create | `packages/sidekick-core/src/state/__tests__/state-journal.test.ts` | Unit tests for journal writer |
| Modify | `packages/sidekick-core/src/state/typed-accessor.ts` | Hook `SessionStateAccessor.write()` and `delete()` to call journal appender |
| Create | `packages/sidekick-ui/server/state-snapshots-api.ts` | JSONL parsing, reconstruction algorithm, fallback for old sessions |
| Create | `packages/sidekick-ui/server/__tests__/state-snapshots-api.test.ts` | Unit tests for reconstruction algorithm |
| Create | `packages/sidekick-ui/server/handlers/state-snapshots.ts` | Thin HTTP handler: validate params, call API module |
| Create | `packages/sidekick-ui/server/__tests__/handlers/state-snapshots.test.ts` | Handler tests |
| Modify | `packages/sidekick-ui/server/router.ts` | Add route for state-snapshots endpoint |
| Create | `packages/sidekick-ui/src/hooks/useStateSnapshots.ts` | React hook: fetch, cancel, error handling |
| Modify | `packages/sidekick-ui/src/App.tsx` | Wire hook output to DetailPanel |

---

## Task 1: State Journal Writer — Core Module

**Files:**
- Create: `packages/sidekick-core/src/state/state-journal.ts`
- Test: `packages/sidekick-core/src/state/__tests__/state-journal.test.ts`

### Overview

The `StateJournal` class manages an append-only JSONL file per session. It has an allowlist of files to journal, deduplicates by comparing serialized JSON strings, and supports deletion entries (`data: null`).

- [ ] **Step 1: Write failing tests for the journal writer**

Create `packages/sidekick-core/src/state/__tests__/state-journal.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { join } from 'node:path'

// Mock node:fs/promises
const mockAppendFile = vi.fn()
const mockReadFile = vi.fn()
const mockMkdir = vi.fn()

vi.mock('node:fs/promises', () => ({
  appendFile: (...args: unknown[]) => mockAppendFile(...args),
  readFile: (...args: unknown[]) => mockReadFile(...args),
  mkdir: (...args: unknown[]) => mockMkdir(...args),
}))

beforeEach(() => {
  mockAppendFile.mockClear()
  mockReadFile.mockClear()
  mockMkdir.mockClear()
  mockAppendFile.mockResolvedValue(undefined)
  mockMkdir.mockResolvedValue(undefined)
})

import { StateJournal } from '../state-journal.js'

describe('StateJournal', () => {
  const projectRoot = '/test/project'

  describe('appendIfChanged', () => {
    it('appends entry for allowlisted file with new data', async () => {
      const journal = new StateJournal(projectRoot)
      mockReadFile.mockRejectedValue({ code: 'ENOENT' }) // no existing journal

      await journal.appendIfChanged('session-1', 'session-summary', { title: 'Test' })

      expect(mockMkdir).toHaveBeenCalledWith(
        join(projectRoot, '.sidekick', 'sessions', 'session-1'),
        { recursive: true }
      )
      expect(mockAppendFile).toHaveBeenCalledTimes(1)
      const written = mockAppendFile.mock.calls[0][1] as string
      const parsed = JSON.parse(written.trim())
      expect(parsed.file).toBe('session-summary')
      expect(parsed.data).toEqual({ title: 'Test' })
      expect(typeof parsed.ts).toBe('number')
    })

    it('skips write when data is identical to previous', async () => {
      const journal = new StateJournal(projectRoot)
      mockReadFile.mockRejectedValue({ code: 'ENOENT' })

      await journal.appendIfChanged('session-1', 'session-summary', { title: 'Test' })
      mockAppendFile.mockClear()

      await journal.appendIfChanged('session-1', 'session-summary', { title: 'Test' })

      expect(mockAppendFile).not.toHaveBeenCalled()
    })

    it('writes when data changes', async () => {
      const journal = new StateJournal(projectRoot)
      mockReadFile.mockRejectedValue({ code: 'ENOENT' })

      await journal.appendIfChanged('session-1', 'session-summary', { title: 'V1' })
      mockAppendFile.mockClear()

      await journal.appendIfChanged('session-1', 'session-summary', { title: 'V2' })

      expect(mockAppendFile).toHaveBeenCalledTimes(1)
    })

    it('silently skips files not in the allowlist', async () => {
      const journal = new StateJournal(projectRoot)
      mockReadFile.mockRejectedValue({ code: 'ENOENT' })

      await journal.appendIfChanged('session-1', 'daemon-log-metrics', { count: 1 })

      expect(mockAppendFile).not.toHaveBeenCalled()
    })

    it('tracks different files independently', async () => {
      const journal = new StateJournal(projectRoot)
      mockReadFile.mockRejectedValue({ code: 'ENOENT' })

      await journal.appendIfChanged('session-1', 'session-summary', { title: 'T' })
      await journal.appendIfChanged('session-1', 'session-persona', { persona_id: 'cavil' })

      expect(mockAppendFile).toHaveBeenCalledTimes(2)
    })
  })

  describe('appendDeletion', () => {
    it('appends entry with null data for allowlisted file', async () => {
      const journal = new StateJournal(projectRoot)
      mockReadFile.mockRejectedValue({ code: 'ENOENT' })

      await journal.appendDeletion('session-1', 'resume-message')

      expect(mockAppendFile).toHaveBeenCalledTimes(1)
      const written = mockAppendFile.mock.calls[0][1] as string
      const parsed = JSON.parse(written.trim())
      expect(parsed.file).toBe('resume-message')
      expect(parsed.data).toBeNull()
    })

    it('clears dedup cache so next write is not skipped', async () => {
      const journal = new StateJournal(projectRoot)
      mockReadFile.mockRejectedValue({ code: 'ENOENT' })

      await journal.appendIfChanged('session-1', 'resume-message', { msg: 'hello' })
      await journal.appendDeletion('session-1', 'resume-message')
      mockAppendFile.mockClear()

      // Re-writing same data after deletion should append (not dedup)
      await journal.appendIfChanged('session-1', 'resume-message', { msg: 'hello' })
      expect(mockAppendFile).toHaveBeenCalledTimes(1)
    })

    it('silently skips files not in the allowlist', async () => {
      const journal = new StateJournal(projectRoot)

      await journal.appendDeletion('session-1', 'llm-metrics')

      expect(mockAppendFile).not.toHaveBeenCalled()
    })
  })

  describe('priming from existing journal', () => {
    it('primes dedup map from last entries in existing journal', async () => {
      const journal = new StateJournal(projectRoot)
      const existingJournal = [
        JSON.stringify({ ts: 1000, file: 'session-summary', data: { title: 'Old' } }),
        JSON.stringify({ ts: 2000, file: 'session-summary', data: { title: 'Current' } }),
      ].join('\n') + '\n'
      mockReadFile.mockResolvedValue(existingJournal)

      // Write identical data to what's in journal — should be skipped
      await journal.appendIfChanged('session-1', 'session-summary', { title: 'Current' })

      expect(mockAppendFile).not.toHaveBeenCalled()
    })

    it('handles corrupt journal gracefully (starts fresh)', async () => {
      const journal = new StateJournal(projectRoot)
      mockReadFile.mockResolvedValue('not valid json\n')

      await journal.appendIfChanged('session-1', 'session-summary', { title: 'Fresh' })

      expect(mockAppendFile).toHaveBeenCalledTimes(1)
    })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/state/__tests__/state-journal.test.ts`

Expected: FAIL — `state-journal.ts` module does not exist.

- [ ] **Step 3: Implement the state journal writer**

Create `packages/sidekick-core/src/state/state-journal.ts`:

```typescript
import { appendFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'

/** Files eligible for journaling (basename without .json extension) */
const ALLOWLIST = new Set([
  'session-summary',
  'session-persona',
  'snarky-message',
  'resume-message',
  'summary-countdown',
])

/** A single journal entry */
export interface JournalEntry {
  ts: number
  file: string
  data: Record<string, unknown> | null
}

/**
 * Append-only JSONL state journal with change detection.
 *
 * Tracks session state changes for time-travel debugging in the UI.
 * Each entry is a full snapshot of one state file (no diffs).
 * Change detection prevents writing identical state.
 */
export class StateJournal {
  /** Per-session dedup maps: sessionId → (fileKey → last JSON string) */
  private readonly dedupMaps = new Map<string, Map<string, string>>()
  /** Sessions whose dedup map has been primed from disk */
  private readonly primedSessions = new Set<string>()

  constructor(private readonly projectRoot: string) {}

  /**
   * Append a state change if the data differs from the last write.
   * No-op for files not in the allowlist.
   */
  async appendIfChanged(sessionId: string, fileKey: string, data: Record<string, unknown>): Promise<void> {
    if (!ALLOWLIST.has(fileKey)) return

    await this.ensurePrimed(sessionId)

    const json = JSON.stringify(data)
    const dedupMap = this.getDedupMap(sessionId)

    if (dedupMap.get(fileKey) === json) return // identical — skip

    dedupMap.set(fileKey, json)
    await this.appendEntry(sessionId, { ts: Date.now(), file: fileKey, data })
  }

  /**
   * Append a deletion entry (data: null) for a removed state file.
   * Clears the dedup cache so the next write is not skipped.
   */
  async appendDeletion(sessionId: string, fileKey: string): Promise<void> {
    if (!ALLOWLIST.has(fileKey)) return

    const dedupMap = this.getDedupMap(sessionId)
    dedupMap.delete(fileKey)
    await this.appendEntry(sessionId, { ts: Date.now(), file: fileKey, data: null })
  }

  private getDedupMap(sessionId: string): Map<string, string> {
    let map = this.dedupMaps.get(sessionId)
    if (!map) {
      map = new Map()
      this.dedupMaps.set(sessionId, map)
    }
    return map
  }

  private async ensurePrimed(sessionId: string): Promise<void> {
    if (this.primedSessions.has(sessionId)) return
    this.primedSessions.add(sessionId)

    const journalPath = this.journalPath(sessionId)
    let content: string
    try {
      content = await readFile(journalPath, 'utf-8')
    } catch {
      return // no existing journal — start fresh
    }

    const dedupMap = this.getDedupMap(sessionId)
    for (const line of content.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const entry = JSON.parse(trimmed) as JournalEntry
        if (entry.data === null) {
          dedupMap.delete(entry.file)
        } else {
          dedupMap.set(entry.file, JSON.stringify(entry.data))
        }
      } catch {
        // skip malformed lines
      }
    }
  }

  private async appendEntry(sessionId: string, entry: JournalEntry): Promise<void> {
    const sessionDir = join(this.projectRoot, '.sidekick', 'sessions', sessionId)
    await mkdir(sessionDir, { recursive: true })
    const journalPath = this.journalPath(sessionId)
    await appendFile(journalPath, JSON.stringify(entry) + '\n', 'utf-8')
  }

  private journalPath(sessionId: string): string {
    return join(this.projectRoot, '.sidekick', 'sessions', sessionId, 'state-history.jsonl')
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/state/__tests__/state-journal.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-core/src/state/state-journal.ts packages/sidekick-core/src/state/__tests__/state-journal.test.ts
git commit -m "feat(core): add state journal writer with change detection"
```

---

## Task 2: Hook Journal into SessionStateAccessor

**Files:**
- Modify: `packages/sidekick-core/src/state/typed-accessor.ts`
- Modify: `packages/sidekick-core/src/state/__tests__/typed-accessor.test.ts`

### Overview

Add an optional `StateJournal` parameter to `SessionStateAccessor`. When present, `write()` calls `appendIfChanged()` after the underlying write succeeds, and `delete()` calls `appendDeletion()`.

- [ ] **Step 1: Write failing tests for the journal hook**

Add to `packages/sidekick-core/src/state/__tests__/typed-accessor.test.ts` (new describe block at end):

```typescript
describe('SessionStateAccessor journal integration', () => {
  let mockStateService: MockStateService
  const sessionId = 'test-session-123'

  // Create a mock journal
  const mockJournal = {
    appendIfChanged: vi.fn().mockResolvedValue(undefined),
    appendDeletion: vi.fn().mockResolvedValue(undefined),
  }

  beforeEach(() => {
    mockStateService = new MockStateService('/test/project')
    mockJournal.appendIfChanged.mockClear()
    mockJournal.appendDeletion.mockClear()
  })

  it('calls journal.appendIfChanged after write when journal is provided', async () => {
    const descriptor = sessionState('session-summary.json', TestDataSchema, null)
    const accessor = new SessionStateAccessor(mockStateService, descriptor, mockJournal)
    const data: TestData = { id: 'test', value: 42 }

    await accessor.write(sessionId, data)

    expect(mockJournal.appendIfChanged).toHaveBeenCalledWith(
      sessionId,
      'session-summary',
      data
    )
  })

  it('calls journal.appendDeletion after delete when journal is provided', async () => {
    const descriptor = sessionState('session-summary.json', TestDataSchema, null)
    const accessor = new SessionStateAccessor(mockStateService, descriptor, mockJournal)

    await accessor.delete(sessionId)

    expect(mockJournal.appendDeletion).toHaveBeenCalledWith(
      sessionId,
      'session-summary'
    )
  })

  it('does not call journal when journal is not provided', async () => {
    const descriptor = sessionState('session-summary.json', TestDataSchema, null)
    const accessor = new SessionStateAccessor(mockStateService, descriptor)
    const data: TestData = { id: 'test', value: 42 }

    await accessor.write(sessionId, data)
    await accessor.delete(sessionId)

    // No errors thrown — graceful no-op
    expect(mockJournal.appendIfChanged).not.toHaveBeenCalled()
    expect(mockJournal.appendDeletion).not.toHaveBeenCalled()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/state/__tests__/typed-accessor.test.ts`

Expected: FAIL — `SessionStateAccessor` constructor doesn't accept a third parameter.

- [ ] **Step 3: Modify SessionStateAccessor to accept and use a journal**

Edit `packages/sidekick-core/src/state/typed-accessor.ts`:

Add the `StateJournalLike` interface at the top (after existing imports):

```typescript
/** Minimal interface for state journal — avoids hard dependency on StateJournal class */
export interface StateJournalLike {
  appendIfChanged(sessionId: string, fileKey: string, data: Record<string, unknown>): Promise<void>
  appendDeletion(sessionId: string, fileKey: string): Promise<void>
}
```

Modify the `SessionStateAccessor` class:

```typescript
export class SessionStateAccessor<T, D = undefined> {
  constructor(
    private readonly stateService: MinimalStateService,
    private readonly descriptor: StateDescriptor<T, D>,
    private readonly journal?: StateJournalLike
  ) {
    if (descriptor.scope !== 'session') {
      throw new Error(`SessionStateAccessor requires a session-scoped descriptor, got: ${descriptor.scope}`)
    }
  }
```

In `write()`, add journal call after the existing `stateService.write()`:

```typescript
  async write(sessionId: string, data: T): Promise<void> {
    const path = this.stateService.sessionStatePath(sessionId, this.descriptor.filename)
    await this.stateService.write(path, data, this.descriptor.schema, {
      trackHistory: this.descriptor.trackHistory,
    })
    // Journal the state change (no-op if journal not configured)
    if (this.journal) {
      const fileKey = this.descriptor.filename.replace(/\.json$/, '')
      await this.journal.appendIfChanged(sessionId, fileKey, data as Record<string, unknown>)
    }
  }
```

In `delete()`, add journal call after the existing `stateService.delete()`:

```typescript
  async delete(sessionId: string): Promise<void> {
    const path = this.stateService.sessionStatePath(sessionId, this.descriptor.filename)
    await this.stateService.delete(path)
    // Journal the deletion (no-op if journal not configured)
    if (this.journal) {
      const fileKey = this.descriptor.filename.replace(/\.json$/, '')
      await this.journal.appendDeletion(sessionId, fileKey)
    }
  }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/state/__tests__/typed-accessor.test.ts`

Expected: All tests PASS (both new and existing).

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-core/src/state/typed-accessor.ts packages/sidekick-core/src/state/__tests__/typed-accessor.test.ts
git commit -m "feat(core): hook state journal into SessionStateAccessor write/delete"
```

---

## Task 3: State Snapshots API — Reconstruction Module

**Files:**
- Create: `packages/sidekick-ui/server/state-snapshots-api.ts`
- Test: `packages/sidekick-ui/server/__tests__/state-snapshots-api.test.ts`

### Overview

Reads `state-history.jsonl`, reconstructs cumulative `StateSnapshot[]` with the accumulator algorithm. Includes fallback for pre-existing sessions without a journal.

- [ ] **Step 1: Write failing tests for the reconstruction algorithm**

Create `packages/sidekick-ui/server/__tests__/state-snapshots-api.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockReadFile = vi.fn()
const mockReaddir = vi.fn()
const mockStat = vi.fn()

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
  stat: (...args: unknown[]) => mockStat(...args),
}))

beforeEach(() => {
  mockReadFile.mockClear()
  mockReaddir.mockClear()
  mockStat.mockClear()
})

import { parseStateSnapshots } from '../state-snapshots-api.js'

describe('parseStateSnapshots', () => {
  const projectDir = '/test/project'
  const sessionId = 'session-1'

  it('reconstructs cumulative snapshots from journal entries', async () => {
    const journal = [
      JSON.stringify({ ts: 1000, file: 'session-summary', data: { title: 'Hello' } }),
      JSON.stringify({ ts: 2000, file: 'session-persona', data: { persona_id: 'cavil' } }),
      JSON.stringify({ ts: 3000, file: 'session-summary', data: { title: 'Updated' } }),
    ].join('\n') + '\n'
    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots(projectDir, sessionId)

    expect(snapshots).toHaveLength(3)
    // First: only summary
    expect(snapshots[0].timestamp).toBe(1000)
    expect(snapshots[0].sessionSummary).toEqual({ title: 'Hello' })
    expect(snapshots[0].sessionPersona).toBeUndefined()
    // Second: summary + persona (cumulative)
    expect(snapshots[1].timestamp).toBe(2000)
    expect(snapshots[1].sessionSummary).toEqual({ title: 'Hello' })
    expect(snapshots[1].sessionPersona).toEqual({ persona_id: 'cavil' })
    // Third: updated summary + persona (cumulative)
    expect(snapshots[2].timestamp).toBe(3000)
    expect(snapshots[2].sessionSummary).toEqual({ title: 'Updated' })
    expect(snapshots[2].sessionPersona).toEqual({ persona_id: 'cavil' })
  })

  it('collapses entries with the same timestamp into one snapshot', async () => {
    const journal = [
      JSON.stringify({ ts: 1000, file: 'session-summary', data: { title: 'T' } }),
      JSON.stringify({ ts: 1000, file: 'session-persona', data: { persona_id: 'jarvis' } }),
    ].join('\n') + '\n'
    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots(projectDir, sessionId)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].sessionSummary).toEqual({ title: 'T' })
    expect(snapshots[0].sessionPersona).toEqual({ persona_id: 'jarvis' })
  })

  it('handles deletion entries (data: null) by clearing the field', async () => {
    const journal = [
      JSON.stringify({ ts: 1000, file: 'resume-message', data: { msg: 'hi' } }),
      JSON.stringify({ ts: 2000, file: 'resume-message', data: null }),
    ].join('\n') + '\n'
    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots(projectDir, sessionId)

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].resumeMessage).toEqual({ msg: 'hi' })
    expect(snapshots[1].resumeMessage).toBeUndefined()
  })

  it('skips malformed journal lines', async () => {
    const journal = [
      'not json',
      JSON.stringify({ ts: 1000, file: 'session-summary', data: { title: 'OK' } }),
      '{"ts": "bad_ts"}',
    ].join('\n') + '\n'
    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots(projectDir, sessionId)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].sessionSummary).toEqual({ title: 'OK' })
  })

  it('falls back to current state files when journal does not exist', async () => {
    mockReadFile.mockImplementation((path: string) => {
      if (path.endsWith('state-history.jsonl')) return Promise.reject({ code: 'ENOENT' })
      if (path.endsWith('session-summary.json')) return Promise.resolve('{"title":"Fallback"}')
      if (path.endsWith('session-persona.json')) return Promise.resolve('{"persona_id":"jarvis"}')
      return Promise.reject({ code: 'ENOENT' })
    })
    mockReaddir.mockResolvedValue(['session-summary.json', 'session-persona.json'])
    mockStat.mockResolvedValue({ mtimeMs: 5000 })

    const snapshots = await parseStateSnapshots(projectDir, sessionId)

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].timestamp).toBe(5000)
    expect(snapshots[0].sessionSummary).toEqual({ title: 'Fallback' })
    expect(snapshots[0].sessionPersona).toEqual({ persona_id: 'jarvis' })
  })

  it('returns empty array when no journal and no state files', async () => {
    mockReadFile.mockRejectedValue({ code: 'ENOENT' })
    mockReaddir.mockRejectedValue({ code: 'ENOENT' })

    const snapshots = await parseStateSnapshots(projectDir, sessionId)

    expect(snapshots).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/ui test -- --run packages/sidekick-ui/server/__tests__/state-snapshots-api.test.ts`

Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement the state snapshots API module**

Create `packages/sidekick-ui/server/state-snapshots-api.ts`:

```typescript
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'

/** Journal entry from state-history.jsonl */
interface JournalEntry {
  ts: number
  file: string
  data: Record<string, unknown> | null
}

/** Maps journal file keys to StateSnapshot property names */
const FILE_KEY_TO_PROP: Record<string, string> = {
  'session-summary': 'sessionSummary',
  'session-persona': 'sessionPersona',
  'snarky-message': 'snarkyMessage',
  'resume-message': 'resumeMessage',
  'summary-countdown': 'summaryCountdown',
}

/** StateSnapshot as returned by the API (matches frontend types.ts) */
export interface ApiStateSnapshot {
  timestamp: number
  sessionSummary?: Record<string, unknown>
  sessionPersona?: Record<string, unknown>
  snarkyMessage?: Record<string, unknown>
  resumeMessage?: Record<string, unknown>
  summaryCountdown?: Record<string, unknown>
}

/**
 * Parse state snapshots from a session's state-history.jsonl.
 * Falls back to reading current state files if no journal exists.
 */
export async function parseStateSnapshots(
  projectDir: string,
  sessionId: string
): Promise<ApiStateSnapshot[]> {
  const journalPath = join(projectDir, '.sidekick', 'sessions', sessionId, 'state-history.jsonl')

  let content: string
  try {
    content = await readFile(journalPath, 'utf-8')
  } catch {
    return fallbackFromCurrentFiles(projectDir, sessionId)
  }

  return reconstructFromJournal(content)
}

function reconstructFromJournal(content: string): ApiStateSnapshot[] {
  // Parse entries, skip malformed lines
  const entries: JournalEntry[] = []
  for (const line of content.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed) continue
    try {
      const parsed = JSON.parse(trimmed) as Record<string, unknown>
      if (typeof parsed.ts !== 'number') continue
      if (typeof parsed.file !== 'string') continue
      if (parsed.data !== null && typeof parsed.data !== 'object') continue
      entries.push(parsed as unknown as JournalEntry)
    } catch {
      // skip malformed lines
    }
  }

  // Sort by timestamp ascending
  entries.sort((a, b) => a.ts - b.ts)

  // Walk entries, build cumulative snapshots
  const accumulator = new Map<string, Record<string, unknown>>()
  const snapshots: ApiStateSnapshot[] = []
  let currentTs: number | null = null

  for (const entry of entries) {
    // Apply to accumulator
    const propName = FILE_KEY_TO_PROP[entry.file]
    if (!propName) continue // unknown file key

    if (entry.data === null) {
      accumulator.delete(propName)
    } else {
      accumulator.set(propName, entry.data)
    }

    // Collapse same-timestamp entries
    if (entry.ts === currentTs && snapshots.length > 0) {
      // Update the last snapshot in place
      const last = snapshots[snapshots.length - 1]
      if (entry.data === null) {
        delete (last as Record<string, unknown>)[propName]
      } else {
        ;(last as Record<string, unknown>)[propName] = entry.data
      }
    } else {
      // New timestamp — emit new snapshot from accumulator
      const snapshot: ApiStateSnapshot = { timestamp: entry.ts }
      for (const [key, value] of accumulator) {
        ;(snapshot as Record<string, unknown>)[key] = value
      }
      snapshots.push(snapshot)
      currentTs = entry.ts
    }
  }

  return snapshots
}

async function fallbackFromCurrentFiles(
  projectDir: string,
  sessionId: string
): Promise<ApiStateSnapshot[]> {
  const stateDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'state')

  let files: string[]
  try {
    files = await readdir(stateDir)
  } catch {
    return []
  }

  const jsonFiles = files.filter(f => f.endsWith('.json'))
  if (jsonFiles.length === 0) return []

  let maxMtime = 0
  const snapshot: ApiStateSnapshot = { timestamp: 0 }

  for (const file of jsonFiles) {
    const fileKey = file.replace(/\.json$/, '')
    const propName = FILE_KEY_TO_PROP[fileKey]
    if (!propName) continue

    const filePath = join(stateDir, file)
    try {
      const [content, fileStat] = await Promise.all([
        readFile(filePath, 'utf-8'),
        stat(filePath),
      ])
      const data = JSON.parse(content) as Record<string, unknown>
      ;(snapshot as Record<string, unknown>)[propName] = data
      if (fileStat.mtimeMs > maxMtime) maxMtime = fileStat.mtimeMs
    } catch {
      // skip unreadable files
    }
  }

  snapshot.timestamp = maxMtime || Date.now()

  // Only return if we actually loaded any state
  const hasState = Object.keys(snapshot).some(k => k !== 'timestamp')
  return hasState ? [snapshot] : []
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/ui test -- --run packages/sidekick-ui/server/__tests__/state-snapshots-api.test.ts`

Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-ui/server/state-snapshots-api.ts packages/sidekick-ui/server/__tests__/state-snapshots-api.test.ts
git commit -m "feat(ui): add state snapshots API reconstruction module"
```

---

## Task 4: State Snapshots HTTP Handler + Route

**Files:**
- Create: `packages/sidekick-ui/server/handlers/state-snapshots.ts`
- Create: `packages/sidekick-ui/server/__tests__/handlers/state-snapshots.test.ts`
- Modify: `packages/sidekick-ui/server/router.ts`

- [ ] **Step 1: Write failing tests for the handler**

Create `packages/sidekick-ui/server/__tests__/handlers/state-snapshots.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { StatusError } from 'itty-router'
import type { ApiRequest } from '../../types.js'

const mockGetProjectById = vi.fn()
vi.mock('../../sessions-api.js', () => ({
  getProjectById: (...args: unknown[]) => mockGetProjectById(...args),
}))

const mockParseStateSnapshots = vi.fn()
vi.mock('../../state-snapshots-api.js', () => ({
  parseStateSnapshots: (...args: unknown[]) => mockParseStateSnapshots(...args),
}))

const mockAccess = vi.fn()
vi.mock('node:fs/promises', () => ({
  access: (...args: unknown[]) => mockAccess(...args),
}))

import { handleGetStateSnapshots } from '../../handlers/state-snapshots.js'

beforeEach(() => {
  mockGetProjectById.mockClear()
  mockParseStateSnapshots.mockClear()
  mockAccess.mockClear()
})

function fakeRequest(params: Record<string, string> = {}): ApiRequest {
  const req = new Request('http://localhost/api/projects/p/sessions/s/state-snapshots') as ApiRequest
  req.ctx = { registryRoot: '/registry' }
  Object.assign(req, params)
  return req
}

describe('handleGetStateSnapshots', () => {
  it('validates params, requires project, requires session, returns { snapshots }', async () => {
    const project = {
      id: '-Users-scott-proj',
      name: 'proj',
      projectDir: '/Users/scott/proj',
      branch: 'main',
      active: false,
    }
    mockGetProjectById.mockResolvedValue(project)
    mockAccess.mockResolvedValue(undefined)
    const snapshots = [{ timestamp: 1000, sessionSummary: { title: 'T' } }]
    mockParseStateSnapshots.mockResolvedValue(snapshots)

    const req = fakeRequest({ projectId: '-Users-scott-proj', sessionId: 'abc-123' })
    const result = await handleGetStateSnapshots(req)

    expect(result).toEqual({ snapshots })
    expect(mockParseStateSnapshots).toHaveBeenCalledWith('/Users/scott/proj', 'abc-123')
  })

  it('throws 404 when project not found', async () => {
    mockGetProjectById.mockResolvedValue(null)

    const req = fakeRequest({ projectId: 'nonexistent', sessionId: 'abc' })

    await expect(handleGetStateSnapshots(req)).rejects.toThrow(StatusError)
  })

  it('throws 400 for path traversal in projectId', async () => {
    const req = fakeRequest({ projectId: '../etc', sessionId: 'abc' })

    await expect(handleGetStateSnapshots(req)).rejects.toThrow(StatusError)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/ui test -- --run packages/sidekick-ui/server/__tests__/handlers/state-snapshots.test.ts`

Expected: FAIL — handler module does not exist.

- [ ] **Step 3: Implement the handler**

Create `packages/sidekick-ui/server/handlers/state-snapshots.ts`:

```typescript
import { parseStateSnapshots } from '../state-snapshots-api.js'
import type { ApiRequest } from '../types.js'
import { validatePathParam, requireProject, requireSession } from '../utils.js'

export async function handleGetStateSnapshots(req: ApiRequest): Promise<{ snapshots: unknown[] }> {
  const projectId = validatePathParam(req.projectId, 'project ID')
  const sessionId = validatePathParam(req.sessionId, 'session ID')
  const project = await requireProject(req.ctx.registryRoot, projectId)
  await requireSession(project.projectDir, sessionId)
  const snapshots = await parseStateSnapshots(project.projectDir, sessionId)
  return { snapshots }
}
```

- [ ] **Step 4: Add route to router.ts**

Edit `packages/sidekick-ui/server/router.ts`:

Add import at the top:

```typescript
import { handleGetStateSnapshots } from './handlers/state-snapshots.js'
```

Add route after the existing transcript route (line 25):

```typescript
    .get('/projects/:projectId/sessions/:sessionId/state-snapshots', handleGetStateSnapshots)
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/ui test -- --run packages/sidekick-ui/server/__tests__/handlers/state-snapshots.test.ts`

Expected: All tests PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-ui/server/handlers/state-snapshots.ts packages/sidekick-ui/server/__tests__/handlers/state-snapshots.test.ts packages/sidekick-ui/server/router.ts
git commit -m "feat(ui): add state-snapshots API endpoint and route"
```

---

## Task 5: Frontend Hook + App Wiring

**Files:**
- Create: `packages/sidekick-ui/src/hooks/useStateSnapshots.ts`
- Modify: `packages/sidekick-ui/src/App.tsx`

- [ ] **Step 1: Create the useStateSnapshots hook**

Create `packages/sidekick-ui/src/hooks/useStateSnapshots.ts`:

```typescript
import { useState, useEffect } from 'react'
import { toErrorMessage } from '../utils/toErrorMessage'
import type { StateSnapshot } from '../types'

export interface UseStateSnapshotsResult {
  snapshots: StateSnapshot[]
  loading: boolean
  error: string | null
}

export function useStateSnapshots(
  projectId: string | null,
  sessionId: string | null
): UseStateSnapshotsResult {
  const [snapshots, setSnapshots] = useState<StateSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId || !sessionId) {
      setSnapshots([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchStateSnapshots() {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId!)}/sessions/${encodeURIComponent(sessionId!)}/state-snapshots`
        )
        if (!res.ok) {
          throw new Error(`Failed to fetch state snapshots: ${res.status}`)
        }
        const { snapshots: apiSnapshots } = (await res.json()) as { snapshots: StateSnapshot[] }
        if (!cancelled) {
          setSnapshots(apiSnapshots)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(toErrorMessage(err))
          setSnapshots([])
          setLoading(false)
        }
      }
    }

    fetchStateSnapshots()

    return () => {
      cancelled = true
    }
  }, [projectId, sessionId])

  return { snapshots, loading, error }
}
```

- [ ] **Step 2: Wire the hook into App.tsx**

Edit `packages/sidekick-ui/src/App.tsx`:

Add import (after `useTranscript` import):

```typescript
import { useStateSnapshots } from './hooks/useStateSnapshots'
```

Add hook call (after the `useTranscript` call, around line 23):

```typescript
  const { snapshots: stateSnapshots } = useStateSnapshots(
    state.selectedProjectId,
    state.selectedSessionId
  )
```

Change the `<DetailPanel>` prop (line 137) from:

```typescript
stateSnapshots={selectedSession.stateSnapshots}
```

to:

```typescript
stateSnapshots={stateSnapshots}
```

- [ ] **Step 3: Run build and typecheck**

Run: `pnpm build && pnpm typecheck`

Expected: PASS with no type errors.

- [ ] **Step 4: Commit**

```bash
git add packages/sidekick-ui/src/hooks/useStateSnapshots.ts packages/sidekick-ui/src/App.tsx
git commit -m "feat(ui): add useStateSnapshots hook and wire into App"
```

---

## Task 6: Full Build Verification

- [ ] **Step 1: Run full build pipeline**

Run: `pnpm build && pnpm typecheck && pnpm lint`

Expected: All PASS.

- [ ] **Step 2: Run all affected test suites**

Run: `pnpm --filter @sidekick/core test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`

Run: `pnpm --filter @sidekick/ui test -- --run`

Expected: All tests PASS.

- [ ] **Step 3: Commit any lint/type fixes if needed**

If the build/lint/typecheck revealed issues, fix and commit:

```bash
git add -A
git commit -m "fix: address lint/type issues from state snapshot implementation"
```
