import { describe, it, expect } from 'vitest'
import { isToday, isYesterday, isThisWeek, isThisMonth, groupSessionsByDate, DATE_GROUP_ORDER } from '../dateGrouping'
import type { Session } from '../../types'

function makeSession(dateRaw: string, id = 'sess-1'): Session {
  return {
    id,
    title: 'Test session',
    date: 'formatted',
    dateRaw,
    branch: 'main',
    projectId: 'proj-1',
    status: 'completed',
    transcriptLines: [],
    sidekickEvents: [],
    ledStates: new Map(),
    stateSnapshots: [],
  }
}

describe('isToday', () => {
  it('returns true for same date', () => {
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-03-29T08:00:00Z')
    expect(isToday(d, now)).toBe(true)
  })

  it('returns false for yesterday', () => {
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-03-28T23:00:00Z')
    expect(isToday(d, now)).toBe(false)
  })

  it('returns false for same day different month', () => {
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-02-29T15:00:00Z') // Feb 29 (2026 is not leap year, so Feb 28 max)
    expect(isToday(d, now)).toBe(false)
  })
})

describe('isYesterday', () => {
  it('returns true for the previous day', () => {
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-03-28T10:00:00Z')
    expect(isYesterday(d, now)).toBe(true)
  })

  it('returns false for today', () => {
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-03-29T10:00:00Z')
    expect(isYesterday(d, now)).toBe(false)
  })

  it('returns false for two days ago', () => {
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-03-27T10:00:00Z')
    expect(isYesterday(d, now)).toBe(false)
  })

  it('handles month boundary (March 1 → Feb 28)', () => {
    const now = new Date('2026-03-01T12:00:00Z')
    const d = new Date('2026-02-28T12:00:00Z')
    expect(isYesterday(d, now)).toBe(true)
  })
})

describe('isThisWeek', () => {
  it('returns true for a date in the same week (Sunday start)', () => {
    // 2026-03-29 is a Sunday
    const now = new Date('2026-03-29T15:00:00Z')
    expect(isThisWeek(new Date('2026-03-29T10:00:00Z'), now)).toBe(true)
  })

  it('returns false for a date before start of week', () => {
    // 2026-03-29 is Sunday, start of week is that Sunday at midnight
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-03-22T10:00:00Z') // previous Sunday
    expect(isThisWeek(d, now)).toBe(false)
  })

  it('returns true for midweek date when now is later in the week', () => {
    // March 25 is Wednesday, March 22 is Sunday (start)
    const now = new Date('2026-03-25T15:00:00Z')
    const d = new Date('2026-03-23T10:00:00Z') // Monday
    expect(isThisWeek(d, now)).toBe(true)
  })
})

describe('isThisMonth', () => {
  it('returns true for same month and year', () => {
    // Use midday UTC to avoid local-timezone boundary issues
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-03-01T12:00:00Z')
    expect(isThisMonth(d, now)).toBe(true)
  })

  it('returns false for different month', () => {
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2026-02-15T12:00:00Z')
    expect(isThisMonth(d, now)).toBe(false)
  })

  it('returns false for same month different year', () => {
    const now = new Date('2026-03-29T15:00:00Z')
    const d = new Date('2025-03-29T15:00:00Z')
    expect(isThisMonth(d, now)).toBe(false)
  })
})

describe('groupSessionsByDate', () => {
  const now = new Date('2026-03-29T15:00:00Z') // Sunday

  it('groups a session from today into "Today"', () => {
    const sessions = [makeSession('2026-03-29T10:00:00Z', 's1')]
    const groups = groupSessionsByDate(sessions, now)
    expect(groups.get('Today')).toHaveLength(1)
    expect(groups.get('Today')![0].id).toBe('s1')
  })

  it('groups a session from yesterday into "Yesterday"', () => {
    const sessions = [makeSession('2026-03-28T20:00:00Z', 's2')]
    const groups = groupSessionsByDate(sessions, now)
    expect(groups.get('Yesterday')).toHaveLength(1)
  })

  it('groups session from earlier this week into "This Week"', () => {
    // Use Wednesday March 25 as reference so "This Week" has days before today/yesterday
    const wed = new Date('2026-03-25T15:00:00Z')
    // Monday March 23 is in same week (starts Sunday March 22)
    const sessions = [makeSession('2026-03-23T12:00:00Z', 's3')]
    const groups = groupSessionsByDate(sessions, wed)
    expect(groups.get('This Week')).toHaveLength(1)
    expect(groups.get('This Week')![0].id).toBe('s3')
  })

  it('groups sessions into all categories correctly', () => {
    // Use Wednesday March 25 as reference
    const wed = new Date('2026-03-25T15:00:00Z')
    const sessions = [
      makeSession('2026-03-25T10:00:00Z', 'today'),     // Today (Wednesday)
      makeSession('2026-03-24T10:00:00Z', 'yesterday'),  // Yesterday (Tuesday)
      makeSession('2026-03-23T10:00:00Z', 'thisweek'),   // Monday (same week, start=Sunday Mar 22)
      makeSession('2026-03-15T10:00:00Z', 'thismonth'),  // This Month (March 15)
      makeSession('2026-02-10T10:00:00Z', 'older'),      // Older (February)
    ]
    const groups = groupSessionsByDate(sessions, wed)
    expect(groups.get('Today')?.map(s => s.id)).toEqual(['today'])
    expect(groups.get('Yesterday')?.map(s => s.id)).toEqual(['yesterday'])
    expect(groups.get('This Week')?.map(s => s.id)).toEqual(['thisweek'])
    expect(groups.get('This Month')?.map(s => s.id)).toEqual(['thismonth'])
    expect(groups.get('Older')?.map(s => s.id)).toEqual(['older'])
  })

  it('returns empty map for no sessions', () => {
    const groups = groupSessionsByDate([], now)
    expect(groups.size).toBe(0)
  })

  it('accumulates multiple sessions in the same group', () => {
    const sessions = [
      makeSession('2026-03-29T08:00:00Z', 's1'),
      makeSession('2026-03-29T12:00:00Z', 's2'),
    ]
    const groups = groupSessionsByDate(sessions, now)
    expect(groups.get('Today')).toHaveLength(2)
  })
})

describe('DATE_GROUP_ORDER', () => {
  it('has 5 groups in chronological order', () => {
    expect(DATE_GROUP_ORDER).toEqual(['Today', 'Yesterday', 'This Week', 'This Month', 'Older'])
  })
})
