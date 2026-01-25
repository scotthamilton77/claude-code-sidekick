/**
 * Tests for session-summary event factories
 */

import { describe, it, expect } from 'vitest'
import { SessionSummaryEvents } from '../events.js'

describe('SessionSummaryEvents', () => {
  describe('summaryUpdated', () => {
    it('should create SummaryUpdated events with reason', () => {
      const event = SessionSummaryEvents.summaryUpdated(
        { sessionId: 'sess-123' },
        {
          session_title: 'Working on OAuth',
          session_title_confidence: 0.95,
          latest_intent: 'Fixing token expiration',
          latest_intent_confidence: 0.88,
        },
        {
          countdown_reset_to: 20,
          tokens_used: 150,
          processing_time_ms: 200,
          pivot_detected: false,
          old_title: 'Setting up OAuth',
          old_intent: 'Configuring provider',
        },
        'user_prompt_forced'
      )

      expect(event.type).toBe('SummaryUpdated')
      expect(event.source).toBe('daemon')
      expect(event.payload.reason).toBe('user_prompt_forced')
      expect(event.payload.state.session_title).toBe('Working on OAuth')
      expect(event.payload.state.session_title_confidence).toBe(0.95)
      expect(event.payload.metadata.pivot_detected).toBe(false)
      expect(event.payload.metadata.countdown_reset_to).toBe(20)
    })

    it('should support countdown_reached reason', () => {
      const event = SessionSummaryEvents.summaryUpdated(
        { sessionId: 'sess-123' },
        {
          session_title: 'Test',
          session_title_confidence: 0.9,
          latest_intent: 'Testing',
          latest_intent_confidence: 0.9,
        },
        {
          countdown_reset_to: 10,
          pivot_detected: true,
        },
        'countdown_reached'
      )

      expect(event.payload.reason).toBe('countdown_reached')
      expect(event.payload.metadata.pivot_detected).toBe(true)
    })

    it('should include context fields', () => {
      const event = SessionSummaryEvents.summaryUpdated(
        {
          sessionId: 'sess-123',
          correlationId: 'corr-456',
          taskId: 'task-789',
        },
        {
          session_title: 'Test',
          session_title_confidence: 0.9,
          latest_intent: 'Testing',
          latest_intent_confidence: 0.9,
        },
        { countdown_reset_to: 10, pivot_detected: false },
        'compaction_reset'
      )

      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.correlationId).toBe('corr-456')
      expect(event.context.taskId).toBe('task-789')
    })
  })

  describe('summarySkipped', () => {
    it('should create SummarySkipped events', () => {
      const event = SessionSummaryEvents.summarySkipped(
        { sessionId: 'sess-123' },
        { countdown: 5, countdown_threshold: 0 }
      )

      expect(event.type).toBe('SummarySkipped')
      expect(event.source).toBe('daemon')
      expect(event.payload.metadata.countdown).toBe(5)
      expect(event.payload.metadata.countdown_threshold).toBe(0)
      expect(event.payload.reason).toBe('countdown_active')
    })

    it('should include session context', () => {
      const event = SessionSummaryEvents.summarySkipped(
        { sessionId: 'sess-456' },
        { countdown: 3, countdown_threshold: 0 }
      )

      expect(event.context.sessionId).toBe('sess-456')
    })
  })
})
