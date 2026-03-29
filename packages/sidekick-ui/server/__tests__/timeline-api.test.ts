import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { TimelineSidekickEventType } from '../timeline-api.js'

// Mock node:fs/promises
const mockReadFile = vi.fn()
const mockReaddir = vi.fn()

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}))

// Mock node:crypto
const mockRandomUUID = vi.fn()

vi.mock('node:crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}))

beforeEach(() => {
  mockReadFile.mockClear()
  mockReaddir.mockClear()
  mockRandomUUID.mockClear()
  // Default: sequential UUIDs
  let uuidCounter = 0
  mockRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`)
  // Default: return standard log file names (pino-roll rotation pattern)
  mockReaddir.mockResolvedValue(['sidekick.1.log', 'sidekickd.1.log'])
})

/** Helper: create a valid NDJSON log line (Pino flattens payload fields to root) */
function makeLogLine(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    level: 30,
    time: 1773498166559,
    pid: 352,
    hostname: 'test-host',
    name: 'sidekick:cli',
    context: { sessionId: 'session-1' },
    type: 'reminder:staged',
    source: 'cli',
    reminderName: 'vc-build',
    reason: 'tool_threshold',
    ...overrides,
  })
}

// Import after mocks
import { parseTimelineEvents, generateLabel } from '../timeline-api.js'

describe('parseTimelineEvents', () => {
  it('parses valid NDJSON lines into correct SidekickEvent[]', async () => {
    const line = makeLogLine({
      time: 1000,
      type: 'reminder:staged',
      reminderName: 'vc-build',
      reason: 'tool_threshold',
    })
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sidekick.1.log')) return Promise.resolve(line)
      return Promise.resolve('') // sidekickd.log empty
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(1)
    expect(events[0]).toEqual({
      id: 'uuid-1',
      timestamp: 1000,
      type: 'reminder:staged',
      label: 'Staged: vc-build',
      detail: 'reason: tool_threshold',
      transcriptLineId: 'sidekick-1000-reminder:staged',
    })
  })

  it('filters events by sessionId', async () => {
    const lines = [
      makeLogLine({ time: 1000, context: { sessionId: 'session-1' } }),
      makeLogLine({ time: 2000, context: { sessionId: 'session-2' } }),
      makeLogLine({ time: 3000, context: { sessionId: 'session-1' } }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sidekick.1.log')) return Promise.resolve(lines)
      return Promise.resolve('')
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(2)
    expect(events.every((e) => e.timestamp !== 2000)).toBe(true)
  })

  it('excludes log-only event types (e.g., daemon:started)', async () => {
    const lines = [
      makeLogLine({ time: 1000, type: 'reminder:staged' }),
      makeLogLine({ time: 2000, type: 'daemon:started' }),
      makeLogLine({ time: 3000, type: 'ipc:started' }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sidekick.1.log')) return Promise.resolve(lines)
      return Promise.resolve('')
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('reminder:staged')
  })

  it('skips malformed JSON lines without crashing', async () => {
    const lines = [
      'not valid json',
      makeLogLine({ time: 1000, type: 'reminder:staged' }),
      '{broken',
      makeLogLine({ time: 2000, type: 'decision:recorded', decision: 'skip-tests', reason: 'tests passed' }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sidekick.1.log')) return Promise.resolve(lines)
      return Promise.resolve('')
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(2)
  })

  it('skips lines without a type field', async () => {
    const lines = [
      JSON.stringify({ level: 30, time: 1000, context: { sessionId: 'session-1' } }),
      makeLogLine({ time: 2000, type: 'reminder:staged' }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sidekick.1.log')) return Promise.resolve(lines)
      return Promise.resolve('')
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('reminder:staged')
  })

  it('merges events from both cli.log and sidekickd.log sorted by time', async () => {
    const cliLines = [
      makeLogLine({ time: 3000, type: 'reminder:staged' }),
      makeLogLine({ time: 1000, type: 'decision:recorded', decision: 'skip-tests', reason: 'passes' }),
    ].join('\n')

    const daemonLines = [
      makeLogLine({ time: 2000, type: 'session-summary:start' }),
      makeLogLine({ time: 4000, type: 'session-summary:finish' }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sidekick.1.log')) return Promise.resolve(cliLines)
      if (path.includes('sidekickd.1.log')) return Promise.resolve(daemonLines)
      return Promise.reject(new Error('ENOENT'))
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(4)
    expect(events.map((e) => e.timestamp)).toEqual([1000, 2000, 3000, 4000])
  })

  it('includes reminder:cleared events', async () => {
    const line = makeLogLine({
      time: 1000,
      type: 'reminder:cleared',
      reminderType: 'vc-build',
    })
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sidekick.1.log')) return Promise.resolve(line)
      return Promise.resolve('')
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('reminder:cleared')
    expect(events[0].label).toBe('Cleared: vc-build')
  })

  it('returns empty array when log directory does not exist', async () => {
    mockReaddir.mockRejectedValue(new Error('ENOENT'))

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toEqual([])
  })

  it('returns empty array when log files are empty', async () => {
    mockReaddir.mockResolvedValue(['sidekick.1.log', 'sidekickd.1.log'])
    mockReadFile.mockResolvedValue('')

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toEqual([])
  })
})

describe('generateLabel', () => {
  it('generates label for reminder:staged', () => {
    const result = generateLabel('reminder:staged', { reminderName: 'vc-build', reason: 'tool_threshold' })
    expect(result).toEqual({ label: 'Staged: vc-build', detail: 'reason: tool_threshold' })
  })

  it('generates label for reminder:unstaged', () => {
    const result = generateLabel('reminder:unstaged', { reminderName: 'vc-build', triggeredBy: 'tool_result' })
    expect(result).toEqual({ label: 'Unstaged: vc-build', detail: 'triggeredBy: tool_result' })
  })

  it('generates label for reminder:consumed', () => {
    const result = generateLabel('reminder:consumed', { reminderName: 'verify-completion' })
    expect(result).toEqual({ label: 'Consumed: verify-completion' })
  })

  it('generates label for reminder:cleared', () => {
    const result = generateLabel('reminder:cleared', { reminderType: 'vc-build' })
    expect(result).toEqual({ label: 'Cleared: vc-build' })
  })

  it('generates label for reminder:cleared with no reminderType', () => {
    const result = generateLabel('reminder:cleared', {})
    expect(result).toEqual({ label: 'Cleared: all' })
  })

  it('generates label for decision:recorded', () => {
    const result = generateLabel('decision:recorded', { decision: 'skip-tests', reason: 'tests already passed' })
    expect(result).toEqual({ label: 'Decision: skip-tests', detail: 'tests already passed' })
  })

  it('generates label for decision:recorded preferring title over decision', () => {
    const result = generateLabel('decision:recorded', { title: 'Skip session analysis', decision: 'skipped', reason: 'no user turns' })
    expect(result).toEqual({ label: 'Decision: Skip session analysis', detail: 'no user turns' })
  })

  it('generates label for session-title:changed', () => {
    const result = generateLabel('session-title:changed', { newValue: 'Fix auth bug', confidence: 0.85 })
    expect(result).toEqual({ label: 'Title → "Fix auth bug"', detail: 'confidence: 0.85' })
  })

  it('generates label for intent:changed', () => {
    const result = generateLabel('intent:changed', { newValue: 'refactoring', confidence: 0.72 })
    expect(result).toEqual({ label: 'Intent → "refactoring"', detail: 'confidence: 0.72' })
  })

  it('generates label for persona:selected', () => {
    const result = generateLabel('persona:selected', { personaId: 'yoda' })
    expect(result).toEqual({ label: 'Persona chosen: yoda' })
  })

  it('generates label for persona:changed', () => {
    const result = generateLabel('persona:changed', { personaFrom: 'jarvis', personaTo: 'yoda' })
    expect(result).toEqual({ label: 'Persona: jarvis → yoda' })
  })

  it('generates label for error:occurred', () => {
    const longStack = 'a'.repeat(200)
    const result = generateLabel('error:occurred', { errorMessage: 'ENOENT: no such file', errorStack: longStack })
    expect(result).toEqual({ label: 'Error: ENOENT: no such file', detail: 'a'.repeat(120) })
  })

  it('generates label for snarky-message:finish', () => {
    const longMessage = 'b'.repeat(100)
    const result = generateLabel('snarky-message:finish', { generatedMessage: longMessage })
    expect(result).toEqual({ label: `Snarky Message Finish: ${'b'.repeat(60)}` })
  })

  it('generates label for session-summary:start', () => {
    const result = generateLabel('session-summary:start', {})
    expect(result).toEqual({ label: 'Session Analysis Start' })
  })

  it('generates label for session-summary:finish', () => {
    const result = generateLabel('session-summary:finish', {})
    expect(result).toEqual({ label: 'Session Analysis Finish' })
  })

  it('generates label for session-summary:finish with session_title', () => {
    const result = generateLabel('session-summary:finish', { session_title: 'Fix auth bug' })
    expect(result).toEqual({ label: 'Session Analysis Finish: "Fix auth bug"' })
  })

  it('generates label for resume-message:start', () => {
    const result = generateLabel('resume-message:start', {})
    expect(result).toEqual({ label: 'Resume Message Start' })
  })

  it('generates label for resume-message:finish', () => {
    const longMessage = 'c'.repeat(100)
    const result = generateLabel('resume-message:finish', { snarky_comment: longMessage })
    expect(result).toEqual({ label: `Resume Message Finish: ${'c'.repeat(60)}` })
  })

  it('generates label for statusline:rendered', () => {
    const result = generateLabel('statusline:rendered', { displayMode: 'session_summary', staleData: false, tokens: 3200, durationMs: 145 })
    expect(result).toEqual({ label: 'Statusline called', detail: 'session summary · 3200 chat tokens · 145ms' })
  })

  it('generates label for hook:received', () => {
    const result = generateLabel('hook:received', { hook: 'UserPromptSubmit' })
    expect(result).toEqual({ label: 'Hook start: UserPromptSubmit' })
  })

  it('generates label for hook:completed', () => {
    const result = generateLabel('hook:completed', { hook: 'UserPromptSubmit', durationMs: 42 })
    expect(result).toEqual({ label: 'Hook finish: UserPromptSubmit', detail: '42ms' })
  })

  it('generates label for snarky-message:start', () => {
    const result = generateLabel('snarky-message:start', {})
    expect(result).toEqual({ label: 'Snarky Message Start' })
  })

  it('falls back to "unknown" for missing payload fields', () => {
    const result = generateLabel('reminder:staged', {})
    expect(result).toEqual({ label: 'Staged: unknown' })
  })

  it('falls back to humanized type for unknown event types', () => {
    const result = generateLabel('some-unknown:type' as TimelineSidekickEventType, {})
    expect(result).toEqual({ label: 'Some Unknown Type' })
  })

  it('truncates long detail strings for error stacks (120 chars)', () => {
    const errorStack = 'x'.repeat(200)
    const result = generateLabel('error:occurred', { errorMessage: 'err', errorStack })
    expect(result.detail).toHaveLength(120)
  })

  it('truncates long result strings in label for messages (60 chars)', () => {
    const generatedMessage = 'y'.repeat(200)
    const result = generateLabel('snarky-message:finish', { generatedMessage })
    expect(result.label).toBe(`Snarky Message Finish: ${'y'.repeat(60)}`)
  })

  it('truncates long session titles in label (60 chars)', () => {
    const longTitle = 't'.repeat(200)
    const result = generateLabel('session-summary:finish', { session_title: longTitle })
    expect(result.label).toBe(`Session Analysis Finish: "${'t'.repeat(60)}"`)
  })

  it('falls back to operation name for snarky-message:finish with empty payload', () => {
    const result = generateLabel('snarky-message:finish', {})
    expect(result).toEqual({ label: 'Snarky Message Finish' })
  })

  it('falls back to operation name for resume-message:finish with empty payload', () => {
    const result = generateLabel('resume-message:finish', {})
    expect(result).toEqual({ label: 'Resume Message Finish' })
  })
})
