/**
 * Log Parser Tests
 *
 * Tests for NDJSON parsing, session filtering, and log merging.
 *
 * @see docs/design/STRUCTURED-LOGGING.md for log format reference
 */

import { describe, it, expect, beforeEach } from 'vitest'
import {
  parseLine,
  parseNdjson,
  parseNdjsonWithErrors,
  NdjsonStreamParser,
  filterBySessionId,
  mergeLogStreams,
  mergeAndFilterBySession,
  getSessionId,
  getUniqueSessions,
  groupBySession,
  levelToName,
  isHookEvent,
  isTranscriptEvent,
} from '../log-parser'

// ============================================================================
// Test Fixtures
// ============================================================================

/** Sample CLI log entry - HookReceived */
const cliHookReceived = JSON.stringify({
  level: 30,
  time: 1678888888000,
  pid: 12345,
  hostname: 'dev-machine',
  name: 'sidekick:cli',
  msg: 'Hook received',
  type: 'HookReceived',
  source: 'cli',
  context: {
    session_id: 'sess-001',
    scope: 'project',
    correlation_id: 'corr-456',
    trace_id: 'req-789',
    hook: 'UserPromptSubmit',
  },
  payload: {
    prompt: 'Fix the auth bug',
  },
})

/** Sample CLI log entry - HookCompleted */
const cliHookCompleted = JSON.stringify({
  level: 30,
  time: 1678888889550,
  pid: 12345,
  hostname: 'dev-machine',
  name: 'sidekick:cli',
  msg: 'Hook completed',
  type: 'HookCompleted',
  source: 'cli',
  context: {
    session_id: 'sess-001',
    scope: 'project',
    correlation_id: 'corr-456',
    trace_id: 'req-789',
    hook: 'UserPromptSubmit',
  },
  payload: {
    durationMs: 1550,
    reminderReturned: true,
  },
})

/** Sample Supervisor log entry - SummaryUpdated */
const supervisorSummaryUpdated = JSON.stringify({
  level: 30,
  time: 1678888889400,
  pid: 12346,
  hostname: 'dev-machine',
  name: 'sidekick:supervisor',
  msg: 'Summary updated',
  type: 'SummaryUpdated',
  source: 'supervisor',
  context: {
    session_id: 'sess-001',
    trace_id: 'req-789',
  },
  payload: {
    state: { title: 'Auth Bug Fix', turnCount: 5 },
    reason: 'cadence_met',
  },
})

/** Sample entry with camelCase session ID */
const camelCaseSessionEntry = JSON.stringify({
  level: 30,
  time: 1678888890000,
  pid: 12345,
  hostname: 'dev-machine',
  source: 'cli',
  type: 'HookReceived',
  context: {
    sessionId: 'sess-002',
    correlationId: 'corr-789',
  },
})

/** Entry for a different session */
const differentSessionEntry = JSON.stringify({
  level: 30,
  time: 1678888891000,
  pid: 12345,
  hostname: 'dev-machine',
  source: 'cli',
  type: 'HookReceived',
  context: {
    session_id: 'sess-other',
  },
})

/** Minimal valid entry */
const minimalEntry = JSON.stringify({
  level: 30,
  time: 1678888800000,
})

/** Entry with embedded SidekickEvent */
const hookEventEntry = JSON.stringify({
  level: 30,
  time: 1678888888000,
  pid: 12345,
  hostname: 'dev-machine',
  kind: 'hook',
  hook: 'SessionStart',
  context: {
    sessionId: 'sess-003',
    timestamp: 1678888888000,
  },
  payload: {
    startType: 'startup',
    transcriptPath: '/path/to/transcript.jsonl',
  },
})

// ============================================================================
// parseLine Tests
// ============================================================================

