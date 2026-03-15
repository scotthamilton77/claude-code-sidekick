import { describe, it, expect } from 'vitest'
import { SIDEKICK_EVENT_TO_FILTER, type SidekickEventType, type TimelineFilter } from '../types'

describe('SIDEKICK_EVENT_TO_FILTER', () => {
  it('should map all 19 SidekickEventType values', () => {
    const expectedTypes: SidekickEventType[] = [
      'reminder:staged',
      'reminder:unstaged',
      'reminder:consumed',
      'reminder:cleared',
      'decision:recorded',
      'session-summary:start',
      'session-summary:finish',
      'session-title:changed',
      'intent:changed',
      'snarky-message:start',
      'snarky-message:finish',
      'resume-message:start',
      'resume-message:finish',
      'persona:selected',
      'persona:changed',
      'statusline:rendered',
      'error:occurred',
      'hook:received',
      'hook:completed',
    ]
    expect(Object.keys(SIDEKICK_EVENT_TO_FILTER).sort()).toEqual(expectedTypes.sort())
  })

  it('should map reminder events to reminders filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['reminder:staged']).toBe('reminders')
    expect(SIDEKICK_EVENT_TO_FILTER['reminder:unstaged']).toBe('reminders')
    expect(SIDEKICK_EVENT_TO_FILTER['reminder:consumed']).toBe('reminders')
    expect(SIDEKICK_EVENT_TO_FILTER['reminder:cleared']).toBe('reminders')
  })

  it('should map analysis events to session-analysis filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['session-summary:start']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['session-summary:finish']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['session-title:changed']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['intent:changed']).toBe('session-analysis')
  })

  it('should map persona:selected to decisions filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['persona:selected']).toBe('decisions')
  })

  it('should map snarky and resume message events to session-analysis filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['snarky-message:start']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['snarky-message:finish']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['resume-message:start']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['resume-message:finish']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['persona:changed']).toBe('session-analysis')
  })

  it('should map decision:recorded to decisions filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['decision:recorded']).toBe('decisions')
  })

  it('should map statusline:rendered to statusline filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['statusline:rendered']).toBe('statusline')
  })

  it('should map error:occurred to errors filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['error:occurred']).toBe('errors')
  })

  it('should map hook events to hooks filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['hook:received']).toBe('hooks')
    expect(SIDEKICK_EVENT_TO_FILTER['hook:completed']).toBe('hooks')
  })

  it('every mapped value should be a valid TimelineFilter', () => {
    const validFilters: TimelineFilter[] = ['reminders', 'decisions', 'session-analysis', 'statusline', 'errors', 'hooks']
    for (const filter of Object.values(SIDEKICK_EVENT_TO_FILTER)) {
      expect(validFilters).toContain(filter)
    }
  })
})
