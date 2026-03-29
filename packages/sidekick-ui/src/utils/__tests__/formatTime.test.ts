import { describe, it, expect } from 'vitest'
import { formatTime } from '../formatTime'

describe('formatTime', () => {
  it('includes milliseconds in the formatted time', () => {
    // 2025-01-15T10:30:45.123Z
    const ts = new Date('2025-01-15T10:30:45.123Z').getTime()
    const result = formatTime(ts)
    // Should contain .123 for milliseconds
    expect(result).toMatch(/\.123$/)
  })

  it('pads milliseconds with leading zeros', () => {
    // 2025-01-15T10:30:45.007Z
    const ts = new Date('2025-01-15T10:30:45.007Z').getTime()
    const result = formatTime(ts)
    expect(result).toMatch(/\.007$/)
  })

  it('distinguishes events within the same second', () => {
    const ts1 = new Date('2025-01-15T10:30:45.100Z').getTime()
    const ts2 = new Date('2025-01-15T10:30:45.200Z').getTime()
    expect(formatTime(ts1)).not.toBe(formatTime(ts2))
  })
})
