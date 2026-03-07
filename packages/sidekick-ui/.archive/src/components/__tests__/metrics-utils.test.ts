/**
 * Metrics Utilities Tests
 *
 * Tests for shared utility functions used in MetricsPanel, Sparkline, Timeline,
 * and CompactionMarker components.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §4.2 TranscriptMetrics
 */

import { describe, it, expect } from 'vitest'
import {
  formatNumber,
  formatRatio,
  formatTime,
  calculateSparklinePoints,
  findEventIndexAtTimestamp,
  calculateTimelinePercentage,
  calculateSliderMax,
  formatProgressText,
} from '../../lib/metrics-utils'

// ============================================================================
// formatNumber Tests
// ============================================================================

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

// ============================================================================
// formatRatio Tests
// ============================================================================

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
// formatTime Tests
// ============================================================================

describe('formatTime', () => {
  it('formats timestamp to HH:MM:SS format', () => {
    const time = formatTime(0)
    // Should match pattern HH:MM:SS
    expect(time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

// ============================================================================
// calculateSparklinePoints Tests
// ============================================================================

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
    // Single point should be at padding x
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
// findEventIndexAtTimestamp Tests
// ============================================================================

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

// ============================================================================
// calculateTimelinePercentage Tests (Division by Zero Guards)
// ============================================================================

describe('calculateTimelinePercentage', () => {
  it('returns 0 for 0 events', () => {
    expect(calculateTimelinePercentage(0, 0)).toBe(0)
  })

  it('returns 0 for 1 event (avoids division by zero)', () => {
    expect(calculateTimelinePercentage(0, 1)).toBe(0)
  })

  it('calculates correctly for 2+ events', () => {
    expect(calculateTimelinePercentage(0, 5)).toBe(0)
    expect(calculateTimelinePercentage(2, 5)).toBe(50)
    expect(calculateTimelinePercentage(4, 5)).toBe(100)
  })

  it('result never contains NaN or Infinity', () => {
    const edgeCases = [
      { index: 0, total: 0 },
      { index: 0, total: 1 },
      { index: 1, total: 1 },
    ]

    edgeCases.forEach(({ index, total }) => {
      const result = calculateTimelinePercentage(index, total)
      expect(Number.isNaN(result)).toBe(false)
      expect(Number.isFinite(result)).toBe(true)
    })
  })
})

// ============================================================================
// calculateSliderMax Tests
// ============================================================================

describe('calculateSliderMax', () => {
  it('returns 0 for 0 events', () => {
    expect(calculateSliderMax(0)).toBe(0)
  })

  it('returns 0 for 1 event', () => {
    expect(calculateSliderMax(1)).toBe(0)
  })

  it('returns eventsLength - 1 for multiple events', () => {
    expect(calculateSliderMax(5)).toBe(4)
    expect(calculateSliderMax(10)).toBe(9)
  })
})

// ============================================================================
// formatProgressText Tests
// ============================================================================

describe('formatProgressText', () => {
  it('shows 1/0 for empty timeline', () => {
    expect(formatProgressText(0, 0)).toBe('1 / 0')
  })

  it('shows 1/1 for single event', () => {
    expect(formatProgressText(0, 1)).toBe('1 / 1')
  })

  it('shows correct count for multiple events', () => {
    expect(formatProgressText(4, 10)).toBe('5 / 10')
  })
})
