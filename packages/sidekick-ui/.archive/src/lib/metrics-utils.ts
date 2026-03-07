/**
 * Metrics Utilities
 *
 * Pure utility functions for formatting and calculating metric values.
 * Used by MetricsPanel, Sparkline, Timeline, and CompactionMarker components.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md
 */

/**
 * Format large numbers with K/M suffix for display.
 */
export function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`
  }
  return n.toString()
}

/**
 * Format ratio to one decimal place.
 */
export function formatRatio(n: number): string {
  return n.toFixed(1)
}

/**
 * Format timestamp for display (HH:MM:SS).
 */
export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

export interface Point {
  x: number
  y: number
}

/**
 * Calculate sparkline points from data.
 * Maps data values to x,y coordinates within the given dimensions.
 */
export function calculateSparklinePoints(data: number[], width: number, height: number, padding: number): Point[] {
  if (data.length === 0) return []

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1 // Avoid division by zero

  const xStep = data.length > 1 ? (width - 2 * padding) / (data.length - 1) : 0

  return data.map((value, index) => ({
    x: padding + index * xStep,
    y: height - padding - ((value - min) / range) * (height - 2 * padding),
  }))
}

/**
 * Generic event type for findEventIndexAtTimestamp.
 */
export interface TimestampedEvent {
  time: string
}

/**
 * Find the event index closest to a given timestamp using binary search.
 * Returns the index of the first event >= timestamp.
 */
export function findEventIndexAtTimestamp<T extends TimestampedEvent>(events: T[], timestamp: number): number {
  if (events.length === 0) return 0

  let low = 0
  let high = events.length - 1

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const eventTime = new Date(events[mid].time).getTime()

    if (eventTime < timestamp) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

/**
 * Calculate percentage position for timeline elements.
 * Handles edge cases like 0 or 1 events to avoid division by zero.
 */
export function calculateTimelinePercentage(eventIndex: number, totalEvents: number): number {
  if (totalEvents <= 1) return 0
  return (eventIndex / (totalEvents - 1)) * 100
}

/**
 * Calculate slider max value safely.
 */
export function calculateSliderMax(eventsLength: number): number {
  return Math.max(0, eventsLength - 1)
}

/**
 * Format progress text (e.g., "5 / 10").
 */
export function formatProgressText(currentIndex: number, totalEvents: number): string {
  return `${currentIndex + 1} / ${totalEvents}`
}
