import { describe, it, expect } from 'vitest'
import { findNearestTimelineEvent } from '../findNearestTimelineEvent'
import type { SidekickEvent } from '../../types'

function makeEvent(timestamp: number, id = `evt-${timestamp}`): SidekickEvent {
  return {
    id,
    timestamp,
    type: 'reminder:staged',
    label: `Event at ${timestamp}`,
    transcriptLineId: `sidekick-${timestamp}-reminder:staged`,
  }
}

describe('findNearestTimelineEvent', () => {
  it('returns null for empty events array', () => {
    expect(findNearestTimelineEvent([], 1000)).toBeNull()
  })

  it('returns the only event for single-element array', () => {
    const events = [makeEvent(500)]
    expect(findNearestTimelineEvent(events, 1000)).toBe(events[0])
  })

  it('returns exact match when timestamp matches', () => {
    const events = [makeEvent(100), makeEvent(200), makeEvent(300)]
    expect(findNearestTimelineEvent(events, 200)).toBe(events[1])
  })

  it('returns nearest event when target is between two events (closer to earlier)', () => {
    const events = [makeEvent(100), makeEvent(300)]
    expect(findNearestTimelineEvent(events, 180)).toBe(events[0])
  })

  it('returns nearest event when target is between two events (closer to later)', () => {
    const events = [makeEvent(100), makeEvent(300)]
    expect(findNearestTimelineEvent(events, 250)).toBe(events[1])
  })

  it('returns first event when target is before all events', () => {
    const events = [makeEvent(100), makeEvent(200)]
    expect(findNearestTimelineEvent(events, 50)).toBe(events[0])
  })

  it('returns last event when target is after all events', () => {
    const events = [makeEvent(100), makeEvent(200)]
    expect(findNearestTimelineEvent(events, 999)).toBe(events[1])
  })

  it('handles equidistant timestamps (prefers earlier)', () => {
    const events = [makeEvent(100), makeEvent(200)]
    const result = findNearestTimelineEvent(events, 150)
    expect(result).toBe(events[0])
  })
})
