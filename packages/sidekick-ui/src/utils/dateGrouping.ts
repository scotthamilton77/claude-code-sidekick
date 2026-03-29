import type { Session } from '../types'

export type DateGroup = 'Today' | 'Yesterday' | 'This Week' | 'This Month' | 'Older'

export const DATE_GROUP_ORDER: DateGroup[] = ['Today', 'Yesterday', 'This Week', 'This Month', 'Older']

export function isToday(d: Date, now: Date): boolean {
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export function isYesterday(d: Date, now: Date): boolean {
  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  return d.getFullYear() === yesterday.getFullYear() && d.getMonth() === yesterday.getMonth() && d.getDate() === yesterday.getDate()
}

export function isThisWeek(d: Date, now: Date): boolean {
  const startOfWeek = new Date(now)
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay())
  startOfWeek.setHours(0, 0, 0, 0)
  return d >= startOfWeek
}

export function isThisMonth(d: Date, now: Date): boolean {
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth()
}

export function groupSessionsByDate(sessions: Session[], now?: Date): Map<DateGroup, Session[]> {
  const groups = new Map<DateGroup, Session[]>()
  const ref = now ?? new Date()
  for (const session of sessions) {
    const d = new Date(session.dateRaw)
    const key: DateGroup = isToday(d, ref) ? 'Today'
      : isYesterday(d, ref) ? 'Yesterday'
      : isThisWeek(d, ref) ? 'This Week'
      : isThisMonth(d, ref) ? 'This Month'
      : 'Older'
    const arr = groups.get(key) ?? []
    arr.push(session)
    groups.set(key, arr)
  }
  return groups
}
