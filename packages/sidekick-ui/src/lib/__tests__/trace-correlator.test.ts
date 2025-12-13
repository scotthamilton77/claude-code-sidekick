/**
 * Trace Correlator Tests
 *
 * Tests for traceId-based event grouping and causal chain building.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §4 Trace Correlation
 */

import { describe, it, expect } from 'vitest'
import { groupByTraceId, buildCausalChain, getRelatedEvents } from '../trace-correlator'
import type { UIEvent } from '../../types'

// ============================================================================
// Test Fixtures
// ============================================================================

/** Create a minimal UIEvent for testing */
function createUIEvent(overrides: Partial<UIEvent>): UIEvent {
  return {
    id: 0,
    time: '10:00:00',
    type: 'state',
    label: 'Test Event',
    ...overrides,
  }
}

// ============================================================================
// groupByTraceId Tests
// ============================================================================

describe('groupByTraceId', () => {
  it('groups events by their traceId', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, time: '10:00:01', traceId: 'trace-1' }),
      createUIEvent({ id: 2, time: '10:00:02', traceId: 'trace-1' }),
      createUIEvent({ id: 3, time: '10:00:03', traceId: 'trace-2' }),
    ]

    const groups = groupByTraceId(events)

    expect(groups.size).toBe(2)
    expect(groups.get('trace-1')?.events).toHaveLength(2)
    expect(groups.get('trace-2')?.events).toHaveLength(1)
  })

  it('skips events without traceId', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, traceId: 'trace-1' }),
      createUIEvent({ id: 2, traceId: undefined }),
      createUIEvent({ id: 3, traceId: 'trace-1' }),
    ]

    const groups = groupByTraceId(events)

    expect(groups.size).toBe(1)
    expect(groups.get('trace-1')?.events).toHaveLength(2)
  })

  it('calculates start and end times from events', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, time: '10:00:01', traceId: 'trace-1' }),
      createUIEvent({ id: 2, time: '10:00:05', traceId: 'trace-1' }),
      createUIEvent({ id: 3, time: '10:00:10', traceId: 'trace-1' }),
    ]

    const groups = groupByTraceId(events)
    const group = groups.get('trace-1')!

    expect(group.startTime).toBe(10 * 3600 + 0 * 60 + 1) // 10:00:01
    expect(group.endTime).toBe(10 * 3600 + 0 * 60 + 10) // 10:00:10
  })

  it('sorts events by ID within each group', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 3, time: '10:00:03', traceId: 'trace-1' }),
      createUIEvent({ id: 1, time: '10:00:01', traceId: 'trace-1' }),
      createUIEvent({ id: 2, time: '10:00:02', traceId: 'trace-1' }),
    ]

    const groups = groupByTraceId(events)
    const group = groups.get('trace-1')!

    expect(group.events[0].id).toBe(1)
    expect(group.events[1].id).toBe(2)
    expect(group.events[2].id).toBe(3)
  })

  it('extracts hookName from first hook event', () => {
    const events: UIEvent[] = [
      createUIEvent({
        id: 1,
        traceId: 'trace-1',
        rawEvent: { kind: 'hook', hook: 'UserPromptSubmit' } as UIEvent['rawEvent'],
      }),
      createUIEvent({ id: 2, traceId: 'trace-1' }),
    ]

    const groups = groupByTraceId(events)
    const group = groups.get('trace-1')!

    expect(group.hookName).toBe('UserPromptSubmit')
  })

  it('handles empty events array', () => {
    const groups = groupByTraceId([])

    expect(groups.size).toBe(0)
  })

  it('handles invalid time strings gracefully', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, time: 'invalid', traceId: 'trace-1' }),
      createUIEvent({ id: 2, time: '', traceId: 'trace-1' }),
    ]

    const groups = groupByTraceId(events)
    const group = groups.get('trace-1')!

    // Should fall back to 0 for invalid times
    expect(group.startTime).toBe(0)
    expect(group.endTime).toBe(0)
  })
})

// ============================================================================
// buildCausalChain Tests
// ============================================================================

describe('buildCausalChain', () => {
  it('returns all events with matching traceId', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, traceId: 'trace-1' }),
      createUIEvent({ id: 2, traceId: 'trace-2' }),
      createUIEvent({ id: 3, traceId: 'trace-1' }),
      createUIEvent({ id: 4, traceId: 'trace-1' }),
    ]

    const chain = buildCausalChain(events, 'trace-1')

    expect(chain).toHaveLength(3)
    expect(chain.map((e) => e.id)).toEqual([1, 3, 4])
  })

  it('sorts events by ID (chronological order)', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 5, traceId: 'trace-1' }),
      createUIEvent({ id: 2, traceId: 'trace-1' }),
      createUIEvent({ id: 8, traceId: 'trace-1' }),
    ]

    const chain = buildCausalChain(events, 'trace-1')

    expect(chain.map((e) => e.id)).toEqual([2, 5, 8])
  })

  it('returns empty array for non-existent traceId', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, traceId: 'trace-1' }),
      createUIEvent({ id: 2, traceId: 'trace-2' }),
    ]

    const chain = buildCausalChain(events, 'non-existent')

    expect(chain).toHaveLength(0)
  })

  it('handles empty events array', () => {
    const chain = buildCausalChain([], 'trace-1')

    expect(chain).toHaveLength(0)
  })

  it('falls back to time comparison when IDs are equal', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, time: '10:00:05', traceId: 'trace-1' }),
      createUIEvent({ id: 1, time: '10:00:01', traceId: 'trace-1' }),
    ]

    const chain = buildCausalChain(events, 'trace-1')

    // Earlier time should come first
    expect(chain[0].time).toBe('10:00:01')
    expect(chain[1].time).toBe('10:00:05')
  })
})

// ============================================================================
// getRelatedEvents Tests
// ============================================================================

describe('getRelatedEvents', () => {
  it('returns all events sharing the same traceId', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, traceId: 'trace-1' }),
      createUIEvent({ id: 2, traceId: 'trace-2' }),
      createUIEvent({ id: 3, traceId: 'trace-1' }),
      createUIEvent({ id: 4, traceId: 'trace-1' }),
    ]

    const related = getRelatedEvents(events, 1)

    expect(related).toHaveLength(3)
    expect(related.map((e) => e.id)).toEqual([1, 3, 4])
  })

  it('returns only the event itself when it has no traceId', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, traceId: undefined }),
      createUIEvent({ id: 2, traceId: 'trace-1' }),
    ]

    const related = getRelatedEvents(events, 1)

    expect(related).toHaveLength(1)
    expect(related[0].id).toBe(1)
  })

  it('returns empty array when event not found', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, traceId: 'trace-1' }),
      createUIEvent({ id: 2, traceId: 'trace-1' }),
    ]

    const related = getRelatedEvents(events, 999)

    expect(related).toHaveLength(0)
  })

  it('handles empty events array', () => {
    const related = getRelatedEvents([], 1)

    expect(related).toHaveLength(0)
  })

  it('includes the target event in related events', () => {
    const events: UIEvent[] = [
      createUIEvent({ id: 1, traceId: 'trace-1' }),
      createUIEvent({ id: 2, traceId: 'trace-1' }),
      createUIEvent({ id: 3, traceId: 'trace-1' }),
    ]

    const related = getRelatedEvents(events, 2)

    // Event 2 should be included
    expect(related.some((e) => e.id === 2)).toBe(true)
    expect(related).toHaveLength(3)
  })
})
