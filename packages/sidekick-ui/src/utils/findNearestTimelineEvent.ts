import type { SidekickEvent } from '../types'

/**
 * Find the timeline event with the closest timestamp to the target.
 * Events must be sorted by timestamp (ascending).
 * Returns null if events array is empty.
 */
export function findNearestTimelineEvent(
  events: readonly SidekickEvent[],
  targetTimestamp: number
): SidekickEvent | null {
  if (events.length === 0) return null
  if (events.length === 1) return events[0]
  if (targetTimestamp <= events[0].timestamp) return events[0]
  if (targetTimestamp >= events[events.length - 1].timestamp) return events[events.length - 1]

  let lo = 0
  let hi = events.length - 1

  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].timestamp < targetTimestamp) lo = mid + 1
    else hi = mid
  }

  // Compare lo and lo-1 to find truly nearest
  if (lo > 0) {
    const diffLo = Math.abs(events[lo].timestamp - targetTimestamp)
    const diffPrev = Math.abs(events[lo - 1].timestamp - targetTimestamp)
    if (diffPrev <= diffLo) return events[lo - 1]
  }

  return events[lo]
}
