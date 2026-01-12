/**
 * Event Adapter Tests
 *
 * Tests for ParsedLogRecord to UIEvent conversion including
 * structured payload extraction for reminder, summary, and decision events.
 *
 * @see src/types/index.ts for type definitions
 */

import { describe, it, expect } from 'vitest'
import { logRecordToUIEvent, logRecordsToUIEvents, formatTime, getEventKind } from '../event-adapter'
import type { ParsedLogRecord } from '../log-parser'

// ============================================================================
// Test Fixtures
// ============================================================================

/** Create a minimal ParsedLogRecord for testing */
function createLogRecord(overrides: Partial<ParsedLogRecord>): ParsedLogRecord {
  return {
    pino: {
      level: 30,
      time: 1678888888000,
      pid: 12345,
      hostname: 'test',
      msg: 'Test message',
      name: 'sidekick:test',
    },
    source: 'cli' as const,
    raw: {},
    ...overrides,
  }
}

// ============================================================================
// formatTime Tests
// ============================================================================

describe('formatTime', () => {
  it('formats timestamp to HH:MM:SS', () => {
    // Use a fixed timestamp - 10:30:45 UTC
    const timestamp = new Date('2024-01-01T10:30:45Z').getTime()
    const result = formatTime(timestamp)

    // Note: Result depends on local timezone, so we just check format
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('handles midnight timestamp', () => {
    const timestamp = new Date('2024-01-01T00:00:00Z').getTime()
    const result = formatTime(timestamp)

    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

// ============================================================================
// getEventKind Tests
// ============================================================================

describe('getEventKind', () => {
  it('returns hook for records with hook event', () => {
    const record = createLogRecord({
      event: {
        kind: 'hook',
        hook: 'SessionStart',
        context: { sessionId: 'test', timestamp: Date.now() },
        payload: { startType: 'startup', transcriptPath: '/path' },
      } as ParsedLogRecord['event'],
    })

    expect(getEventKind(record)).toBe('hook')
  })

  it('returns transcript for records with transcript event', () => {
    const record = createLogRecord({
      event: {
        kind: 'transcript',
        eventType: 'UserPrompt',
        context: { sessionId: 'test', timestamp: Date.now() },
        payload: { lineNumber: 1, entry: {}, content: 'test' },
        metadata: { transcriptPath: '/path', metrics: {} },
      } as unknown as ParsedLogRecord['event'],
    })

    expect(getEventKind(record)).toBe('transcript')
  })

  it('returns internal for SummaryUpdated type', () => {
    const record = createLogRecord({ type: 'SummaryUpdated' })

    expect(getEventKind(record)).toBe('internal')
  })

  it('returns internal for ReminderStaged type', () => {
    const record = createLogRecord({ type: 'ReminderStaged' })

    expect(getEventKind(record)).toBe('internal')
  })

  it('returns internal for HandlerExecuted type', () => {
    const record = createLogRecord({ type: 'HandlerExecuted' })

    expect(getEventKind(record)).toBe('internal')
  })

  it('returns internal for daemon source without event', () => {
    const record = createLogRecord({ source: 'daemon' as const })

    expect(getEventKind(record)).toBe('internal')
  })

  it('returns hook for cli source without event', () => {
    const record = createLogRecord({ source: 'cli' as const })

    expect(getEventKind(record)).toBe('hook')
  })
})

// ============================================================================
// logRecordToUIEvent - Basic Conversion Tests
// ============================================================================

describe('logRecordToUIEvent - Basic Conversion', () => {
  it('converts basic log record to UIEvent', () => {
    const record = createLogRecord({
      type: 'HookReceived',
      context: { hook: 'UserPromptSubmit' },
    })

    const uiEvent = logRecordToUIEvent(record, 42)

    expect(uiEvent.id).toBe(42)
    expect(uiEvent.source).toBe('cli')
    expect(uiEvent.type).toBe('session')
  })

  it('preserves source from log record', () => {
    const record = createLogRecord({ source: 'daemon' as const })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.source).toBe('daemon')
  })

  it('extracts traceId from context', () => {
    const record = createLogRecord({
      context: { traceId: 'trace-abc123' },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.traceId).toBe('trace-abc123')
  })
})

// ============================================================================
// logRecordToUIEvent - Reminder Extraction Tests
// ============================================================================

describe('logRecordToUIEvent - Reminder Extraction', () => {
  it('extracts ReminderStaged data', () => {
    const record = createLogRecord({
      type: 'ReminderStaged',
      payload: {
        state: {
          reminderName: 'AreYouStuckReminder',
          hookName: 'UserPromptSubmit',
          blocking: true,
          priority: 10,
          persistent: false,
        },
      },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.type).toBe('reminder')
    expect(uiEvent.reminderData).toBeDefined()
    expect(uiEvent.reminderData?.action).toBe('staged')
    expect(uiEvent.reminderData?.reminderName).toBe('AreYouStuckReminder')
    expect(uiEvent.reminderData?.hookName).toBe('UserPromptSubmit')
    expect(uiEvent.reminderData?.blocking).toBe(true)
    expect(uiEvent.reminderData?.priority).toBe(10)
    expect(uiEvent.reminderData?.persistent).toBe(false)
  })

  it('extracts ReminderConsumed data', () => {
    const record = createLogRecord({
      type: 'ReminderConsumed',
      payload: {
        state: {
          reminderName: 'TaskReminder',
          reminderReturned: true,
          blocking: false,
          priority: 5,
        },
      },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.reminderData?.action).toBe('consumed')
    expect(uiEvent.reminderData?.reminderName).toBe('TaskReminder')
    expect(uiEvent.reminderData?.reminderReturned).toBe(true)
    expect(uiEvent.reminderData?.blocking).toBe(false)
    expect(uiEvent.reminderData?.priority).toBe(5)
  })

  it('extracts RemindersCleared data', () => {
    const record = createLogRecord({
      type: 'RemindersCleared',
      payload: {
        state: {
          clearedCount: 3,
          hookNames: ['UserPromptSubmit', 'Stop'],
        },
      },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.reminderData?.action).toBe('cleared')
    expect(uiEvent.reminderData?.clearedCount).toBe(3)
  })

  it('returns undefined reminderData for non-reminder events', () => {
    const record = createLogRecord({ type: 'SummaryUpdated' })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.reminderData).toBeUndefined()
  })
})

// ============================================================================
// logRecordToUIEvent - Summary Extraction Tests
// ============================================================================

describe('logRecordToUIEvent - Summary Extraction', () => {
  it('extracts SummaryUpdated data with state and metadata', () => {
    const record = createLogRecord({
      type: 'SummaryUpdated',
      payload: {
        state: {
          session_title: 'Auth Bug Fix',
          session_title_confidence: 0.95,
          latest_intent: 'fixing authentication issues',
          latest_intent_confidence: 0.87,
        },
        metadata: {
          countdown_reset_to: 5,
          pivot_detected: true,
          old_title: 'General Development',
          old_intent: 'general coding',
        },
        reason: 'user_prompt_forced',
      },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.type).toBe('state')
    expect(uiEvent.summaryData).toBeDefined()
    expect(uiEvent.summaryData?.action).toBe('updated')
    expect(uiEvent.summaryData?.reason).toBe('user_prompt_forced')
    expect(uiEvent.summaryData?.sessionTitle).toBe('Auth Bug Fix')
    expect(uiEvent.summaryData?.titleConfidence).toBe(0.95)
    expect(uiEvent.summaryData?.latestIntent).toBe('fixing authentication issues')
    expect(uiEvent.summaryData?.intentConfidence).toBe(0.87)
    expect(uiEvent.summaryData?.oldTitle).toBe('General Development')
    expect(uiEvent.summaryData?.oldIntent).toBe('general coding')
    expect(uiEvent.summaryData?.pivotDetected).toBe(true)
    expect(uiEvent.summaryData?.countdownResetTo).toBe(5)
  })

  it('handles SummaryUpdated with countdown_reached reason', () => {
    const record = createLogRecord({
      type: 'SummaryUpdated',
      payload: {
        state: { session_title: 'Test Session' },
        reason: 'countdown_reached',
      },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.summaryData?.reason).toBe('countdown_reached')
  })

  it('defaults reason to countdown_reached when not specified', () => {
    const record = createLogRecord({
      type: 'SummaryUpdated',
      payload: {
        state: { session_title: 'Test Session' },
      },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.summaryData?.reason).toBe('countdown_reached')
  })

  it('extracts SummarySkipped data', () => {
    const record = createLogRecord({ type: 'SummarySkipped' })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.summaryData?.action).toBe('skipped')
    expect(uiEvent.summaryData?.reason).toBe('countdown_active')
  })

  it('returns undefined summaryData for non-summary events', () => {
    const record = createLogRecord({ type: 'ReminderStaged' })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.summaryData).toBeUndefined()
  })
})

// ============================================================================
// logRecordToUIEvent - Decision Extraction Tests
// ============================================================================

describe('logRecordToUIEvent - Decision Extraction', () => {
  it('extracts HandlerExecuted data', () => {
    const record = createLogRecord({
      type: 'HandlerExecuted',
      payload: {
        state: {
          handlerId: 'summary-handler',
          success: true,
        },
        metadata: {
          durationMs: 150,
        },
      },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.decisionData).toBeDefined()
    expect(uiEvent.decisionData?.category).toBe('handler')
    expect(uiEvent.decisionData?.handlerId).toBe('summary-handler')
    expect(uiEvent.decisionData?.success).toBe(true)
    expect(uiEvent.decisionData?.durationMs).toBe(150)
  })

  it('extracts HandlerExecuted error data on failure', () => {
    const record = createLogRecord({
      type: 'HandlerExecuted',
      payload: {
        state: {
          handlerId: 'failing-handler',
          success: false,
        },
        metadata: {
          durationMs: 50,
          error: 'Connection timeout',
        },
      },
    })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.decisionData?.success).toBe(false)
    expect(uiEvent.decisionData?.error).toBe('Connection timeout')
  })

  it('extracts ContextPruned decision data', () => {
    const record = createLogRecord({ type: 'ContextPruned' })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.decisionData?.category).toBe('context_prune')
  })

  it('categorizes SummaryUpdated as summary decision', () => {
    const record = createLogRecord({ type: 'SummaryUpdated' })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.decisionData?.category).toBe('summary')
  })

  it('categorizes ReminderStaged as reminder decision', () => {
    const record = createLogRecord({ type: 'ReminderStaged' })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.decisionData?.category).toBe('reminder')
  })

  it('returns undefined decisionData for non-decision events', () => {
    const record = createLogRecord({ type: 'HookReceived' })

    const uiEvent = logRecordToUIEvent(record, 1)

    expect(uiEvent.decisionData).toBeUndefined()
  })
})

// ============================================================================
// logRecordsToUIEvents Tests
// ============================================================================

describe('logRecordsToUIEvents', () => {
  it('converts array of records to UIEvents with sequential IDs', () => {
    const records: ParsedLogRecord[] = [
      createLogRecord({ type: 'ReminderStaged' }),
      createLogRecord({ type: 'SummaryUpdated' }),
      createLogRecord({ type: 'HandlerExecuted' }),
    ]

    const uiEvents = logRecordsToUIEvents(records)

    expect(uiEvents).toHaveLength(3)
    expect(uiEvents[0].id).toBe(0)
    expect(uiEvents[1].id).toBe(1)
    expect(uiEvents[2].id).toBe(2)
  })

  it('handles empty array', () => {
    const uiEvents = logRecordsToUIEvents([])

    expect(uiEvents).toHaveLength(0)
  })

  it('preserves event types in conversion', () => {
    const records: ParsedLogRecord[] = [
      createLogRecord({ type: 'ReminderStaged' }),
      createLogRecord({ type: 'SummaryUpdated' }),
    ]

    const uiEvents = logRecordsToUIEvents(records)

    expect(uiEvents[0].type).toBe('reminder')
    expect(uiEvents[1].type).toBe('state')
  })
})
