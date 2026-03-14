import { describe, it, expect } from 'vitest'
import {
  UI_EVENT_TYPES,
  UI_EVENT_VISIBILITY,
  type UIEventPayloadMap,
  type ReminderNotStagedPayload,
  type CanonicalEvent,
} from '../events.js'

describe('reminder:not-staged event type', () => {
  it('should be in UI_EVENT_TYPES array', () => {
    expect(UI_EVENT_TYPES).toContain('reminder:not-staged')
  })

  it('should have log visibility', () => {
    expect(UI_EVENT_VISIBILITY['reminder:not-staged']).toBe('log')
  })

  it('should be in UIEventPayloadMap', () => {
    // Type-level test: if this compiles, the mapping exists
    const _check: UIEventPayloadMap['reminder:not-staged'] = {
      reminderName: 'vc-build',
      hookName: 'Stop',
      reason: 'below_threshold',
    }
    expect(_check.reminderName).toBe('vc-build')
  })

  it('should support optional threshold fields', () => {
    const payload: ReminderNotStagedPayload = {
      reminderName: 'vc-build',
      hookName: 'Stop',
      reason: 'below_threshold',
      threshold: 3,
      currentValue: 1,
      triggeredBy: 'file_edit',
    }
    expect(payload.threshold).toBe(3)
    expect(payload.currentValue).toBe(1)
    expect(payload.triggeredBy).toBe('file_edit')
  })

  it('should be usable in CanonicalEvent generic', () => {
    // Type-level test: CanonicalEvent<'reminder:not-staged'> should compile
    const event: CanonicalEvent<'reminder:not-staged'> = {
      type: 'reminder:not-staged',
      visibility: 'log',
      source: 'daemon',
      time: Date.now(),
      context: { sessionId: 'test' },
      payload: {
        reminderName: 'vc-build',
        hookName: 'Stop',
        reason: 'below_threshold',
      },
    }
    expect(event.type).toBe('reminder:not-staged')
  })
})
