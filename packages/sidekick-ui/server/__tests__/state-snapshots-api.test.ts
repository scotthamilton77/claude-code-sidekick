import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node:fs/promises
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

// Import AFTER mocks
import { parseStateSnapshots } from '../state-snapshots-api.js'

// ============================================================================
// Helpers
// ============================================================================

function makeEntry(ts: number, file: string, data: Record<string, unknown> | null): string {
  return JSON.stringify({ ts, file, data })
}

// ============================================================================
// reconstructFromJournal
// ============================================================================

describe('parseStateSnapshots — journal reconstruction', () => {
  it('produces cumulative snapshots: 3 entries accumulate state', async () => {
    const summaryData = { session_title: 'Test Session' }
    const personaData = { persona_id: 'jarvis' }
    const updatedSummaryData = { session_title: 'Updated Session' }

    const journal = [
      makeEntry(1000, 'session-summary', summaryData),
      makeEntry(2000, 'session-persona', personaData),
      makeEntry(3000, 'session-summary', updatedSummaryData),
    ].join('\n')

    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toHaveLength(3)

    // First: only summary
    expect(snapshots[0]).toEqual({
      timestamp: 1000,
      sessionSummary: summaryData,
    })

    // Second: summary + persona
    expect(snapshots[1]).toEqual({
      timestamp: 2000,
      sessionSummary: summaryData,
      sessionPersona: personaData,
    })

    // Third: updated summary + persona (accumulated)
    expect(snapshots[2]).toEqual({
      timestamp: 3000,
      sessionSummary: updatedSummaryData,
      sessionPersona: personaData,
    })
  })

  it('collapses same-timestamp entries into a single snapshot', async () => {
    const summaryData = { session_title: 'Session A' }
    const personaData = { persona_id: 'yoda' }

    const journal = [
      makeEntry(1000, 'session-summary', summaryData),
      makeEntry(1000, 'session-persona', personaData),
    ].join('\n')

    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]).toEqual({
      timestamp: 1000,
      sessionSummary: summaryData,
      sessionPersona: personaData,
    })
  })

  it('handles deletion: second snapshot has field cleared (undefined)', async () => {
    const summaryData = { session_title: 'To Delete' }

    const journal = [makeEntry(1000, 'session-summary', summaryData), makeEntry(2000, 'session-summary', null)].join(
      '\n'
    )

    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toHaveLength(2)
    expect(snapshots[0].sessionSummary).toEqual(summaryData)
    expect(snapshots[1].sessionSummary).toBeUndefined()
  })

  it('skips malformed JSON lines and only processes valid entries', async () => {
    const summaryData = { session_title: 'Valid' }

    const journal = ['not valid json at all', makeEntry(1000, 'session-summary', summaryData), '{broken json'].join(
      '\n'
    )

    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].sessionSummary).toEqual(summaryData)
  })

  it('skips entries with unknown file keys', async () => {
    const journal = [
      makeEntry(1000, 'unknown-file-key', { foo: 'bar' }),
      makeEntry(2000, 'session-summary', { session_title: 'Known' }),
    ].join('\n')

    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    // Only the known key creates a snapshot
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].timestamp).toBe(2000)
  })

  it('returns empty array for empty journal', async () => {
    mockReadFile.mockResolvedValue('')

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toEqual([])
  })

  it('handles all five known file keys mapping correctly', async () => {
    const journal = [
      makeEntry(1000, 'session-summary', { s: 1 }),
      makeEntry(2000, 'session-persona', { p: 1 }),
      makeEntry(3000, 'snarky-message', { m: 1 }),
      makeEntry(4000, 'resume-message', { r: 1 }),
      makeEntry(5000, 'summary-countdown', { c: 1 }),
    ].join('\n')

    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toHaveLength(5)
    const last = snapshots[4]
    expect(last.sessionSummary).toEqual({ s: 1 })
    expect(last.sessionPersona).toEqual({ p: 1 })
    expect(last.snarkyMessage).toEqual({ m: 1 })
    expect(last.resumeMessage).toEqual({ r: 1 })
    expect(last.summaryCountdown).toEqual({ c: 1 })
  })

  it('sorts entries by timestamp before accumulating', async () => {
    // Lines out of chronological order
    const journal = [
      makeEntry(3000, 'session-persona', { persona_id: 'later' }),
      makeEntry(1000, 'session-summary', { session_title: 'First' }),
      makeEntry(2000, 'session-persona', { persona_id: 'earlier' }),
    ].join('\n')

    mockReadFile.mockResolvedValue(journal)

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toHaveLength(3)
    expect(snapshots[0].timestamp).toBe(1000)
    expect(snapshots[1].timestamp).toBe(2000)
    expect(snapshots[2].timestamp).toBe(3000)
    // Persona at ts=3000 should be 'later', overriding 'earlier' from ts=2000
    expect(snapshots[2].sessionPersona).toEqual({ persona_id: 'later' })
  })
})

