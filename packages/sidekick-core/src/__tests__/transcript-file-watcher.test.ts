/**
 * Tests for transcript-file-watcher module.
 *
 * Validates streaming state management, circular buffer operations,
 * processing queue, and transcript file processing.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import {
  createStreamingState,
  resetStreamingState,
  addToExcerptBuffer,
  enqueueProcessing,
  processTranscriptFile,
} from '../transcript-file-watcher'
import { createDefaultMetrics, EXCERPT_BUFFER_SIZE } from '../transcript-helpers'
import { createFakeLogger } from '@sidekick/testing-fixtures'
import type { TranscriptEntry, TranscriptMetrics } from '@sidekick/types'
import type { StreamingState } from '../transcript-file-watcher'

// ============================================================================
// createStreamingState
// ============================================================================

describe('createStreamingState', () => {
  it('creates state with all defaults', () => {
    const state = createStreamingState()

    expect(state.lastProcessedByteOffset).toBe(0)
    expect(state.excerptBuffer).toEqual([])
    expect(state.excerptBufferHead).toBe(0)
    expect(state.excerptBufferCount).toBe(0)
    expect(state.knownUuids.size).toBe(0)
  })
})

// ============================================================================
// resetStreamingState
// ============================================================================

describe('resetStreamingState', () => {
  it('resets all state fields', () => {
    const state = createStreamingState()
    const metrics = createDefaultMetrics()

    // Populate state
    state.lastProcessedByteOffset = 5000
    state.excerptBuffer = [{ lineNumber: 1, rawLine: '{}', uuid: null }]
    state.excerptBufferHead = 1
    state.excerptBufferCount = 1
    state.knownUuids.add('uuid-1')
    metrics.lastProcessedLine = 50

    resetStreamingState(state, metrics)

    expect(state.lastProcessedByteOffset).toBe(0)
    expect(state.excerptBuffer).toEqual([])
    expect(state.excerptBufferHead).toBe(0)
    expect(state.excerptBufferCount).toBe(0)
    expect(state.knownUuids.size).toBe(0)
    expect(metrics.lastProcessedLine).toBe(0)
  })
})

// ============================================================================
// addToExcerptBuffer
// ============================================================================

describe('addToExcerptBuffer', () => {
  it('appends to buffer when not full', () => {
    const state = createStreamingState()

    addToExcerptBuffer(state, 1, JSON.stringify({ type: 'user' }))

    expect(state.excerptBufferCount).toBe(1)
    expect(state.excerptBuffer[0].lineNumber).toBe(1)
  })

  it('tracks UUIDs', () => {
    const state = createStreamingState()

    addToExcerptBuffer(state, 1, JSON.stringify({ uuid: 'test-uuid-1', type: 'user' }))

    expect(state.knownUuids.has('test-uuid-1')).toBe(true)
  })

  it('overwrites oldest entry when buffer is full', () => {
    const state = createStreamingState()

    // Fill buffer to capacity
    for (let i = 0; i < EXCERPT_BUFFER_SIZE; i++) {
      addToExcerptBuffer(state, i + 1, JSON.stringify({ type: 'user', n: i }))
    }

    expect(state.excerptBufferCount).toBe(EXCERPT_BUFFER_SIZE)
    expect(state.excerptBufferHead).toBe(0)

    // Add one more - should overwrite oldest
    addToExcerptBuffer(state, EXCERPT_BUFFER_SIZE + 1, JSON.stringify({ type: 'user', n: 'new' }))

    expect(state.excerptBufferCount).toBe(EXCERPT_BUFFER_SIZE)
    expect(state.excerptBufferHead).toBe(1) // Head advanced
    // The entry at index 0 should be the new one
    expect(state.excerptBuffer[0].lineNumber).toBe(EXCERPT_BUFFER_SIZE + 1)
  })

  it('handles entries without UUID', () => {
    const state = createStreamingState()

    addToExcerptBuffer(state, 1, JSON.stringify({ type: 'user' }))

    expect(state.excerptBuffer[0].uuid).toBeNull()
    expect(state.knownUuids.size).toBe(0)
  })
})

// ============================================================================
// enqueueProcessing
// ============================================================================

describe('enqueueProcessing', () => {
  it('serializes sequential processing calls', async () => {
    const order: number[] = []

    const result1 = enqueueProcessing(Promise.resolve(), () => {
      order.push(1)
      return Promise.resolve()
    })

    const result2 = enqueueProcessing(result1.chain, () => {
      order.push(2)
      return Promise.resolve()
    })

    await result1.promise
    await result2.promise

    expect(order).toEqual([1, 2])
  })

  it('continues after a failed processing call', async () => {
    const result1 = enqueueProcessing(Promise.resolve(), () => {
      return Promise.reject(new Error('first call failed'))
    })

    const result2 = enqueueProcessing(result1.chain, () => {
      // This should still run
      return Promise.resolve()
    })

    // First call rejects
    await expect(result1.promise).rejects.toThrow('first call failed')

    // Second call succeeds
    await expect(result2.promise).resolves.toBeUndefined()
  })
})

// ============================================================================
// processTranscriptFile
// ============================================================================

describe('processTranscriptFile', () => {
  let tmpDir: string
  let transcriptPath: string
  let state: StreamingState
  let metrics: TranscriptMetrics
  let logger: ReturnType<typeof createFakeLogger>
  // Cast to any for vitest 4.x Mock<Constructable | Procedure> compatibility
  let processEntryFn: ReturnType<typeof vi.fn>
  let emitBulkComplete: ReturnType<typeof vi.fn>

  function createBulkState(
    overrides: Partial<{
      hasBacklogAtPrepareTime: boolean
      isBulkProcessing: boolean
      hasFiredBulkComplete: boolean
      bulkStartTime: number
    }> = {}
  ) {
    return {
      hasBacklogAtPrepareTime: overrides.hasBacklogAtPrepareTime ?? false,
      isBulkProcessing: overrides.isBulkProcessing ?? false,
      hasFiredBulkComplete: overrides.hasFiredBulkComplete ?? false,
      bulkStartTime: overrides.bulkStartTime ?? 0,
      setIsBulkProcessing: vi.fn((v: boolean) => {
        bulkStateObj.isBulkProcessing = v
      }),
      setHasFiredBulkComplete: vi.fn((v: boolean) => {
        bulkStateObj.hasFiredBulkComplete = v
      }),
      setBulkStartTime: vi.fn((v: number) => {
        bulkStateObj.bulkStartTime = v
      }),
    }
  }

  // This reference lets the setter closures mutate the live object
  let bulkStateObj: ReturnType<typeof createBulkState>

  /** Build a valid transcript JSON line */
  function makeLine(entry: Partial<TranscriptEntry> & { type: string }): string {
    return JSON.stringify({
      uuid: `uuid-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      message: { role: entry.type === 'user' ? 'user' : 'assistant', content: 'hello' },
      ...entry,
    })
  }

  /** Helper to call processTranscriptFile with test fixtures */
  async function callProcess(path?: string, sessionId?: string | null) {
    await processTranscriptFile(
      path ?? transcriptPath,
      state,
      metrics,
      processEntryFn as any,
      emitBulkComplete as any,
      logger,
      sessionId ?? 'test-session',
      bulkStateObj
    )
  }

  beforeEach(() => {
    tmpDir = join(tmpdir(), `sidekick-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`)
    mkdirSync(tmpDir, { recursive: true })
    transcriptPath = join(tmpDir, 'transcript.jsonl')
    state = createStreamingState()
    metrics = createDefaultMetrics()
    logger = createFakeLogger()
    processEntryFn = vi.fn()
    emitBulkComplete = vi.fn()
    bulkStateObj = createBulkState()
  })

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true })
  })

  it('reads all lines from byte offset 0', async () => {
    const line1 = makeLine({ type: 'user' })
    const line2 = makeLine({ type: 'assistant' })
    writeFileSync(transcriptPath, `${line1}\n${line2}\n`)

    await callProcess()

    // Both entries processed
    expect(processEntryFn).toHaveBeenCalledTimes(2)
    // Byte offset advanced past entire file content
    expect(state.lastProcessedByteOffset).toBeGreaterThan(0)
    // Line count updated
    expect(metrics.lastProcessedLine).toBe(2)
    // Excerpt buffer populated
    expect(state.excerptBufferCount).toBe(2)
  })

  it('reads incrementally from last byte offset', async () => {
    const line1 = makeLine({ type: 'user' })
    const line2 = makeLine({ type: 'assistant' })
    writeFileSync(transcriptPath, `${line1}\n${line2}\n`)

    // First pass: process everything
    await callProcess()
    expect(processEntryFn).toHaveBeenCalledTimes(2)

    // Append a new line
    const line3 = makeLine({ type: 'user' })
    const existingContent = `${line1}\n${line2}\n`
    writeFileSync(transcriptPath, `${existingContent}${line3}\n`)

    processEntryFn.mockClear()

    // Second pass: should only process the new line
    await callProcess()

    expect(processEntryFn).toHaveBeenCalledTimes(1)
    expect(metrics.lastProcessedLine).toBe(3)
    expect(state.excerptBufferCount).toBe(3)
  })

  it('detects truncation and resets state', async () => {
    const line1 = makeLine({ type: 'user' })
    const line2 = makeLine({ type: 'assistant' })
    writeFileSync(transcriptPath, `${line1}\n${line2}\n`)

    // First pass
    await callProcess()
    const originalOffset = state.lastProcessedByteOffset
    expect(originalOffset).toBeGreaterThan(0)

    // Truncate the file to something smaller than the offset
    const shortLine = makeLine({ type: 'user' })
    writeFileSync(transcriptPath, `${shortLine}\n`)

    processEntryFn.mockClear()

    // Second pass: truncation should trigger reset then re-read
    await callProcess()

    // Logger should have warned about truncation
    expect(logger.warn).toHaveBeenCalledWith(
      'Transcript file appears truncated, resetting state',
      expect.objectContaining({
        sessionId: 'test-session',
      })
    )
    // Should have re-read from the beginning
    expect(processEntryFn).toHaveBeenCalledTimes(1)
    expect(metrics.lastProcessedLine).toBe(1)
  })

  it('returns without processing for empty file', async () => {
    writeFileSync(transcriptPath, '')

    await callProcess()

    expect(processEntryFn).not.toHaveBeenCalled()
    expect(state.lastProcessedByteOffset).toBe(0)
    expect(metrics.lastProcessedLine).toBe(0)
  })

  it('returns without processing for nonexistent file', async () => {
    await callProcess(join(tmpDir, 'nonexistent.jsonl'))

    expect(processEntryFn).not.toHaveBeenCalled()
    expect(state.lastProcessedByteOffset).toBe(0)
  })

  it('skips malformed JSON lines gracefully', async () => {
    const validLine = makeLine({ type: 'user' })
    const malformed = 'this is not json {'
    const validLine2 = makeLine({ type: 'assistant' })
    writeFileSync(transcriptPath, `${validLine}\n${malformed}\n${validLine2}\n`)

    await callProcess()

    // Only the 2 valid lines should have been processed
    expect(processEntryFn).toHaveBeenCalledTimes(2)
    // All 3 non-empty lines counted
    expect(metrics.lastProcessedLine).toBe(3)
    // The malformed line was logged as a warning
    expect(logger.warn).toHaveBeenCalledWith('Skipping malformed transcript line', expect.objectContaining({ line: 2 }))
  })

  it('passes all schema-valid JSON objects to processEntryFn (schema is permissive)', async () => {
    const validLine = makeLine({ type: 'user' })
    // TranscriptEntrySchema is z.object({}).passthrough(), so any object passes
    const minimalLine = JSON.stringify({ foo: 'bar' })
    writeFileSync(transcriptPath, `${validLine}\n${minimalLine}\n`)

    await callProcess()

    // Both lines are valid per the permissive schema
    expect(processEntryFn).toHaveBeenCalledTimes(2)
    expect(metrics.lastProcessedLine).toBe(2)
  })

  it('activates bulk processing when hasBacklogAtPrepareTime is true and starting from offset 0', async () => {
    const line1 = makeLine({ type: 'user' })
    const line2 = makeLine({ type: 'assistant' })
    writeFileSync(transcriptPath, `${line1}\n${line2}\n`)

    bulkStateObj = createBulkState({ hasBacklogAtPrepareTime: true })

    await callProcess()

    // Bulk processing was activated then deactivated
    expect(bulkStateObj.setIsBulkProcessing).toHaveBeenCalledWith(true)
    expect(bulkStateObj.setIsBulkProcessing).toHaveBeenCalledWith(false)
    expect(bulkStateObj.setHasFiredBulkComplete).toHaveBeenCalledWith(true)
    expect(bulkStateObj.setBulkStartTime).toHaveBeenCalled()
    // emitBulkComplete should have been called with total line count
    expect(emitBulkComplete).toHaveBeenCalledWith(2, expect.any(Number))
  })

  it('does not activate bulk processing when starting from non-zero offset', async () => {
    const line1 = makeLine({ type: 'user' })
    writeFileSync(transcriptPath, `${line1}\n`)

    // Simulate a prior read (non-zero offset)
    bulkStateObj = createBulkState({ hasBacklogAtPrepareTime: true })
    state.lastProcessedByteOffset = 0
    metrics.lastProcessedLine = 0

    // First call processes normally with bulk
    await callProcess()

    // Now append and call again — offset is non-zero, so no bulk even if flag still set
    const line2 = makeLine({ type: 'assistant' })
    const existingContent = `${line1}\n`
    writeFileSync(transcriptPath, `${existingContent}${line2}\n`)
    processEntryFn.mockClear()
    emitBulkComplete.mockClear()

    await callProcess()

    // Second call should NOT trigger bulk complete again
    expect(emitBulkComplete).not.toHaveBeenCalled()
  })

  it('updates lastUpdatedAt timestamp', async () => {
    const line1 = makeLine({ type: 'user' })
    writeFileSync(transcriptPath, `${line1}\n`)

    expect(metrics.lastUpdatedAt).toBe(0)

    await callProcess()

    expect(metrics.lastUpdatedAt).toBeGreaterThan(0)
  })

  it('skips empty lines without counting them', async () => {
    const line1 = makeLine({ type: 'user' })
    const line2 = makeLine({ type: 'assistant' })
    // File with empty lines interspersed
    writeFileSync(transcriptPath, `${line1}\n\n\n${line2}\n\n`)

    await callProcess()

    // Only 2 non-empty lines processed
    expect(processEntryFn).toHaveBeenCalledTimes(2)
    expect(metrics.lastProcessedLine).toBe(2)
  })

  it('populates knownUuids from processed lines', async () => {
    const uuid1 = 'test-uuid-aaa'
    const uuid2 = 'test-uuid-bbb'
    const line1 = JSON.stringify({
      uuid: uuid1,
      type: 'user',
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: 'hello' },
    })
    const line2 = JSON.stringify({
      uuid: uuid2,
      type: 'assistant',
      timestamp: new Date().toISOString(),
      message: { role: 'assistant', content: 'hi' },
    })
    writeFileSync(transcriptPath, `${line1}\n${line2}\n`)

    await callProcess()

    expect(state.knownUuids.has(uuid1)).toBe(true)
    expect(state.knownUuids.has(uuid2)).toBe(true)
  })
})
