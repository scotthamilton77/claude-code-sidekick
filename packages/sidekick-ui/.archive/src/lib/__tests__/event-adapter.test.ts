/**
 * Event Adapter Tests
 *
 * Tests for ParsedLogRecord to UIEvent conversion including
 * structured payload extraction for reminder, summary, and decision events.
 *
 * @see src/types/index.ts for type definitions
 */

import { describe, it, expect } from 'vitest'
import {
  logRecordToUIEvent,
  logRecordsToUIEvents,
  formatTime,
  getEventKind,
  sidekickEventToUIEvent,
  sidekickEventsToUIEvents,
} from '../event-adapter'
import type { ParsedLogRecord } from '../log-parser'
import type { HookEvent, TranscriptEvent } from '@sidekick/types'

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

// ============================================================================
// sidekickEventsToUIEvents Tests
// ============================================================================

describe('sidekickEventsToUIEvents', () => {
  it('converts array of SidekickEvents to UIEvents with sequential IDs', () => {
    const events: HookEvent[] = [
      {
        kind: 'hook',
        hook: 'SessionStart',
        context: { sessionId: 'sess-1', timestamp: 1678888888000 },
        payload: { startType: 'startup', transcriptPath: '/path' },
      },
      {
        kind: 'hook',
        hook: 'UserPromptSubmit',
        context: { sessionId: 'sess-1', timestamp: 1678888889000 },
        payload: { prompt: 'test prompt', transcriptPath: '/path', cwd: '/cwd', permissionMode: 'default' },
      },
    ]

    const uiEvents = sidekickEventsToUIEvents(events)

    expect(uiEvents).toHaveLength(2)
    expect(uiEvents[0].id).toBe(0)
    expect(uiEvents[1].id).toBe(1)
    expect(uiEvents[0].label).toBe('Session Start')
    expect(uiEvents[1].label).toBe('User message')
  })

  it('handles empty array', () => {
    const uiEvents = sidekickEventsToUIEvents([])

    expect(uiEvents).toHaveLength(0)
  })

  it('applies source override to all events', () => {
    const events: HookEvent[] = [
      {
        kind: 'hook',
        hook: 'SessionStart',
        context: { sessionId: 'sess-1', timestamp: 1678888888000 },
        payload: { startType: 'startup', transcriptPath: '/path' },
      },
    ]

    const uiEvents = sidekickEventsToUIEvents(events, 'daemon')

    expect(uiEvents[0].source).toBe('daemon')
  })

  it('converts transcript events', () => {
    const events: TranscriptEvent[] = [
      {
        kind: 'transcript',
        eventType: 'UserPrompt',
        context: { sessionId: 'sess-1', timestamp: 1678888888000 },
        payload: { lineNumber: 1, entry: {}, content: 'test' },
        metadata: { transcriptPath: '/path', metrics: {} } as TranscriptEvent['metadata'],
      },
    ]

    const uiEvents = sidekickEventsToUIEvents(events)

    expect(uiEvents).toHaveLength(1)
    expect(uiEvents[0].type).toBe('user')
    expect(uiEvents[0].label).toBe('User message')
  })
})

// ============================================================================
// sidekickEventToUIEvent Tests
// ============================================================================

