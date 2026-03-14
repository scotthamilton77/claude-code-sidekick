import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SidekickEventType } from '../../src/types.js'

// Mock node:fs/promises
const mockReadFile = vi.fn()

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
}))

// Mock node:crypto
const mockRandomUUID = vi.fn()

vi.mock('node:crypto', () => ({
  randomUUID: () => mockRandomUUID(),
}))

beforeEach(() => {
  mockReadFile.mockClear()
  mockRandomUUID.mockClear()
  // Default: sequential UUIDs
  let uuidCounter = 0
  mockRandomUUID.mockImplementation(() => `uuid-${++uuidCounter}`)
})

/** Helper: create a valid NDJSON log line */
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
    payload: { reminderName: 'vc-build', reason: 'tool_threshold' },
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
      payload: { reminderName: 'vc-build', reason: 'tool_threshold' },
    })
    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('cli.log')) return Promise.resolve(line)
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
      transcriptLineId: '',
    })
  })

  it('filters events by sessionId', async () => {
    const lines = [
      makeLogLine({ time: 1000, context: { sessionId: 'session-1' } }),
      makeLogLine({ time: 2000, context: { sessionId: 'session-2' } }),
      makeLogLine({ time: 3000, context: { sessionId: 'session-1' } }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('cli.log')) return Promise.resolve(lines)
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
      makeLogLine({ time: 3000, type: 'hook:invoked' }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('cli.log')) return Promise.resolve(lines)
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
      makeLogLine({ time: 2000, type: 'decision:recorded', payload: { category: 'testing', reasoning: 'tests passed' } }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('cli.log')) return Promise.resolve(lines)
      return Promise.resolve('')
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(2)
  })

  it('skips lines without a type field', async () => {
    const lines = [
      JSON.stringify({ level: 30, time: 1000, context: { sessionId: 'session-1' }, payload: {} }),
      makeLogLine({ time: 2000, type: 'reminder:staged' }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('cli.log')) return Promise.resolve(lines)
      return Promise.resolve('')
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('reminder:staged')
  })

  it('merges events from both cli.log and sidekickd.log sorted by time', async () => {
    const cliLines = [
      makeLogLine({ time: 3000, type: 'reminder:staged' }),
      makeLogLine({ time: 1000, type: 'decision:recorded', payload: { category: 'testing', reasoning: 'passes' } }),
    ].join('\n')

    const daemonLines = [
      makeLogLine({ time: 2000, type: 'session-summary:start', payload: {} }),
      makeLogLine({ time: 4000, type: 'session-summary:finish', payload: {} }),
    ].join('\n')

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('cli.log')) return Promise.resolve(cliLines)
      if (path.includes('sidekickd.log')) return Promise.resolve(daemonLines)
      return Promise.reject(new Error('ENOENT'))
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(4)
    expect(events.map((e) => e.timestamp)).toEqual([1000, 2000, 3000, 4000])
  })

  it('returns empty array when log files do not exist', async () => {
    mockReadFile.mockRejectedValue(new Error('ENOENT'))

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toEqual([])
  })

  it('returns empty array when log files are empty', async () => {
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

  it('generates label for decision:recorded', () => {
    const result = generateLabel('decision:recorded', { category: 'testing', reasoning: 'tests already passed' })
    expect(result).toEqual({ label: 'Decision: testing', detail: 'tests already passed' })
  })

  it('generates label for session-title:changed', () => {
    const result = generateLabel('session-title:changed', { newTitle: 'Fix auth bug', confidence: 0.85 })
    expect(result).toEqual({ label: 'Title → "Fix auth bug"', detail: 'confidence: 0.85' })
  })

  it('generates label for intent:changed', () => {
    const result = generateLabel('intent:changed', { newIntent: 'refactoring', confidence: 0.72 })
    expect(result).toEqual({ label: 'Intent → "refactoring"', detail: 'confidence: 0.72' })
  })

  it('generates label for persona:selected', () => {
    const result = generateLabel('persona:selected', { personaId: 'yoda' })
    expect(result).toEqual({ label: 'Persona: yoda' })
  })

  it('generates label for persona:changed', () => {
    const result = generateLabel('persona:changed', { from: 'jarvis', to: 'yoda' })
    expect(result).toEqual({ label: 'Persona: jarvis → yoda' })
  })

  it('generates label for error:occurred', () => {
    const longStack = 'a'.repeat(200)
    const result = generateLabel('error:occurred', { message: 'ENOENT: no such file', stack: longStack })
    expect(result).toEqual({ label: 'Error: ENOENT: no such file', detail: 'a'.repeat(120) })
  })

  it('generates label for snarky-message:finish', () => {
    const longMessage = 'b'.repeat(100)
    const result = generateLabel('snarky-message:finish', { message: longMessage })
    expect(result).toEqual({ label: 'Snarky Message', detail: 'b'.repeat(80) })
  })

  it('generates label for session-summary:start', () => {
    const result = generateLabel('session-summary:start', {})
    expect(result).toEqual({ label: 'Summary Started' })
  })

  it('generates label for session-summary:finish', () => {
    const result = generateLabel('session-summary:finish', {})
    expect(result).toEqual({ label: 'Summary Complete' })
  })

  it('generates label for resume-message:start', () => {
    const result = generateLabel('resume-message:start', {})
    expect(result).toEqual({ label: 'Resume Started' })
  })

  it('generates label for resume-message:finish', () => {
    const longMessage = 'c'.repeat(100)
    const result = generateLabel('resume-message:finish', { message: longMessage })
    expect(result).toEqual({ label: 'Resume Complete', detail: 'c'.repeat(80) })
  })

  it('generates label for statusline:rendered', () => {
    const result = generateLabel('statusline:rendered', { content: 'building...' })
    expect(result).toEqual({ label: 'Statusline', detail: 'building...' })
  })

  it('generates label for snarky-message:start', () => {
    const result = generateLabel('snarky-message:start', {})
    expect(result).toEqual({ label: 'Snarky Message…' })
  })

  it('falls back to "unknown" for missing payload fields', () => {
    const result = generateLabel('reminder:staged', {})
    expect(result).toEqual({ label: 'Staged: unknown' })
  })

  it('falls back to humanized type for unknown event types', () => {
    const result = generateLabel('some-unknown:type' as SidekickEventType, {})
    expect(result).toEqual({ label: 'Some Unknown Type' })
  })

  it('truncates long detail strings for error stacks (120 chars)', () => {
    const stack = 'x'.repeat(200)
    const result = generateLabel('error:occurred', { message: 'err', stack })
    expect(result.detail).toHaveLength(120)
  })

  it('truncates long detail strings for messages (80 chars)', () => {
    const message = 'y'.repeat(200)
    const result = generateLabel('snarky-message:finish', { message })
    expect(result.detail).toHaveLength(80)
  })
})