// ============================================================================
// fallbackFromCurrentFiles
// ============================================================================

describe('parseStateSnapshots — fallback (no journal)', () => {
  it('returns a single snapshot from current state files when journal is absent', async () => {
    const enoentError = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    mockReadFile.mockImplementation((path: string) => {
      if (path.endsWith('state-history.jsonl')) return Promise.reject(enoentError)
      if (path.endsWith('session-summary.json')) return Promise.resolve(JSON.stringify({ session_title: 'Fallback' }))
      if (path.endsWith('session-persona.json'))
        return Promise.resolve(JSON.stringify({ persona_id: 'fallback-persona' }))
      return Promise.reject(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
    })

    mockReaddir.mockResolvedValue(['session-summary.json', 'session-persona.json'])

    const fakeDate = new Date('2025-01-01T12:00:00.000Z')
    mockStat.mockResolvedValue({ mtime: fakeDate })

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].timestamp).toBe(fakeDate.getTime())
    expect(snapshots[0].sessionSummary).toEqual({ session_title: 'Fallback' })
    expect(snapshots[0].sessionPersona).toEqual({ persona_id: 'fallback-persona' })
  })

  it('returns empty array when journal is absent and no known state files exist', async () => {
    const enoentError = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    mockReadFile.mockRejectedValue(enoentError)
    mockReaddir.mockRejectedValue(enoentError)

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toEqual([])
  })

  it('returns empty array when state dir exists but has only unknown files', async () => {
    const enoentError = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    mockReadFile.mockImplementation((path: string) => {
      if (path.endsWith('state-history.jsonl')) return Promise.reject(enoentError)
      return Promise.reject(enoentError)
    })

    mockReaddir.mockResolvedValue(['reminder-throttle.json', 'llm-metrics.json'])
    mockStat.mockResolvedValue({ mtime: new Date() })

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toEqual([])
  })

  it('uses highest mtime among state files as snapshot timestamp', async () => {
    const enoentError = Object.assign(new Error('ENOENT: no such file'), { code: 'ENOENT' })
    mockReadFile.mockImplementation((path: string) => {
      if (path.endsWith('state-history.jsonl')) return Promise.reject(enoentError)
      if (path.endsWith('session-summary.json')) return Promise.resolve(JSON.stringify({ session_title: 'T' }))
      if (path.endsWith('session-persona.json')) return Promise.resolve(JSON.stringify({ persona_id: 'p' }))
      return Promise.reject(enoentError)
    })

    mockReaddir.mockResolvedValue(['session-summary.json', 'session-persona.json'])

    const olderDate = new Date('2025-01-01T10:00:00.000Z')
    const newerDate = new Date('2025-01-01T12:00:00.000Z')

    mockStat.mockImplementation((path: string) => {
      if (path.endsWith('session-summary.json')) return Promise.resolve({ mtime: olderDate })
      if (path.endsWith('session-persona.json')) return Promise.resolve({ mtime: newerDate })
      return Promise.resolve({ mtime: olderDate })
    })

    const snapshots = await parseStateSnapshots('/fake/project', 'sess-1')

    expect(snapshots).toHaveLength(1)
    expect(snapshots[0].timestamp).toBe(newerDate.getTime())
  })
})