describe('parseLine', () => {
  it('parses valid JSON with all Pino fields', () => {
    const result = parseLine(cliHookReceived)

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.pino.level).toBe(30)
    expect(result.record.pino.time).toBe(1678888888000)
    expect(result.record.pino.pid).toBe(12345)
    expect(result.record.pino.hostname).toBe('dev-machine')
    expect(result.record.pino.name).toBe('sidekick:cli')
    expect(result.record.pino.msg).toBe('Hook received')
  })

  it('extracts source field', () => {
    const result = parseLine(cliHookReceived)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.source).toBe('cli')
  })

  it('infers source from logger name when not specified', () => {
    const entry = JSON.stringify({
      level: 30,
      time: 1678888888000,
      name: 'sidekick:supervisor',
    })

    const result = parseLine(entry)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.source).toBe('supervisor')
  })

  it('extracts event type', () => {
    const result = parseLine(cliHookReceived)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.type).toBe('HookReceived')
  })

  it('extracts context with snake_case session_id', () => {
    const result = parseLine(cliHookReceived)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.context?.session_id).toBe('sess-001')
    expect(result.record.context?.scope).toBe('project')
    expect(result.record.context?.hook).toBe('UserPromptSubmit')
  })

  it('extracts context with camelCase sessionId', () => {
    const result = parseLine(camelCaseSessionEntry)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.context?.sessionId).toBe('sess-002')
  })

  it('extracts payload', () => {
    const result = parseLine(cliHookReceived)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.payload).toEqual({ prompt: 'Fix the auth bug' })
  })

  it('recognizes embedded HookEvent', () => {
    const result = parseLine(hookEventEntry)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.event).toBeDefined()
    expect(result.record.event?.kind).toBe('hook')
    if (result.record.event && isHookEvent(result.record.event)) {
      expect(result.record.event.hook).toBe('SessionStart')
    }
  })

  it('handles minimal valid entry', () => {
    const result = parseLine(minimalEntry)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.pino.level).toBe(30)
    expect(result.record.pino.time).toBe(1678888800000)
    expect(result.record.source).toBe('cli') // default
  })

  it('returns error for empty line', () => {
    const result = parseLine('')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error).toBe('Empty line')
  })

  it('returns error for whitespace-only line', () => {
    const result = parseLine('   \t  ')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error).toBe('Empty line')
  })

  it('returns error for invalid JSON', () => {
    const result = parseLine('not valid json')
    expect(result.ok).toBe(false)
    if (result.ok) return

    expect(result.error).toBe('Invalid JSON')
    expect(result.line).toBe('not valid json')
  })

  it('returns error for truncated JSON', () => {
    const result = parseLine('{"level": 30, "time"')
    expect(result.ok).toBe(false)
  })

  it('preserves raw JSON in record', () => {
    const result = parseLine(cliHookReceived)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(result.record.raw.type).toBe('HookReceived')
  })
})

// ============================================================================
// parseNdjson Tests
// ============================================================================

describe('parseNdjson', () => {
  it('parses multiple valid lines', () => {
    const content = [cliHookReceived, supervisorSummaryUpdated, cliHookCompleted].join('\n')

    const records = parseNdjson(content)

    expect(records).toHaveLength(3)
    expect(records[0].type).toBe('HookReceived')
    expect(records[1].type).toBe('SummaryUpdated')
    expect(records[2].type).toBe('HookCompleted')
  })

  it('skips empty lines', () => {
    const content = [cliHookReceived, '', '  ', cliHookCompleted].join('\n')

    const records = parseNdjson(content)

    expect(records).toHaveLength(2)
  })

  it('skips malformed lines', () => {
    const content = [cliHookReceived, 'invalid json', cliHookCompleted].join('\n')

    const records = parseNdjson(content)

    expect(records).toHaveLength(2)
  })

  it('handles empty content', () => {
    const records = parseNdjson('')

    expect(records).toHaveLength(0)
  })

  it('handles trailing newline', () => {
    const content = cliHookReceived + '\n'

    const records = parseNdjson(content)

    expect(records).toHaveLength(1)
  })
})

// ============================================================================
// parseNdjsonWithErrors Tests
// ============================================================================

describe('parseNdjsonWithErrors', () => {
  it('returns both records and errors', () => {
    const content = [cliHookReceived, 'invalid json', cliHookCompleted].join('\n')

    const { records, errors } = parseNdjsonWithErrors(content)

    expect(records).toHaveLength(2)
    expect(errors).toHaveLength(1)
    expect(errors[0].line).toBe(2)
    expect(errors[0].error).toBe('Invalid JSON')
    expect(errors[0].content).toBe('invalid json')
  })

  it('does not report empty lines as errors', () => {
    const content = [cliHookReceived, '', cliHookCompleted].join('\n')

    const { records, errors } = parseNdjsonWithErrors(content)

    expect(records).toHaveLength(2)
    expect(errors).toHaveLength(0)
  })
})

// ============================================================================
// NdjsonStreamParser Tests
// ============================================================================

