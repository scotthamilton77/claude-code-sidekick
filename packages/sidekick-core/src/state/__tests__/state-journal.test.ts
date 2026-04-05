/**
 * Tests for StateJournal — append-only JSONL session state journal.
 *
 * Uses vi.mock() factory pattern for node:fs/promises.
 * Import of the module under test is AFTER vi.mock() declarations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'

// Declare mock fns at top level — required so vi.mock factory can close over them
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

  // Default: mkdir resolves, readFile throws ENOENT (no existing journal)
  mockMkdir.mockResolvedValue(undefined)
  mockAppendFile.mockResolvedValue(undefined)
  mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))
})

// Import AFTER mocks
import { StateJournal } from '../state-journal.js'

// ============================================================================
// Helpers
// ============================================================================

function makeJournal(projectRoot = '/fake/project'): StateJournal {
  return new StateJournal(projectRoot)
}

function captureWrittenEntry(callIndex = 0): Record<string, unknown> {
  const raw: string = mockAppendFile.mock.calls[callIndex][1]
  // Strip trailing newline before parsing
  return JSON.parse(raw.trimEnd())
}

// ============================================================================
// append()
// ============================================================================

describe('StateJournal.appendIfChanged()', () => {
  it('appends entry for allowlisted file with new data', async () => {
    const journal = makeJournal()
    const data = { summary: 'hello world' }

    await journal.appendIfChanged('sess-1', 'session-summary', data)

    expect(mockAppendFile).toHaveBeenCalledOnce()

    const [filePath, content] = mockAppendFile.mock.calls[0]
    expect(filePath).toBe('/fake/project/.sidekick/sessions/sess-1/state-history.jsonl')
    expect(content).toMatch(/\n$/)

    const entry = captureWrittenEntry()
    expect(entry.file).toBe('session-summary')
    expect(entry.data).toEqual(data)
    expect(typeof entry.ts).toBe('number')
  })

  it('skips write when data is identical to previous', async () => {
    const journal = makeJournal()
    const data = { summary: 'same data' }

    await journal.appendIfChanged('sess-1', 'session-summary', data)
    expect(mockAppendFile).toHaveBeenCalledOnce()

    mockAppendFile.mockClear()

    await journal.appendIfChanged('sess-1', 'session-summary', data)
    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it('writes when data changes after previous write', async () => {
    const journal = makeJournal()

    await journal.appendIfChanged('sess-1', 'session-summary', { value: 1 })
    expect(mockAppendFile).toHaveBeenCalledOnce()

    mockAppendFile.mockClear()

    await journal.appendIfChanged('sess-1', 'session-summary', { value: 2 })
    expect(mockAppendFile).toHaveBeenCalledOnce()

    const entry = captureWrittenEntry()
    expect(entry.data).toEqual({ value: 2 })
  })

  it('silently skips files not in the allowlist', async () => {
    const journal = makeJournal()

    await journal.appendIfChanged('sess-1', 'not-an-allowed-file', { foo: 'bar' })

    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it('tracks different files independently', async () => {
    const journal = makeJournal()
    const summaryData = { summary: 'hello' }
    const personaData = { personaId: 'terse' }

    await journal.appendIfChanged('sess-1', 'session-summary', summaryData)
    await journal.appendIfChanged('sess-1', 'session-persona', personaData)

    expect(mockAppendFile).toHaveBeenCalledTimes(2)

    // Both identical re-writes should be skipped
    mockAppendFile.mockClear()
    await journal.appendIfChanged('sess-1', 'session-summary', summaryData)
    await journal.appendIfChanged('sess-1', 'session-persona', personaData)
    expect(mockAppendFile).not.toHaveBeenCalled()
  })
})

// ============================================================================
// appendDeletion()
// ============================================================================

describe('StateJournal.appendDeletion()', () => {
  it('writes entry with null data', async () => {
    const journal = makeJournal()
    // Prime with an initial write so dedup cache is populated
    await journal.appendIfChanged('sess-1', 'session-summary', { x: 1 })
    mockAppendFile.mockClear()

    await journal.appendDeletion('sess-1', 'session-summary')

    expect(mockAppendFile).toHaveBeenCalledOnce()
    const entry = captureWrittenEntry()
    expect(entry.file).toBe('session-summary')
    expect(entry.data).toBeNull()
  })

  it('clears dedup cache so the next write is not skipped', async () => {
    const journal = makeJournal()
    const data = { x: 1 }

    await journal.appendIfChanged('sess-1', 'session-summary', data)
    await journal.appendDeletion('sess-1', 'session-summary')

    mockAppendFile.mockClear()

    // Same data as original write — should go through because deletion cleared cache
    await journal.appendIfChanged('sess-1', 'session-summary', data)
    expect(mockAppendFile).toHaveBeenCalledOnce()
  })

  it('skips non-allowlisted files', async () => {
    const journal = makeJournal()

    await journal.appendDeletion('sess-1', 'evil-file')

    expect(mockAppendFile).not.toHaveBeenCalled()
  })
})

// ============================================================================
// Dedup priming from existing journal
// ============================================================================

describe('StateJournal dedup priming', () => {
  it('primes dedup map from existing journal and skips identical re-write', async () => {
    const existingEntry = JSON.stringify({
      ts: 1000,
      file: 'session-summary',
      data: { summary: 'existing' },
    })
    mockReadFile.mockResolvedValue(existingEntry + '\n')

    const journal = makeJournal()

    // Same data as on disk — should be skipped
    await journal.appendIfChanged('sess-1', 'session-summary', { summary: 'existing' })

    expect(mockAppendFile).not.toHaveBeenCalled()
  })

  it('writes when new data differs from primed value', async () => {
    const existingEntry = JSON.stringify({
      ts: 1000,
      file: 'session-summary',
      data: { summary: 'old' },
    })
    mockReadFile.mockResolvedValue(existingEntry + '\n')

    const journal = makeJournal()

    await journal.appendIfChanged('sess-1', 'session-summary', { summary: 'new' })

    expect(mockAppendFile).toHaveBeenCalledOnce()
    const entry = captureWrittenEntry()
    expect(entry.data).toEqual({ summary: 'new' })
  })

  it('primes from journal containing a deletion entry — write goes through', async () => {
    // Journal: write summary, then delete it
    const writeLine = JSON.stringify({
      ts: 1000,
      file: 'session-summary',
      data: { summary: 'old' },
    })
    const deletionLine = JSON.stringify({
      ts: 2000,
      file: 'session-summary',
      data: null,
    })
    mockReadFile.mockResolvedValue(writeLine + '\n' + deletionLine + '\n')

    const journal = makeJournal()

    // The deletion cleared the dedup cache during priming, so even the
    // same data that was written before the deletion should go through.
    await journal.appendIfChanged('sess-1', 'session-summary', { summary: 'old' })

    expect(mockAppendFile).toHaveBeenCalledOnce()
    const entry = captureWrittenEntry()
    expect(entry.data).toEqual({ summary: 'old' })
  })

  it('handles corrupt journal gracefully and starts fresh', async () => {
    // Return garbage that cannot be parsed as JSONL
    mockReadFile.mockResolvedValue('not valid json\n{also broken\n')

    const journal = makeJournal()

    // Should not throw, and should write successfully
    await journal.appendIfChanged('sess-1', 'session-summary', { summary: 'fresh' })

    expect(mockAppendFile).toHaveBeenCalledOnce()
    const entry = captureWrittenEntry()
    expect(entry.data).toEqual({ summary: 'fresh' })
  })
})
