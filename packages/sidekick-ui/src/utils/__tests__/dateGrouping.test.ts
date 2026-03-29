import { describe, it, expect } from 'vitest'
import { isToday, isYesterday, isThisWeek, isThisMonth, groupSessionsByDate, DATE_GROUP_ORDER } from '../dateGrouping'
import type { Session } from '../../types'

/** Build an ISO-ish dateRaw string that resolves to the given local date/hour. */
function localDateRaw(year: number, month: number, day: number, hour = 12): string {
  return new Date(year, month, day, hour).toISOString()
}

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
    const now = new Date(2026, 2, 29, 15) // March 29 3pm local
    const d = new Date(2026, 2, 29, 8)   // March 29 8am local
    expect(isToday(d, now)).toBe(true)
  })

  it('returns false for yesterday', () => {
    const now = new Date(2026, 2, 29, 15)
    const d = new Date(2026, 2, 28, 23)
    expect(isToday(d, now)).toBe(false)
  })

  it('returns false for same day different month', () => {
    const now = new Date(2026, 2, 29, 15) // March 29
    const d = new Date(2026, 1, 28, 15)   // Feb 28 (2026 is not a leap year)
    expect(isToday(d, now)).toBe(false)
  })
})

describe('isYesterday', () => {
  it('returns true for the previous day', () => {
    const now = new Date(2026, 2, 29, 15)
    const d = new Date(2026, 2, 28, 10)
    expect(isYesterday(d, now)).toBe(true)
  })

  it('returns false for today', () => {
    const now = new Date(2026, 2, 29, 15)
    const d = new Date(2026, 2, 29, 10)
    expect(isYesterday(d, now)).toBe(false)
  })

  it('returns false for two days ago', () => {
    const now = new Date(2026, 2, 29, 15)
    const d = new Date(2026, 2, 27, 10)
    expect(isYesterday(d, now)).toBe(false)
  })

  it('handles month boundary (March 1 → Feb 28)', () => {
    const now = new Date(2026, 2, 1, 12)  // March 1
    const d = new Date(2026, 1, 28, 12)   // Feb 28
    expect(isYesterday(d, now)).toBe(true)
  })
})

describe('isThisWeek', () => {
  it('returns true for a date in the same week (Sunday start)', () => {
    // 2026-03-29 is a Sunday
    const now = new Date(2026, 2, 29, 15)
    expect(isThisWeek(new Date(2026, 2, 29, 10), now)).toBe(true)
  })

  it('returns false for a date before start of week', () => {
    // 2026-03-29 is Sunday, start of week is that Sunday at midnight
    const now = new Date(2026, 2, 29, 15)
    const d = new Date(2026, 2, 22, 10) // previous Sunday
    expect(isThisWeek(d, now)).toBe(false)
  })

  it('returns true for midweek date when now is later in the week', () => {
    // March 25 is Wednesday, March 22 is Sunday (start)
    const now = new Date(2026, 2, 25, 15)
    const d = new Date(2026, 2, 23, 10) // Monday
    expect(isThisWeek(d, now)).toBe(true)
  })
})

describe('isThisMonth', () => {
  it('returns true for same month and year', () => {
    const now = new Date(2026, 2, 29, 15) // March 29
    const d = new Date(2026, 2, 1, 12)    // March 1
    expect(isThisMonth(d, now)).toBe(true)
  })

  it('returns false for different month', () => {
    const now = new Date(2026, 2, 29, 15)
    const d = new Date(2026, 1, 15, 12)   // February 15
    expect(isThisMonth(d, now)).toBe(false)
  })

  it('returns false for same month different year', () => {
    const now = new Date(2026, 2, 29, 15)
    const d = new Date(2025, 2, 29, 15)
    expect(isThisMonth(d, now)).toBe(false)
  })
})

describe('groupSessionsByDate', () => {
  const now = new Date(2026, 2, 29, 15) // Sunday March 29, 3pm local

  it('groups a session from today into "Today"', () => {
    const sessions = [makeSession(localDateRaw(2026, 2, 29, 10), 's1')]
    const groups = groupSessionsByDate(sessions, now)
    expect(groups.get('Today')).toHaveLength(1)
    expect(groups.get('Today')![0].id).toBe('s1')
  })

  it('groups a session from yesterday into "Yesterday"', () => {
    const sessions = [makeSession(localDateRaw(2026, 2, 28, 20), 's2')]
    const groups = groupSessionsByDate(sessions, now)
    expect(groups.get('Yesterday')).toHaveLength(1)
  })

  it('groups session from earlier this week into "This Week"', () => {
    // Use Wednesday March 25 as reference so "This Week" has days before today/yesterday
    const wed = new Date(2026, 2, 25, 15)
    // Monday March 23 is in same week (starts Sunday March 22)
    const sessions = [makeSession(localDateRaw(2026, 2, 23, 12), 's3')]
    const groups = groupSessionsByDate(sessions, wed)
    expect(groups.get('This Week')).toHaveLength(1)
    expect(groups.get('This Week')![0].id).toBe('s3')
  })

  it('groups sessions into all categories correctly', () => {
    // Use Wednesday March 25 as reference
    const wed = new Date(2026, 2, 25, 15)
    const sessions = [
      makeSession(localDateRaw(2026, 2, 25, 10), 'today'),     // Today (Wednesday)
      makeSession(localDateRaw(2026, 2, 24, 10), 'yesterday'),  // Yesterday (Tuesday)
      makeSession(localDateRaw(2026, 2, 23, 10), 'thisweek'),   // Monday (same week, start=Sunday Mar 22)
      makeSession(localDateRaw(2026, 2, 15, 10), 'thismonth'),  // This Month (March 15)
      makeSession(localDateRaw(2026, 1, 10, 10), 'older'),      // Older (February)
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
      makeSession(localDateRaw(2026, 2, 29, 8), 's1'),
      makeSession(localDateRaw(2026, 2, 29, 12), 's2'),
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