describe('NdjsonStreamParser', () => {
  let parser: NdjsonStreamParser

  beforeEach(() => {
    parser = new NdjsonStreamParser()
  })

  it('parses complete lines', () => {
    const records = parser.push(cliHookReceived + '\n')

    expect(records).toHaveLength(1)
    expect(records[0].type).toBe('HookReceived')
  })

  it('buffers partial lines across chunks', () => {
    const json = cliHookReceived
    const mid = Math.floor(json.length / 2)

    // Push first half - should return nothing
    let records = parser.push(json.slice(0, mid))
    expect(records).toHaveLength(0)

    // Push second half with newline - should return record
    records = parser.push(json.slice(mid) + '\n')
    expect(records).toHaveLength(1)
    expect(records[0].type).toBe('HookReceived')
  })

  it('handles multiple lines in one chunk', () => {
    const content = [cliHookReceived, cliHookCompleted].join('\n') + '\n'

    const records = parser.push(content)

    expect(records).toHaveLength(2)
  })

  it('flush returns buffered incomplete line', () => {
    parser.push(cliHookReceived) // No trailing newline

    expect(parser.getRecords()).toHaveLength(0)

    const flushed = parser.flush()

    expect(flushed).not.toBeNull()
    expect(flushed?.type).toBe('HookReceived')
  })

  it('flush returns null for empty buffer', () => {
    parser.push(cliHookReceived + '\n')

    const flushed = parser.flush()

    expect(flushed).toBeNull()
  })

  it('getRecords returns all parsed records', () => {
    parser.push(cliHookReceived + '\n')
    parser.push(cliHookCompleted + '\n')

    const records = parser.getRecords()

    expect(records).toHaveLength(2)
  })

  it('reset clears state', () => {
    parser.push(cliHookReceived + '\n')
    parser.push('partial')

    parser.reset()

    expect(parser.getRecords()).toHaveLength(0)
    expect(parser.flush()).toBeNull()
  })
})

// ============================================================================
// getSessionId Tests
// ============================================================================

describe('getSessionId', () => {
  it('extracts snake_case session_id from context', () => {
    const result = parseLine(cliHookReceived)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getSessionId(result.record)).toBe('sess-001')
  })

  it('extracts camelCase sessionId from context', () => {
    const result = parseLine(camelCaseSessionEntry)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getSessionId(result.record)).toBe('sess-002')
  })

  it('extracts sessionId from embedded event', () => {
    const result = parseLine(hookEventEntry)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getSessionId(result.record)).toBe('sess-003')
  })

  it('returns undefined when no session ID', () => {
    const result = parseLine(minimalEntry)
    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getSessionId(result.record)).toBeUndefined()
  })
})

// ============================================================================
// filterBySessionId Tests
// ============================================================================

describe('filterBySessionId', () => {
  it('filters records by session ID', () => {
    const content = [cliHookReceived, differentSessionEntry, cliHookCompleted].join('\n')
    const records = parseNdjson(content)

    const filtered = filterBySessionId(records, 'sess-001')

    expect(filtered).toHaveLength(2)
    expect(filtered.every((r) => getSessionId(r) === 'sess-001')).toBe(true)
  })

  it('returns empty array when no matches', () => {
    const records = parseNdjson(cliHookReceived)

    const filtered = filterBySessionId(records, 'nonexistent')

    expect(filtered).toHaveLength(0)
  })

  it('handles empty input', () => {
    const filtered = filterBySessionId([], 'sess-001')

    expect(filtered).toHaveLength(0)
  })
})

// ============================================================================
// mergeLogStreams Tests
// ============================================================================

describe('mergeLogStreams', () => {
  it('merges and sorts by timestamp', () => {
    // CLI: 1678888888000, 1678888889550
    // Supervisor: 1678888889400
    // Expected order: CLI(888000), Sup(889400), CLI(889550)
    const cliRecords = parseNdjson([cliHookReceived, cliHookCompleted].join('\n'))
    const supervisorRecords = parseNdjson(supervisorSummaryUpdated)

    const merged = mergeLogStreams(cliRecords, supervisorRecords)

    expect(merged).toHaveLength(3)
    expect(merged[0].pino.time).toBe(1678888888000)
    expect(merged[1].pino.time).toBe(1678888889400)
    expect(merged[2].pino.time).toBe(1678888889550)
  })

  it('preserves source information', () => {
    const cliRecords = parseNdjson(cliHookReceived)
    const supervisorRecords = parseNdjson(supervisorSummaryUpdated)

    const merged = mergeLogStreams(cliRecords, supervisorRecords)

    expect(merged[0].source).toBe('cli')
    expect(merged[1].source).toBe('supervisor')
  })

  it('handles empty CLI log', () => {
    const supervisorRecords = parseNdjson(supervisorSummaryUpdated)

    const merged = mergeLogStreams([], supervisorRecords)

    expect(merged).toHaveLength(1)
  })

  it('handles empty supervisor log', () => {
    const cliRecords = parseNdjson(cliHookReceived)

    const merged = mergeLogStreams(cliRecords, [])

    expect(merged).toHaveLength(1)
  })

  it('handles both logs empty', () => {
    const merged = mergeLogStreams([], [])

    expect(merged).toHaveLength(0)
  })
})