describe('sidekickEventToUIEvent', () => {
  it('converts hook event with source override', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'SessionStart',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { startType: 'startup', transcriptPath: '/path' },
    }

    const uiEvent = sidekickEventToUIEvent(event, 5, 'daemon')

    expect(uiEvent.id).toBe(5)
    expect(uiEvent.source).toBe('daemon')
    expect(uiEvent.rawEvent).toBe(event)
  })

  it('uses cli as default source for hook events', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'SessionStart',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { startType: 'startup', transcriptPath: '/path' },
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.source).toBe('cli')
  })

  it('uses daemon as default source for transcript events', () => {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'UserPrompt',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { lineNumber: 1, entry: {}, content: 'test' },
      metadata: { transcriptPath: '/path', metrics: {} } as TranscriptEvent['metadata'],
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.source).toBe('daemon')
  })

  it('extracts content from UserPromptSubmit payload', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'UserPromptSubmit',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { prompt: 'Hello world', transcriptPath: '/path', cwd: '/cwd', permissionMode: 'default' },
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.content).toBe('Hello world')
  })

  it('extracts content from transcript event', () => {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'AssistantMessage',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { lineNumber: 1, entry: {}, content: 'Response content' },
      metadata: { transcriptPath: '/path', metrics: {} } as TranscriptEvent['metadata'],
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.content).toBe('Response content')
    expect(uiEvent.type).toBe('assistant')
  })

  it('handles SessionEnd hook', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'SessionEnd',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { endReason: 'logout' },
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('session')
    expect(uiEvent.label).toBe('Session End')
    expect(uiEvent.content).toBe('Session ended (logout)')
  })

  it('handles PreToolUse hook with toolInput', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'PreToolUse',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { toolName: 'Read', toolInput: { file_path: '/test.ts', limit: 100 } },
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('tool')
    expect(uiEvent.label).toBe('Tool: Read')
    expect(uiEvent.content).toBe('Input: file_path, limit')
  })

  it('handles PreToolUse hook with empty toolInput', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'PreToolUse',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { toolName: 'Read', toolInput: {} },
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.content).toBeUndefined()
  })

  it('handles PreToolUse hook without toolInput keys', () => {
    // Test when toolInput exists but is empty - simulates runtime data with no input params
    const event = {
      kind: 'hook',
      hook: 'PreToolUse',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { toolName: 'Read', toolInput: {} },
    } as HookEvent

    const uiEvent = sidekickEventToUIEvent(event, 0)

    // Empty toolInput produces no content
    expect(uiEvent.content).toBeUndefined()
  })

  it('handles PostToolUse hook', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'PostToolUse',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { toolName: 'Write', toolInput: { file_path: '/out.ts' }, toolResult: { success: true } },
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('tool')
    expect(uiEvent.label).toBe('Tool completed: Write')
    expect(uiEvent.content).toBe('Input: file_path')
  })

  it('handles Stop hook', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'Stop',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { transcriptPath: '/path', permissionMode: 'default', stopHookActive: true },
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('reminder')
    expect(uiEvent.label).toBe('Stop hook')
  })

  it('handles PreCompact hook', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'PreCompact',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { transcriptPath: '/path', transcriptSnapshotPath: '/snapshot' },
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('decision')
    expect(uiEvent.label).toBe('Pre-compact')
  })

  it('handles ToolCall transcript event with toolName', () => {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'ToolCall',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { lineNumber: 1, entry: {}, toolName: 'Bash' },
      metadata: { transcriptPath: '/path', metrics: {} } as TranscriptEvent['metadata'],
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('tool')
    expect(uiEvent.label).toBe('Tool: Bash')
  })

  it('handles ToolCall transcript event without toolName', () => {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'ToolCall',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { lineNumber: 1, entry: {} },
      metadata: { transcriptPath: '/path', metrics: {} } as TranscriptEvent['metadata'],
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.label).toBe('Tool call')
  })

  it('handles ToolResult transcript event with toolName', () => {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'ToolResult',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { lineNumber: 1, entry: {}, toolName: 'Read' },
      metadata: { transcriptPath: '/path', metrics: {} } as TranscriptEvent['metadata'],
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('tool')
    expect(uiEvent.label).toBe('Result: Read')
  })

  it('handles ToolResult transcript event without toolName', () => {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'ToolResult',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { lineNumber: 1, entry: {} },
      metadata: { transcriptPath: '/path', metrics: {} } as TranscriptEvent['metadata'],
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.label).toBe('Tool result')
  })

  it('handles Compact transcript event', () => {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'Compact',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { lineNumber: 1, entry: {} },
      metadata: { transcriptPath: '/path', metrics: {} } as TranscriptEvent['metadata'],
    }

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('decision')
    expect(uiEvent.label).toBe('Compact')
  })

  it('handles unknown transcript eventType', () => {
    const event = {
      kind: 'transcript',
      eventType: 'UnknownType',
      context: { sessionId: 'sess-1', timestamp: 1678888888000 },
      payload: { lineNumber: 1, entry: {} },
      metadata: { transcriptPath: '/path', metrics: {} },
    } as unknown as TranscriptEvent

    const uiEvent = sidekickEventToUIEvent(event, 0)

    expect(uiEvent.type).toBe('state')
    expect(uiEvent.label).toBe('UnknownType')
  })
})

