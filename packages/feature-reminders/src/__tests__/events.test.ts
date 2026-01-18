/**
 * Tests for reminder event factories
 */

import { describe, it, expect } from 'vitest'
import { ReminderEvents } from '../events.js'

describe('ReminderEvents', () => {
  describe('reminderConsumed', () => {
    it('should create ReminderConsumed events', () => {
      const event = ReminderEvents.reminderConsumed(
        { sessionId: 'sess-123', hook: 'PreToolUse' },
        {
          reminderName: 'AreYouStuckReminder',
          reminderReturned: true,
          blocking: true,
          priority: 80,
        }
      )

      expect(event.type).toBe('ReminderConsumed')
      expect(event.source).toBe('cli')
      expect(event.payload.state.reminderName).toBe('AreYouStuckReminder')
      expect(event.payload.state.blocking).toBe(true)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.hook).toBe('PreToolUse')
    })

    it('should include optional metadata', () => {
      const event = ReminderEvents.reminderConsumed(
        { sessionId: 'sess-123' },
        { reminderName: 'test', reminderReturned: true },
        { stagingPath: '/tmp/staging/test.json' }
      )

      expect(event.payload.metadata?.stagingPath).toBe('/tmp/staging/test.json')
    })
  })

  // Note: reminderStaged stays in @sidekick/core (used by staging-service.ts)

  describe('remindersCleared', () => {
    it('should create RemindersCleared events', () => {
      const event = ReminderEvents.remindersCleared(
        { sessionId: 'sess-123' },
        { clearedCount: 3, hookNames: ['PreToolUse', 'Stop'] },
        'session_start'
      )

      expect(event.type).toBe('RemindersCleared')
      expect(event.source).toBe('daemon')
      expect(event.payload.state.clearedCount).toBe(3)
      expect(event.payload.state.hookNames).toEqual(['PreToolUse', 'Stop'])
      expect(event.payload.reason).toBe('session_start')
    })

    it('should support manual clear reason', () => {
      const event = ReminderEvents.remindersCleared(
        { sessionId: 'sess-123' },
        { clearedCount: 0 },
        'manual'
      )

      expect(event.payload.reason).toBe('manual')
    })
  })
})