// ============================================================================
// mergeAndFilterBySession Tests
// ============================================================================

describe('mergeAndFilterBySession', () => {
  it('merges, filters, and sorts', () => {
    const cliRecords = parseNdjson([cliHookReceived, differentSessionEntry].join('\n'))
    const supervisorRecords = parseNdjson(supervisorSummaryUpdated)

    const result = mergeAndFilterBySession(cliRecords, supervisorRecords, 'sess-001')

    expect(result).toHaveLength(2)
    expect(result[0].type).toBe('HookReceived')
    expect(result[1].type).toBe('SummaryUpdated')
    expect(result.every((r) => getSessionId(r) === 'sess-001')).toBe(true)
  })
})

// ============================================================================
// Utility Function Tests
// ============================================================================

describe('levelToName', () => {
  it('converts known levels', () => {
    expect(levelToName(10)).toBe('trace')
    expect(levelToName(20)).toBe('debug')
    expect(levelToName(30)).toBe('info')
    expect(levelToName(40)).toBe('warn')
    expect(levelToName(50)).toBe('error')
    expect(levelToName(60)).toBe('fatal')
  })

  it('returns unknown for other levels', () => {
    expect(levelToName(0)).toBe('unknown')
    expect(levelToName(25)).toBe('unknown')
    expect(levelToName(100)).toBe('unknown')
  })
})

describe('getUniqueSessions', () => {
  it('extracts unique session IDs', () => {
    const content = [cliHookReceived, cliHookCompleted, differentSessionEntry, camelCaseSessionEntry].join('\n')
    const records = parseNdjson(content)

    const sessions = getUniqueSessions(records)

    expect(sessions).toHaveLength(3)
    expect(sessions).toContain('sess-001')
    expect(sessions).toContain('sess-other')
    expect(sessions).toContain('sess-002')
  })

  it('handles records without session ID', () => {
    const records = parseNdjson(minimalEntry)

    const sessions = getUniqueSessions(records)

    expect(sessions).toHaveLength(0)
  })
})

describe('groupBySession', () => {
  it('groups records by session ID', () => {
    const content = [cliHookReceived, cliHookCompleted, differentSessionEntry].join('\n')
    const records = parseNdjson(content)

    const groups = groupBySession(records)

    expect(groups.size).toBe(2)
    expect(groups.get('sess-001')).toHaveLength(2)
    expect(groups.get('sess-other')).toHaveLength(1)
  })

  it('puts records without session in __no_session__', () => {
    const records = parseNdjson(minimalEntry)

    const groups = groupBySession(records)

    expect(groups.get('__no_session__')).toHaveLength(1)
  })
})

// ============================================================================
// Type Guard Re-export Tests
// ============================================================================

describe('type guards', () => {
  it('isHookEvent identifies hook events', () => {
    const hookEvent = {
      kind: 'hook' as const,
      hook: 'SessionStart' as const,
      context: { sessionId: 'test', timestamp: Date.now() },
      payload: { startType: 'startup' as const, transcriptPath: '/path' },
    }

    expect(isHookEvent(hookEvent)).toBe(true)
  })

  it('isTranscriptEvent identifies transcript events', () => {
    const transcriptEvent = {
      kind: 'transcript' as const,
      eventType: 'UserPrompt' as const,
      context: { sessionId: 'test', timestamp: Date.now() },
      payload: { lineNumber: 1, entry: {} },
      metadata: {
        transcriptPath: '/path',
        metrics: { turnCount: 1, toolCount: 0, toolsThisTurn: 0, totalTokens: 100 },
      },
    }

    expect(isTranscriptEvent(transcriptEvent)).toBe(true)
  })
})