// ============================================================================
// logRecordToUIEvent - Content Extraction Tests
// ============================================================================

describe('logRecordToUIEvent - Content Extraction', () => {
  it('extracts content from pino.msg', () => {
    const record = createLogRecord({
      type: undefined,
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
        msg: 'Log message content',
        name: 'sidekick:test',
      },
    })

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.content).toBe('Log message content')
  })

  it('summarizes payload keys when no msg', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
      },
      source: 'daemon',
      type: undefined,
      payload: {
        foo: 'bar',
        baz: 123,
        qux: true,
      },
      raw: {},
    }

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.content).toBe('foo, baz, qux')
  })

  it('truncates payload keys with ellipsis when more than 3', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
      },
      source: 'daemon',
      type: undefined,
      payload: {
        key1: 'a',
        key2: 'b',
        key3: 'c',
        key4: 'd',
        key5: 'e',
      },
      raw: {},
    }

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.content).toBe('key1, key2, key3...')
  })

  it('returns undefined content for empty payload', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
      },
      source: 'daemon',
      type: undefined,
      payload: {},
      raw: {},
    }

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.content).toBeUndefined()
  })

  it('returns undefined content when no msg and no payload', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
      },
      source: 'daemon',
      type: undefined,
      raw: {},
    }

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.content).toBeUndefined()
  })
})

// ============================================================================
// logRecordToUIEvent - Label Generation Tests
// ============================================================================

describe('logRecordToUIEvent - Label Generation', () => {
  it('generates label for HookCompleted', () => {
    const record = createLogRecord({ type: 'HookCompleted' })

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.label).toBe('Hook Completed')
    expect(uiEvent.type).toBe('session')
  })

  it('generates label for HookReceived with hook name in context', () => {
    const record = createLogRecord({
      type: 'HookReceived',
      context: { hook: 'PreToolUse' },
    })

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.label).toBe('Hook: PreToolUse')
  })

  it('generates label for HookReceived without hook name', () => {
    const record = createLogRecord({
      type: 'HookReceived',
      context: {},
    })

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.label).toBe('Hook: unknown')
  })

  it('falls back to pino.msg for unknown type', () => {
    const record = createLogRecord({
      type: 'UnknownInternalType',
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
        msg: 'Custom log message',
        name: 'sidekick:test',
      },
    })

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.label).toBe('Custom log message')
  })

  it('falls back to type for unknown type without msg', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
      },
      source: 'daemon',
      type: 'CustomEventType',
      raw: {},
    }

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.label).toBe('CustomEventType')
  })

  it('falls back to Event for no type and no msg', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
      },
      source: 'daemon',
      raw: {},
    }

    const uiEvent = logRecordToUIEvent(record, 0)

    expect(uiEvent.label).toBe('Event')
  })
})

// ============================================================================
// getEventKind - Additional Tests
// ============================================================================

describe('getEventKind - Additional Cases', () => {
  it('returns internal for ReminderConsumed type', () => {
    const record = createLogRecord({ type: 'ReminderConsumed' })

    expect(getEventKind(record)).toBe('internal')
  })

  it('returns internal for RemindersCleared type', () => {
    const record = createLogRecord({ type: 'RemindersCleared' })

    expect(getEventKind(record)).toBe('internal')
  })

  it('returns internal for ContextPruned type', () => {
    const record = createLogRecord({ type: 'ContextPruned' })

    expect(getEventKind(record)).toBe('internal')
  })
})
