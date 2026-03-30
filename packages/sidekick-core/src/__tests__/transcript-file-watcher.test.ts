/**
 * Tests for transcript-file-watcher module.
 *
 * Validates streaming state management, circular buffer operations,
 * processing queue, and transcript file processing.
 */

import { describe, it, expect, vi } from 'vitest'
import {
  createStreamingState,
  resetStreamingState,
  addToExcerptBuffer,
  enqueueProcessing,
} from '../transcript-file-watcher'
import { createDefaultMetrics, EXCERPT_BUFFER_SIZE } from '../transcript-helpers'

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
