import { describe, it, expect } from 'vitest'
import { SIDEKICK_EVENT_TO_FILTER, type SidekickEventType, type TimelineFilter } from '../types'

describe('SIDEKICK_EVENT_TO_FILTER', () => {
  it('should map all 16 SidekickEventType values', () => {
    const expectedTypes: SidekickEventType[] = [
      'reminder-staged',
      'reminder-unstaged',
      'reminder-consumed',
      'decision',
      'session-summary-start',
      'session-summary-finish',
      'session-title-changed',
      'intent-changed',
      'snarky-message-start',
      'snarky-message-finish',
      'resume-message-start',
      'resume-message-finish',
      'persona-selected',
      'persona-changed',
      'statusline-rendered',
      'log-error',
    ]
    expect(Object.keys(SIDEKICK_EVENT_TO_FILTER).sort()).toEqual(expectedTypes.sort())
  })

  it('should map reminder events to reminders filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['reminder-staged']).toBe('reminders')
    expect(SIDEKICK_EVENT_TO_FILTER['reminder-unstaged']).toBe('reminders')
    expect(SIDEKICK_EVENT_TO_FILTER['reminder-consumed']).toBe('reminders')
  })

  it('should map analysis events to session-analysis filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['session-summary-start']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['session-summary-finish']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['session-title-changed']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['intent-changed']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['persona-selected']).toBe('session-analysis')
  })

  it('should map snarky and resume message events to session-analysis filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['snarky-message-start']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['snarky-message-finish']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['resume-message-start']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['resume-message-finish']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['persona-changed']).toBe('session-analysis')
  })

  it('should map decision to decisions filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['decision']).toBe('decisions')
  })

  it('should map statusline to statusline filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['statusline-rendered']).toBe('statusline')
  })

  it('should map log-error to errors filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['log-error']).toBe('errors')
  })

  it('every mapped value should be a valid TimelineFilter', () => {
    const validFilters: TimelineFilter[] = ['reminders', 'decisions', 'session-analysis', 'statusline', 'errors']
    for (const filter of Object.values(SIDEKICK_EVENT_TO_FILTER)) {
      expect(validFilters).toContain(filter)
    }
  })
})
