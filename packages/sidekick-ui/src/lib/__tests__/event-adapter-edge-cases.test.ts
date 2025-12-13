/**
 * Event Adapter Edge Case Tests
 *
 * Tests robustness guardrails for event adapter:
 * - Missing timestamps
 * - Invalid timestamps (undefined, null, NaN, Infinity)
 * - Missing event context
 */

import { describe, it, expect } from 'vitest'
import { formatTime, sidekickEventToUIEvent, logRecordToUIEvent } from '../event-adapter'
import type { HookEvent, TranscriptEvent } from '@sidekick/types'
import type { ParsedLogRecord } from '../log-parser'

// ============================================================================
// formatTime Edge Cases
// ============================================================================

describe('formatTime Edge Cases', () => {
  it('handles undefined timestamp', () => {
    const result = formatTime(undefined)
    expect(result).toBe('--:--:--')
  })

  it('handles null timestamp', () => {
    const result = formatTime(null)
    expect(result).toBe('--:--:--')
  })

  it('handles NaN timestamp', () => {
    const result = formatTime(NaN)
    expect(result).toBe('--:--:--')
  })

  it('handles Infinity timestamp', () => {
    const result = formatTime(Infinity)
    expect(result).toBe('--:--:--')
  })

  it('handles negative Infinity timestamp', () => {
    const result = formatTime(-Infinity)
    expect(result).toBe('--:--:--')
  })

  it('handles invalid date (out of range)', () => {
    // Dates beyond ~275,000 CE are invalid
    const result = formatTime(Number.MAX_SAFE_INTEGER)
    expect(result).toBe('--:--:--')
  })

  it('formats valid timestamp correctly', () => {
    const timestamp = new Date('2024-01-15T12:34:56Z').getTime()
    const result = formatTime(timestamp)
    // Should be formatted as HH:MM:SS
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('handles 0 timestamp (epoch)', () => {
    const result = formatTime(0)
    expect(result).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })
})

// ============================================================================
// sidekickEventToUIEvent Edge Cases
// ============================================================================

describe('sidekickEventToUIEvent Edge Cases', () => {
  it('handles missing timestamp in hook event', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'SessionStart',
      context: {
        sessionId: 'sess-123',
        // timestamp is missing!
      } as HookEvent['context'], // Type assertion to simulate runtime data
      payload: {
        startType: 'startup',
        transcriptPath: '/path/to/transcript.jsonl',
      },
    }

    const result = sidekickEventToUIEvent(event, 0)

    // Should not crash, use fallback time
    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(result.label).toBe('Session Start')
  })

  it('handles missing context entirely', () => {
    const event = {
      kind: 'hook',
      hook: 'SessionStart',
      // context is missing!
      payload: {
        startType: 'startup',
        transcriptPath: '/path/to/transcript.jsonl',
      },
    } as unknown as HookEvent // Force type to simulate bad data

    const result = sidekickEventToUIEvent(event, 0)

    // Should not crash, use fallback time
    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('handles undefined timestamp in transcript event', () => {
    const event: TranscriptEvent = {
      kind: 'transcript',
      eventType: 'UserPrompt',
      context: {
        sessionId: 'sess-123',
        // timestamp missing
      } as TranscriptEvent['context'],
      payload: {
        lineNumber: 1,
        entry: {
          type: 'input',
          input: 'Test prompt',
        },
      },
      metadata: {
        transcriptPath: '/path/to/transcript.jsonl',
        metrics: {
          turnCount: 1,
          toolsThisTurn: 0,
          toolCount: 0,
          messageCount: 1,
          tokenUsage: {
            inputTokens: 10,
            outputTokens: 0,
            totalTokens: 10,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            cacheTiers: {
              ephemeral5mInputTokens: 0,
              ephemeral1hInputTokens: 0,
            },
            serviceTierCounts: {},
            byModel: {},
          },
          toolsPerTurn: 0,
          lastProcessedLine: 1,
          lastUpdatedAt: Date.now(),
        },
      },
    }

    const result = sidekickEventToUIEvent(event, 0)

    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(result.label).toBe('User message')
  })

  it('handles null timestamp by using fallback', () => {
    const event: HookEvent = {
      kind: 'hook',
      hook: 'SessionStart',
      context: {
        sessionId: 'sess-123',
        timestamp: null as unknown as number, // Simulate bad runtime data
      },
      payload: {
        startType: 'startup',
        transcriptPath: '/path/to/transcript.jsonl',
      },
    }

    const result = sidekickEventToUIEvent(event, 0)

    // Should use Date.now() as fallback, which formats correctly
    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(result.time).not.toBe('--:--:--')
  })
})

// ============================================================================
// logRecordToUIEvent Edge Cases
// ============================================================================

describe('logRecordToUIEvent Edge Cases', () => {
  it('handles missing pino.time', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: undefined as unknown as number, // Simulate missing timestamp
        pid: 12345,
        hostname: 'test',
      },
      source: 'cli',
      type: 'HookReceived',
      raw: {},
    }

    const result = logRecordToUIEvent(record, 0)

    // Should use fallback time
    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(result.label).toContain('Hook')
  })

  it('handles null pino.time by using fallback', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: null as unknown as number,
        pid: 12345,
        hostname: 'test',
      },
      source: 'supervisor',
      type: 'SummaryUpdated',
      raw: {},
    }

    const result = logRecordToUIEvent(record, 0)

    // Should use Date.now() as fallback, which formats correctly
    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    expect(result.time).not.toBe('--:--:--')
    expect(result.label).toBe('Summary Updated')
  })

  it('handles missing pino object entirely', () => {
    const record = {
      source: 'cli',
      type: 'HookReceived',
      raw: {},
    } as unknown as ParsedLogRecord

    const result = logRecordToUIEvent(record, 0)

    // Should use fallback time
    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('handles embedded event with missing timestamp', () => {
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: 1678888888000,
        pid: 12345,
        hostname: 'test',
      },
      source: 'cli',
      event: {
        kind: 'hook',
        hook: 'SessionStart',
        context: {
          sessionId: 'sess-123',
          // timestamp missing
        } as HookEvent['context'],
        payload: {
          startType: 'startup',
          transcriptPath: '/path',
        },
      } as HookEvent,
      raw: {},
    }

    const result = logRecordToUIEvent(record, 0)

    // Should delegate to sidekickEventToUIEvent which uses fallback
    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
  })

  it('handles valid pino.time', () => {
    const timestamp = new Date('2024-01-15T12:34:56Z').getTime()
    const record: ParsedLogRecord = {
      pino: {
        level: 30,
        time: timestamp,
        pid: 12345,
        hostname: 'test',
      },
      source: 'cli',
      type: 'HookReceived',
      raw: {},
    }

    const result = logRecordToUIEvent(record, 0)

    expect(result.time).toMatch(/^\d{2}:\d{2}:\d{2}$/)
    // Should format the actual timestamp, not use fallback
    const expected = formatTime(timestamp)
    expect(result.time).toBe(expected)
  })
})
