/**
 * Tests for session-summary event factories
 */

import { describe, it, expect } from 'vitest'
import { SessionSummaryEvents, DecisionEvents } from '../events.js'
import { LogEvents } from '@sidekick/core'

describe('SessionSummaryEvents', () => {
  describe('summaryStart', () => {
    it('should create session-summary:start events', () => {
      const event = SessionSummaryEvents.summaryStart(
        { sessionId: 'sess-123' },
        { reason: 'user_prompt_forced', countdown: 5 }
      )

      expect(event.type).toBe('session-summary:start')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.reason).toBe('user_prompt_forced')
      expect(event.payload.countdown).toBe(5)
    })
  })

  describe('summaryFinish', () => {
    it('should create session-summary:finish events', () => {
      const event = SessionSummaryEvents.summaryFinish(
        { sessionId: 'sess-123' },
        {
          session_title: 'Working on OAuth',
          session_title_confidence: 0.95,
          latest_intent: 'Fixing token expiration',
          latest_intent_confidence: 0.88,
          processing_time_ms: 200,
          pivot_detected: false,
        }
      )

      expect(event.type).toBe('session-summary:finish')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.session_title).toBe('Working on OAuth')
      expect(event.payload.session_title_confidence).toBe(0.95)
      expect(event.payload.latest_intent).toBe('Fixing token expiration')
      expect(event.payload.latest_intent_confidence).toBe(0.88)
      expect(event.payload.processing_time_ms).toBe(200)
      expect(event.payload.pivot_detected).toBe(false)
    })

    it('should include context fields', () => {
      const event = SessionSummaryEvents.summaryFinish(
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
          processing_time_ms: 100,
          pivot_detected: false,
        }
      )

      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.correlationId).toBe('corr-456')
      expect(event.context.taskId).toBe('task-789')
    })
  })

  describe('titleChanged', () => {
    it('should create session-title:changed events', () => {
      const event = SessionSummaryEvents.titleChanged(
        { sessionId: 'sess-123' },
        {
          previousValue: 'Setting up OAuth',
          newValue: 'Working on OAuth',
          confidence: 0.95,
        }
      )

      expect(event.type).toBe('session-title:changed')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.payload.previousValue).toBe('Setting up OAuth')
      expect(event.payload.newValue).toBe('Working on OAuth')
      expect(event.payload.confidence).toBe(0.95)
    })
  })

  describe('intentChanged', () => {
    it('should create intent:changed events', () => {
      const event = SessionSummaryEvents.intentChanged(
        { sessionId: 'sess-123' },
        {
          previousValue: 'Configuring provider',
          newValue: 'Fixing token expiration',
          confidence: 0.88,
        }
      )

      expect(event.type).toBe('intent:changed')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.payload.previousValue).toBe('Configuring provider')
      expect(event.payload.newValue).toBe('Fixing token expiration')
      expect(event.payload.confidence).toBe(0.88)
    })
  })

  describe('summarySkipped', () => {
    it('should create session-summary:skipped events', () => {
      const event = SessionSummaryEvents.summarySkipped(
        { sessionId: 'sess-123' },
        { countdown: 5, countdown_threshold: 0 }
      )

      expect(event.type).toBe('session-summary:skipped')
      expect(event.source).toBe('daemon')
      expect(event.payload.countdown).toBe(5)
      expect(event.payload.countdown_threshold).toBe(0)
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

describe('DecisionEvents', () => {
  describe('decisionRecorded', () => {
    it('should create decision:recorded events with correct type and source', () => {
      const event = DecisionEvents.decisionRecorded(
        { sessionId: 'sess-123' },
        {
          decision: 'calling',
          reason: 'UserPrompt event forces immediate analysis',
          detail: 'session-summary analysis',
        }
      )

      expect(event.type).toBe('decision:recorded')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.decision).toBe('calling')
      expect(event.payload.reason).toBe('UserPrompt event forces immediate analysis')
      expect(event.payload.detail).toBe('session-summary analysis')
    })

    it('should create skipped decision events', () => {
      const event = DecisionEvents.decisionRecorded(
        { sessionId: 'sess-456' },
        {
          decision: 'skipped',
          reason: 'countdown not reached (5 tool results remaining)',
          detail: 'session-summary analysis',
        }
      )

      expect(event.type).toBe('decision:recorded')
      expect(event.payload.decision).toBe('skipped')
      expect(event.payload.reason).toBe('countdown not reached (5 tool results remaining)')
    })

    it('should include full context fields', () => {
      const event = DecisionEvents.decisionRecorded(
        {
          sessionId: 'sess-123',
          correlationId: 'corr-456',
          traceId: 'trace-789',
          taskId: 'task-abc',
        },
        {
          decision: 'calling',
          reason: 'countdown reached zero',
          detail: 'session-summary analysis',
        }
      )

      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.correlationId).toBe('corr-456')
      expect(event.context.traceId).toBe('trace-789')
      expect(event.context.taskId).toBe('task-abc')
    })
  })
})

describe('LogEvents persona factories', () => {
  describe('personaSelected', () => {
    it('should create persona:selected events', () => {
      const event = LogEvents.personaSelected(
        { sessionId: 'sess-123' },
        { personaId: 'snarky-cat', selectionMethod: 'random', poolSize: 5 }
      )

      expect(event.type).toBe('persona:selected')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.personaId).toBe('snarky-cat')
      expect(event.payload.selectionMethod).toBe('random')
      expect(event.payload.poolSize).toBe(5)
    })

    it('should support pinned selection method', () => {
      const event = LogEvents.personaSelected(
        { sessionId: 'sess-123' },
        { personaId: 'zen-master', selectionMethod: 'pinned', poolSize: 1 }
      )

      expect(event.payload.selectionMethod).toBe('pinned')
      expect(event.payload.poolSize).toBe(1)
    })

    it('should support handoff selection method', () => {
      const event = LogEvents.personaSelected(
        { sessionId: 'sess-123' },
        { personaId: 'zen-master', selectionMethod: 'handoff', poolSize: 1 }
      )

      expect(event.payload.selectionMethod).toBe('handoff')
    })

    it('should include context fields', () => {
      const event = LogEvents.personaSelected(
        {
          sessionId: 'sess-123',
          correlationId: 'corr-456',
          traceId: 'trace-789',
          taskId: 'task-abc',
        },
        { personaId: 'snarky-cat', selectionMethod: 'random', poolSize: 3 }
      )

      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.correlationId).toBe('corr-456')
      expect(event.context.traceId).toBe('trace-789')
      expect(event.context.taskId).toBe('task-abc')
    })
  })

  describe('personaChanged', () => {
    it('should create persona:changed events', () => {
      const event = LogEvents.personaChanged(
        { sessionId: 'sess-123' },
        { personaFrom: 'snarky-cat', personaTo: 'zen-master', reason: 'mid_session_change' }
      )

      expect(event.type).toBe('persona:changed')
      expect(event.source).toBe('daemon')
      expect(event.time).toBeGreaterThan(0)
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.personaFrom).toBe('snarky-cat')
      expect(event.payload.personaTo).toBe('zen-master')
      expect(event.payload.reason).toBe('mid_session_change')
    })

    it('should handle change from none', () => {
      const event = LogEvents.personaChanged(
        { sessionId: 'sess-123' },
        { personaFrom: 'none', personaTo: 'snarky-cat', reason: 'mid_session_change' }
      )

      expect(event.payload.personaFrom).toBe('none')
      expect(event.payload.personaTo).toBe('snarky-cat')
    })

    it('should include context fields', () => {
      const event = LogEvents.personaChanged(
        {
          sessionId: 'sess-123',
          correlationId: 'corr-456',
          taskId: 'task-789',
        },
        { personaFrom: 'a', personaTo: 'b', reason: 'test' }
      )

      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.correlationId).toBe('corr-456')
      expect(event.context.taskId).toBe('task-789')
    })
  })
})
