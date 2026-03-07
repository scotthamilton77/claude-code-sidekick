/**
 * Trace Correlator
 *
 * Provides traceId-based event grouping and correlation for analyzing causal chains
 * in the Sidekick event stream. TraceIds link related events across the hook lifecycle,
 * enabling visualization of flows from hook trigger → handler execution → side effects.
 *
 * @see docs/design/STRUCTURED-LOGGING.md §4 Trace Correlation
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §2.3 Flow Visualization
 */

import type { UIEvent, TraceGroup } from '../types'

/**
 * Groups events by their traceId field.
 *
 * Creates TraceGroup objects containing all events that share the same traceId,
 * with metadata calculated from the grouped events:
 * - startTime/endTime: derived from event timestamps
 * - hookName: extracted from the first hook event in the group
 *
 * Events without a traceId are skipped.
 *
 * @param events - Array of UI events to group
 * @returns Map of traceId → TraceGroup with calculated metadata
 *
 * @example
 * const events = [
 *   { id: 1, time: '10:00:01', traceId: 'trace-1', type: 'session', ... },
 *   { id: 2, time: '10:00:02', traceId: 'trace-1', type: 'decision', ... },
 *   { id: 3, time: '10:00:03', traceId: 'trace-2', type: 'user', ... },
 * ]
 * const groups = groupByTraceId(events)
 * // Map(2) {
 * //   'trace-1' => { traceId: 'trace-1', events: [...], startTime: ..., ... },
 * //   'trace-2' => { traceId: 'trace-2', events: [...], startTime: ..., ... }
 * // }
 */
export function groupByTraceId(events: UIEvent[]): Map<string, TraceGroup> {
  const groups = new Map<string, TraceGroup>()

  for (const event of events) {
    // Skip events without traceId
    if (!event.traceId) {
      continue
    }

    const existing = groups.get(event.traceId)
    if (existing) {
      existing.events.push(event)
    } else {
      groups.set(event.traceId, {
        traceId: event.traceId,
        events: [event],
        startTime: 0, // Will be calculated after all events are collected
        endTime: 0,
        hookName: undefined,
      })
    }
  }

  // Calculate metadata for each group
  for (const group of groups.values()) {
    // Sort events by ID (chronological order)
    group.events.sort((a, b) => a.id - b.id)

    // Set start/end times from first and last events
    group.startTime = parseTimeToSeconds(group.events[0].time)
    group.endTime = parseTimeToSeconds(group.events[group.events.length - 1].time)

    // Extract hook name from first hook event
    const firstHookEvent = group.events.find((e) => e.rawEvent?.kind === 'hook')
    if (firstHookEvent?.rawEvent?.kind === 'hook') {
      group.hookName = firstHookEvent.rawEvent.hook
    }
  }

  return groups
}

/**
 * Builds a causal chain of events for a given traceId.
 *
 * Returns all events that share the specified traceId, ordered chronologically.
 * This represents the complete causal chain from initial trigger to final side effects.
 *
 * @param events - Array of UI events to search
 * @param traceId - The trace ID to filter by
 * @returns Array of events with matching traceId, ordered by time (empty if no matches)
 *
 * @example
 * const chain = buildCausalChain(events, 'trace-abc123')
 * // [
 * //   { id: 5, time: '10:00:01', type: 'session', traceId: 'trace-abc123', ... },
 * //   { id: 7, time: '10:00:02', type: 'decision', traceId: 'trace-abc123', ... },
 * //   { id: 9, time: '10:00:03', type: 'reminder', traceId: 'trace-abc123', ... },
 * // ]
 */
export function buildCausalChain(events: UIEvent[], traceId: string): UIEvent[] {
  const matchingEvents = events.filter((e) => e.traceId === traceId)

  // Sort by ID (chronological order, assuming IDs are sequential)
  // Fall back to time parsing if needed
  return matchingEvents.sort((a, b) => {
    if (a.id !== b.id) {
      return a.id - b.id
    }
    // If IDs are equal (unlikely), sort by time
    return parseTimeToSeconds(a.time) - parseTimeToSeconds(b.time)
  })
}

/**
 * Finds all events related to a given event ID through shared traceId.
 *
 * Locates the event with the specified ID and returns all events that share
 * its traceId (including the event itself). If the event has no traceId,
 * returns only that single event.
 *
 * This is useful for expanding a selected event to show its full context.
 *
 * @param events - Array of UI events to search
 * @param eventId - The ID of the event to find related events for
 * @returns Array of related events (or single event if no traceId)
 *
 * @example
 * // Event 42 has traceId 'trace-xyz'
 * const related = getRelatedEvents(events, 42)
 * // Returns all events with traceId 'trace-xyz', including event 42
 *
 * // Event 99 has no traceId
 * const related = getRelatedEvents(events, 99)
 * // Returns [event 99]
 */
export function getRelatedEvents(events: UIEvent[], eventId: number): UIEvent[] {
  const targetEvent = events.find((e) => e.id === eventId)

  if (!targetEvent) {
    return []
  }

  if (!targetEvent.traceId) {
    return [targetEvent]
  }

  // Return all events with the same traceId
  return buildCausalChain(events, targetEvent.traceId)
}

/**
 * Parses a time string in HH:MM:SS format to seconds since midnight.
 *
 * Used for calculating event durations and ordering events within a trace group.
 *
 * @param timeStr - Time string in HH:MM:SS format
 * @returns Seconds since midnight (0 if parsing fails)
 *
 * @internal
 */
function parseTimeToSeconds(timeStr: string): number {
  const parts = timeStr.split(':')
  if (parts.length !== 3) {
    return 0
  }

  const hours = parseInt(parts[0], 10)
  const minutes = parseInt(parts[1], 10)
  const seconds = parseInt(parts[2], 10)

  if (isNaN(hours) || isNaN(minutes) || isNaN(seconds)) {
    return 0
  }

  return hours * 3600 + minutes * 60 + seconds
}
