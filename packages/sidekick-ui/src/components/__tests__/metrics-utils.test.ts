/**
 * Metrics Utilities Tests
 *
 * Tests for helper functions used in MetricsPanel, Sparkline, and CompactionMarker.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §4.2 TranscriptMetrics
 */

import { describe, it, expect } from 'vitest'

// ============================================================================
// formatNumber Tests (from MetricsPanel)
// ============================================================================

/**
 * Format large numbers with K/M suffix for display.
 * Extracted for testing.
 */
function formatNumber(n: number): string {
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
function formatRatio(n: number): string {
  return n.toFixed(1)
}

describe('formatNumber', () => {
  it('formats numbers under 1000 as-is', () => {
    expect(formatNumber(0)).toBe('0')
    expect(formatNumber(1)).toBe('1')
    expect(formatNumber(42)).toBe('42')
    expect(formatNumber(999)).toBe('999')
  })

  it('formats thousands with K suffix', () => {
    expect(formatNumber(1000)).toBe('1.0K')
    expect(formatNumber(1500)).toBe('1.5K')
    expect(formatNumber(12345)).toBe('12.3K')
    expect(formatNumber(999999)).toBe('1000.0K')
  })

  it('formats millions with M suffix', () => {
    expect(formatNumber(1_000_000)).toBe('1.0M')
    expect(formatNumber(1_500_000)).toBe('1.5M')
    expect(formatNumber(12_345_678)).toBe('12.3M')
  })
})

describe('formatRatio', () => {
  it('formats integers with one decimal', () => {
    expect(formatRatio(0)).toBe('0.0')
    expect(formatRatio(1)).toBe('1.0')
    expect(formatRatio(10)).toBe('10.0')
  })

  it('formats decimals with one decimal place', () => {
    expect(formatRatio(1.23)).toBe('1.2')
    expect(formatRatio(1.25)).toBe('1.3') // rounds up
    expect(formatRatio(3.14159)).toBe('3.1')
  })
})

// ============================================================================
// Sparkline Point Calculation Tests
// ============================================================================

interface Point {
  x: number
  y: number
}

/**
 * Calculate sparkline points from data.
 * Extracted from Sparkline component for testing.
 */
function calculateSparklinePoints(data: number[], width: number, height: number, padding: number): Point[] {
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

describe('calculateSparklinePoints', () => {
  const width = 100
  const height = 24
  const padding = 2

  it('returns empty array for empty data', () => {
    expect(calculateSparklinePoints([], width, height, padding)).toEqual([])
  })

  it('handles single data point', () => {
    const points = calculateSparklinePoints([5], width, height, padding)
    expect(points).toHaveLength(1)
    // Single point should be at padding x and middle y
    expect(points[0].x).toBe(padding)
  })

  it('calculates correct x positions for multiple points', () => {
    const data = [1, 2, 3]
    const points = calculateSparklinePoints(data, width, height, padding)

    expect(points).toHaveLength(3)
    expect(points[0].x).toBe(padding) // First point at left padding
    expect(points[2].x).toBe(width - padding) // Last point at right edge minus padding
  })

  it('maps min value to bottom and max value to top', () => {
    const data = [0, 100]
    const points = calculateSparklinePoints(data, width, height, padding)

    // Min (0) should be at bottom (high y value)
    expect(points[0].y).toBe(height - padding)
    // Max (100) should be at top (low y value)
    expect(points[1].y).toBe(padding)
  })

  it('handles flat data (all same values)', () => {
    const data = [5, 5, 5]
    const points = calculateSparklinePoints(data, width, height, padding)

    // All y values should be the same when data is flat
    expect(points[0].y).toBe(points[1].y)
    expect(points[1].y).toBe(points[2].y)
  })
})

// ============================================================================
// Time Formatting Tests (from CompactionMarker)
// ============================================================================

/**
 * Format timestamp for display.
 * Extracted from CompactionMarker for testing.
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

describe('formatTime', () => {
  it('formats timestamp to HH:MM:SS format', () => {
    // Use a fixed timezone-independent test
    const time = formatTime(0)
    // Should match pattern HH:MM:SS
    expect(time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

// ============================================================================
// Event Index Search Tests (from Timeline)
// ============================================================================

interface MockEvent {
  time: string
}

/**
 * Find the event index closest to a given timestamp.
 * Extracted from Timeline for testing.
 */
function findEventIndexAtTimestamp(events: MockEvent[], timestamp: number): number {
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

describe('findEventIndexAtTimestamp', () => {
  it('returns 0 for empty events array', () => {
    expect(findEventIndexAtTimestamp([], 12345)).toBe(0)
  })

  it('finds correct index for timestamp matching first event', () => {
    const events = [
      { time: '2024-01-01T10:00:00Z' },
      { time: '2024-01-01T11:00:00Z' },
      { time: '2024-01-01T12:00:00Z' },
    ]
    const firstTimestamp = new Date('2024-01-01T10:00:00Z').getTime()
    expect(findEventIndexAtTimestamp(events, firstTimestamp)).toBe(0)
  })

  it('finds correct index for timestamp matching last event', () => {
    const events = [
      { time: '2024-01-01T10:00:00Z' },
      { time: '2024-01-01T11:00:00Z' },
      { time: '2024-01-01T12:00:00Z' },
    ]
    const lastTimestamp = new Date('2024-01-01T12:00:00Z').getTime()
    expect(findEventIndexAtTimestamp(events, lastTimestamp)).toBe(2)
  })

  it('finds correct index for timestamp between events', () => {
    const events = [
      { time: '2024-01-01T10:00:00Z' },
      { time: '2024-01-01T11:00:00Z' },
      { time: '2024-01-01T12:00:00Z' },
    ]
    const midTimestamp = new Date('2024-01-01T10:30:00Z').getTime()
    // Should return index 1 (first event >= timestamp)
    expect(findEventIndexAtTimestamp(events, midTimestamp)).toBe(1)
  })

  it('returns 0 for timestamp before all events', () => {
    const events = [{ time: '2024-01-01T10:00:00Z' }, { time: '2024-01-01T11:00:00Z' }]
    const beforeTimestamp = new Date('2024-01-01T09:00:00Z').getTime()
    expect(findEventIndexAtTimestamp(events, beforeTimestamp)).toBe(0)
  })

  it('returns last index for timestamp after all events', () => {
    const events = [{ time: '2024-01-01T10:00:00Z' }, { time: '2024-01-01T11:00:00Z' }]
    const afterTimestamp = new Date('2024-01-01T15:00:00Z').getTime()
    expect(findEventIndexAtTimestamp(events, afterTimestamp)).toBe(1)
  })
})
