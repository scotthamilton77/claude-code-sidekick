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

      expect(event.type).toBe('reminder:consumed')
      expect(event.source).toBe('cli')
      expect(event.payload.reminderName).toBe('AreYouStuckReminder')
      expect(event.payload.blocking).toBe(true)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.hook).toBe('PreToolUse')
    })

    it('should handle optional fields', () => {
      const event = ReminderEvents.reminderConsumed(
        { sessionId: 'sess-123' },
        { reminderName: 'test', reminderReturned: true }
      )

      expect(event.payload.reminderName).toBe('test')
      expect(event.payload.reminderReturned).toBe(true)
      expect(event.payload.blocking).toBeUndefined()
      expect(event.payload.priority).toBeUndefined()
      expect(event.payload.persistent).toBeUndefined()
    })

    it('should include classificationResult when provided', () => {
      const event = ReminderEvents.reminderConsumed(
        { sessionId: 'sess-123', hook: 'Stop' },
        {
          reminderName: 'verify-completion',
          reminderReturned: true,
          blocking: true,
          classificationResult: {
            category: 'CLAIMING_COMPLETION',
            confidence: 0.92,
            shouldBlock: true,
          },
        }
      )

      expect(event.payload.classificationResult).toEqual({
        category: 'CLAIMING_COMPLETION',
        confidence: 0.92,
        shouldBlock: true,
      })
    })

    it('should omit classificationResult when not provided', () => {
      const event = ReminderEvents.reminderConsumed(
        { sessionId: 'sess-123' },
        { reminderName: 'test', reminderReturned: true }
      )

      expect(event.payload.classificationResult).toBeUndefined()
    })
  })

  // Note: reminderStaged stays in @sidekick/core (used by staging-service.ts)

  describe('reminderUnstaged', () => {
    it('should create ReminderUnstaged events', () => {
      const event = ReminderEvents.reminderUnstaged(
        { sessionId: 'sess-123', hook: 'Stop' },
        {
          reminderName: 'verify-completion',
          hookName: 'Stop',
          reason: 'no_unverified_changes',
        }
      )

      expect(event.type).toBe('reminder:unstaged')
      expect(event.source).toBe('daemon')
      expect(event.payload.reminderName).toBe('verify-completion')
      expect(event.payload.hookName).toBe('Stop')
      expect(event.payload.reason).toBe('no_unverified_changes')
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.hook).toBe('Stop')
    })

    it('should handle minimal context', () => {
      const event = ReminderEvents.reminderUnstaged(
        { sessionId: 'sess-456' },
        { reminderName: 'test', hookName: 'PreToolUse', reason: 'cascade' }
      )

      expect(event.payload.reminderName).toBe('test')
      expect(event.payload.hookName).toBe('PreToolUse')
      expect(event.payload.reason).toBe('cascade')
      expect(event.context.hook).toBeUndefined()
    })

    it('should include optional enrichment fields when provided', () => {
      const event = ReminderEvents.reminderUnstaged(
        { sessionId: 'sess-123', hook: 'Stop' },
        {
          reminderName: 'verify-completion',
          hookName: 'Stop',
          reason: 'verification_passed',
          triggeredBy: 'cascade_from_pause_and_reflect',
          toolState: { status: 'verified', editsSinceVerified: 0 },
        }
      )

      expect(event.payload.triggeredBy).toBe('cascade_from_pause_and_reflect')
      expect(event.payload.toolState).toEqual({ status: 'verified', editsSinceVerified: 0 })
    })

    it('should omit enrichment fields when not provided', () => {
      const event = ReminderEvents.reminderUnstaged(
        { sessionId: 'sess-123' },
        { reminderName: 'test', hookName: 'Stop', reason: 'cascade' }
      )

      expect(event.payload.triggeredBy).toBeUndefined()
      expect(event.payload.toolState).toBeUndefined()
    })
  })

  describe('remindersCleared', () => {
    it('should create RemindersCleared events', () => {
      const event = ReminderEvents.remindersCleared(
        { sessionId: 'sess-123' },
        { clearedCount: 3, hookNames: ['PreToolUse', 'Stop'] },
        'session_start'
      )

      expect(event.type).toBe('reminder:cleared')
      expect(event.source).toBe('daemon')
      expect(event.payload.clearedCount).toBe(3)
      expect(event.payload.hookNames).toEqual(['PreToolUse', 'Stop'])
      expect(event.payload.reason).toBe('session_start')
    })

    it('should support manual clear reason', () => {
      const event = ReminderEvents.remindersCleared({ sessionId: 'sess-123' }, { clearedCount: 0 }, 'manual')

      expect(event.payload.reason).toBe('manual')
    })
  })
})
