import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock node:os
vi.mock('node:os', () => ({
  homedir: () => '/home/testuser',
}))

// Mock node:fs/promises
const mockReadFile = vi.fn()
const mockAccess = vi.fn()
const mockStat = vi.fn()
const mockReaddir = vi.fn()

vi.mock('node:fs/promises', () => ({
  readFile: (...args: unknown[]) => mockReadFile(...args),
  access: (...args: unknown[]) => mockAccess(...args),
  stat: (...args: unknown[]) => mockStat(...args),
  readdir: (...args: unknown[]) => mockReaddir(...args),
}))

beforeEach(() => {
  mockReadFile.mockClear()
  mockAccess.mockClear()
  mockStat.mockClear()
  mockReaddir.mockClear()
})

// --- Test helpers ---

const DEFAULT_TIMESTAMP = '2025-01-15T10:30:00.000Z'
const DEFAULT_UUID = 'abc-123'
const DEFAULT_SESSION_ID = 'session-1'

function makeUserEntry(content: string | unknown[], overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    uuid: DEFAULT_UUID,
    type: 'user',
    timestamp: DEFAULT_TIMESTAMP,
    sessionId: DEFAULT_SESSION_ID,
    message: {
      role: 'user',
      content,
    },
    ...overrides,
  })
}

function makeAssistantEntry(content: unknown[], overrides: Record<string, unknown> = {}): string {
  const { message: messageOverrides, ...rest } = overrides
  const msgOverrides = (messageOverrides as Record<string, unknown>) || {}
  return JSON.stringify({
    uuid: DEFAULT_UUID,
    type: 'assistant',
    timestamp: DEFAULT_TIMESTAMP,
    sessionId: DEFAULT_SESSION_ID,
    ...rest,
    message: {
      role: 'assistant',
      content,
      model: 'claude-sonnet-4-20250514',
      ...msgOverrides,
    },
  })
}

function makeSystemEntry(subtype: string, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    uuid: DEFAULT_UUID,
    type: 'system',
    timestamp: DEFAULT_TIMESTAMP,
    sessionId: DEFAULT_SESSION_ID,
    subtype,
    ...overrides,
  })
}

function makePrLinkEntry(overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({
    uuid: DEFAULT_UUID,
    type: 'pr-link',
    timestamp: DEFAULT_TIMESTAMP,
    sessionId: DEFAULT_SESSION_ID,
    prUrl: 'https://github.com/org/repo/pull/42',
    prNumber: 42,
    ...overrides,
  })
}

// Mock timeline-api dependencies for interleaving tests
const mockFindLogFiles = vi.fn()
const mockReadLogFile = vi.fn()

vi.mock('../timeline-api.js', async () => {
  const actual = await vi.importActual<typeof import('../timeline-api.js')>('../timeline-api.js')
  return {
    ...actual,
    findLogFiles: (...args: unknown[]) => mockFindLogFiles(...args),
    readLogFile: (...args: unknown[]) => mockReadLogFile(...args),
  }
})

beforeEach(() => {
  mockFindLogFiles.mockClear()
  mockReadLogFile.mockClear()
  // Default: no log files found
  mockFindLogFiles.mockResolvedValue([])
})

// Import after mocks
import { resolveTranscriptPath, parseTranscriptLines, parseSubagentTranscript, listSubagents } from '../transcript-api.js'

const CLAUDE_PROJECT_BASE = '/home/testuser/.claude/projects/myproject'

describe('resolveTranscriptPath', () => {
  it('returns dir-layout path when exists', async () => {
    // Directory layout: {sessionId}/{sessionId}.jsonl exists
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('session-1/session-1.jsonl')) {
        return Promise.resolve({ isFile: () => true })
      }
      return Promise.reject(new Error('ENOENT'))
    })

    const result = await resolveTranscriptPath('myproject', 'session-1')
    expect(result).toBe(`${CLAUDE_PROJECT_BASE}/session-1/session-1.jsonl`)
  })

  it('falls back to bare file', async () => {
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('session-1.jsonl') && !p.includes('session-1/session-1')) {
        return Promise.resolve({ isFile: () => true })
      }
      return Promise.reject(new Error('ENOENT'))
    })

    const result = await resolveTranscriptPath('myproject', 'session-1')
    expect(result).toBe(`${CLAUDE_PROJECT_BASE}/session-1.jsonl`)
  })

  it('returns null when neither exists', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))

    const result = await resolveTranscriptPath('myproject', 'session-1')
    expect(result).toBeNull()
  })

  it('constructs correct paths from projectId and homedir', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))

    await resolveTranscriptPath('-Users-foo', 'session-1')

    // Verify stat was called with the correct ~/.claude/projects/ path
    const statCalls = mockStat.mock.calls.map((c: unknown[]) => c[0])
    expect(statCalls[0]).toBe('/home/testuser/.claude/projects/-Users-foo/session-1/session-1.jsonl')
    expect(statCalls[1]).toBe('/home/testuser/.claude/projects/-Users-foo/session-1.jsonl')
  })
})

describe('parseTranscriptLines', () => {
  // Helper to set up mockStat + mockReadFile for a single JSONL string
  function setupTranscript(jsonlContent: string) {
    // resolveTranscriptPath finds the bare file
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('session-1.jsonl') && !p.includes('session-1/session-1')) {
        return Promise.resolve({ isFile: () => true })
      }
      return Promise.reject(new Error('ENOENT'))
    })
    mockReadFile.mockResolvedValue(jsonlContent)
  }

  it('parses user text message (string content) -> user-message', async () => {
    setupTranscript(makeUserEntry('Hello, world!'))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('user-message')
    expect(lines[0].content).toBe('Hello, world!')
  })

  it('parses user text message (array with text block) -> user-message', async () => {
    setupTranscript(makeUserEntry([{ type: 'text', text: 'Array text content' }]))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('user-message')
    expect(lines[0].content).toBe('Array text content')
  })

  it('parses user tool_result block -> tool-result with toolOutput, toolSuccess', async () => {
    setupTranscript(
      makeUserEntry([
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'Tool output text',
        },
      ])
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('tool-result')
    expect(lines[0].toolOutput).toBe('Tool output text')
    expect(lines[0].toolSuccess).toBe(true)
  })

  it('parses user tool_result with is_error=true -> toolSuccess=false', async () => {
    setupTranscript(
      makeUserEntry([
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 'Error occurred',
          is_error: true,
        },
      ])
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('tool-result')
    expect(lines[0].toolOutput).toBe('Error occurred')
    expect(lines[0].toolSuccess).toBe(false)
  })

  it('parses assistant text block -> assistant-message with content', async () => {
    setupTranscript(makeAssistantEntry([{ type: 'text', text: 'Hello from assistant' }]))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('assistant-message')
    expect(lines[0].content).toBe('Hello from assistant')
  })

  it('parses assistant thinking block -> assistant-message with thinking field', async () => {
    setupTranscript(makeAssistantEntry([{ type: 'thinking', thinking: 'Let me think about this...' }]))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('assistant-message')
    expect(lines[0].thinking).toBe('Let me think about this...')
  })

  it('parses assistant tool_use block -> tool-use with toolName, toolInput', async () => {
    setupTranscript(
      makeAssistantEntry([
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Read',
          input: { file_path: '/foo/bar.ts' },
        },
      ])
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('tool-use')
    expect(lines[0].toolName).toBe('Read')
    expect(lines[0].toolInput).toEqual({ file_path: '/foo/bar.ts' })
  })

  it('handles mixed content (text + tool_use in one assistant entry)', async () => {
    setupTranscript(
      makeAssistantEntry([
        { type: 'text', text: 'Let me read that file.' },
        {
          type: 'tool_use',
          id: 'tool-1',
          name: 'Read',
          input: { file_path: '/foo.ts' },
        },
      ])
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(2)
    expect(lines[0].type).toBe('assistant-message')
    expect(lines[0].content).toBe('Let me read that file.')
    expect(lines[0].id).toBe('transcript-0-0')
    expect(lines[1].type).toBe('tool-use')
    expect(lines[1].toolName).toBe('Read')
    expect(lines[1].id).toBe('transcript-0-1')
  })

  it('parses system/compact_boundary -> compaction with compactionTokensBefore', async () => {
    setupTranscript(
      makeSystemEntry('compact_boundary', {
        compactMetadata: { preTokens: 85000, postTokens: 42000 },
      })
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('compaction')
    expect(lines[0].compactionTokensBefore).toBe(85000)
    expect(lines[0].compactionTokensAfter).toBe(42000)
  })

  it('parses system/turn_duration -> turn-duration with durationMs', async () => {
    setupTranscript(makeSystemEntry('turn_duration', { durationMs: 12500 }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('turn-duration')
    expect(lines[0].durationMs).toBe(12500)
  })

  it('parses system/api_error -> api-error with retryAttempt, maxRetries', async () => {
    setupTranscript(
      makeSystemEntry('api_error', {
        retryAttempt: 2,
        maxRetries: 5,
        error: 'rate_limit_exceeded',
      })
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('api-error')
    expect(lines[0].retryAttempt).toBe(2)
    expect(lines[0].maxRetries).toBe(5)
    expect(lines[0].errorMessage).toBe('rate_limit_exceeded')
  })

  it('parses pr-link -> pr-link with prUrl, prNumber', async () => {
    setupTranscript(makePrLinkEntry())

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('pr-link')
    expect(lines[0].prUrl).toBe('https://github.com/org/repo/pull/42')
    expect(lines[0].prNumber).toBe(42)
  })

  it('skips queue-operation entries', async () => {
    const content = [
      makeUserEntry('Hello'),
      JSON.stringify({ type: 'queue-operation', timestamp: DEFAULT_TIMESTAMP }),
      makeUserEntry('World'),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.type === 'user-message')).toBe(true)
  })

  it('skips file-history-snapshot entries', async () => {
    const content = [
      makeUserEntry('Hello'),
      JSON.stringify({ type: 'file-history-snapshot', timestamp: DEFAULT_TIMESTAMP }),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
  })

  it('skips progress entries', async () => {
    const content = [
      makeUserEntry('Hello'),
      JSON.stringify({ type: 'progress', subtype: 'tokens', timestamp: DEFAULT_TIMESTAMP }),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
  })

  it('skips system/stop_hook_summary', async () => {
    const content = [makeUserEntry('Hello'), makeSystemEntry('stop_hook_summary')].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
  })

  it('skips system/local_command', async () => {
    const content = [makeUserEntry('Hello'), makeSystemEntry('local_command')].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
  })

  it('skips malformed JSON lines', async () => {
    const content = ['not valid json', makeUserEntry('Hello'), '{broken'].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].content).toBe('Hello')
  })

  it('returns empty array when file does not exist', async () => {
    mockStat.mockRejectedValue(new Error('ENOENT'))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toEqual([])
  })

  it('returns empty array when file is empty', async () => {
    setupTranscript('')

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toEqual([])
  })

  it('preserves isSidechain flag', async () => {
    setupTranscript(makeAssistantEntry([{ type: 'text', text: 'Sidechain response' }], { isSidechain: true }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].isSidechain).toBe(true)
  })

  it('preserves model from assistant entries', async () => {
    setupTranscript(
      makeAssistantEntry([{ type: 'text', text: 'Hello' }], {
        message: { role: 'assistant', content: [{ type: 'text', text: 'Hello' }], model: 'claude-opus-4-20250514' },
      })
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].model).toBe('claude-opus-4-20250514')
  })

  it('generates deterministic IDs (transcript-{line}-{block})', async () => {
    const content = [
      makeUserEntry('Hello'),
      makeAssistantEntry([
        { type: 'text', text: 'Thinking...' },
        { type: 'tool_use', id: 'tool-1', name: 'Read', input: {} },
      ]),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].id).toBe('transcript-0-0')
    expect(lines[1].id).toBe('transcript-1-0')
    expect(lines[2].id).toBe('transcript-1-1')
  })

  it('returns lines in file order', async () => {
    const content = [
      makeUserEntry('First', { timestamp: '2025-01-15T10:30:00.000Z' }),
      makeAssistantEntry([{ type: 'text', text: 'Second' }], { timestamp: '2025-01-15T10:30:01.000Z' }),
      makeUserEntry('Third', { timestamp: '2025-01-15T10:30:02.000Z' }),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(3)
    expect(lines[0].content).toBe('First')
    expect(lines[1].content).toBe('Second')
    expect(lines[2].content).toBe('Third')
    // Timestamps ascending
    expect(lines[0].timestamp).toBeLessThan(lines[1].timestamp)
    expect(lines[1].timestamp).toBeLessThan(lines[2].timestamp)
  })

  it('skips last-prompt entries', async () => {
    const content = [
      makeUserEntry('Hello'),
      JSON.stringify({ type: 'last-prompt', timestamp: DEFAULT_TIMESTAMP, prompt: 'some prompt' }),
      makeUserEntry('World'),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(2)
    expect(lines.every((l) => l.type === 'user-message')).toBe(true)
  })

  it('preserves isMeta flag on entries', async () => {
    setupTranscript(makeAssistantEntry([{ type: 'text', text: 'Meta response' }], { isMeta: true }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].isMeta).toBe(true)
  })

  it('preserves isCompactSummary flag on entries', async () => {
    setupTranscript(
      makeAssistantEntry([{ type: 'text', text: 'Summary of compacted context' }], { isCompactSummary: true })
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].isCompactSummary).toBe(true)
  })

  // User message subtype classification
  it('classifies plain user message as prompt subtype', async () => {
    setupTranscript(makeUserEntry('Hello, world!'))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('prompt')
  })

  it('classifies isMeta user message as system-injection', async () => {
    setupTranscript(makeUserEntry('Some meta content', { isMeta: true }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('system-injection')
  })

  it('classifies isMeta message with command-name as command', async () => {
    setupTranscript(makeUserEntry('<command-name>/commit</command-name>\ncommit content', { isMeta: true }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('command')
  })

  it('classifies message with system-reminder as system-injection', async () => {
    setupTranscript(makeUserEntry('Some text\n<system-reminder>reminder content</system-reminder>'))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('system-injection')
  })

  it('classifies non-meta message with command-name as command', async () => {
    setupTranscript(makeUserEntry('<command-name>/clear</command-name>'))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('command')
  })

  it('classifies isMeta message with skill marker as skill-content', async () => {
    setupTranscript(
      makeUserEntry(
        'Base directory for this skill: /Users/scott/.claude/skills/brainstorming\n\n# Brainstorming\n\nSome skill content here.',
        { isMeta: true }
      )
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('skill-content')
  })

  it('classifies isMeta command-name as command even with skill marker', async () => {
    setupTranscript(
      makeUserEntry('<command-name>/brainstorm</command-name>\nBase directory for this skill: /path/to/skill', {
        isMeta: true,
      })
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('command')
  })

  it('classifies non-meta message with skill marker as prompt', async () => {
    setupTranscript(makeUserEntry('Base directory for this skill: /path/to/skill'))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('prompt')
  })

  // toolUseId capture
  it('captures toolUseId from tool_use blocks', async () => {
    setupTranscript(
      makeAssistantEntry([{ type: 'tool_use', id: 'toolu_abc123', name: 'Read', input: { file_path: '/foo.ts' } }])
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('tool-use')
    expect(lines[0].toolUseId).toBe('toolu_abc123')
  })

  it('captures toolUseId from tool_result blocks', async () => {
    setupTranscript(makeUserEntry([{ type: 'tool_result', tool_use_id: 'toolu_abc123', content: 'file contents' }]))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('tool-result')
    expect(lines[0].toolUseId).toBe('toolu_abc123')
  })

  it('pairs tool_use and tool_result by matching toolUseId', async () => {
    const content = [
      makeAssistantEntry([{ type: 'tool_use', id: 'toolu_xyz', name: 'Bash', input: { command: 'ls' } }]),
      makeUserEntry([{ type: 'tool_result', tool_use_id: 'toolu_xyz', content: 'output' }]),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(2)
    expect(lines[0].toolUseId).toBe('toolu_xyz')
    expect(lines[1].toolUseId).toBe('toolu_xyz')
  })

  it('classifies array text blocks with correct subtypes', async () => {
    setupTranscript(makeUserEntry([{ type: 'text', text: 'Hello, world!' }]))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines[0].userSubtype).toBe('prompt')
  })

  it('preserves full tool result content without truncation', async () => {
    const longOutput = 'x'.repeat(2000)
    setupTranscript(makeUserEntry([{ type: 'tool_result', tool_use_id: 'tool-1', content: longOutput }]))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].toolOutput).toBe(longOutput)
  })

  // Event interleaving tests
  it('interleaves Sidekick events when projectDir is provided', async () => {
    // Set up Claude Code transcript with entries at t=1000 and t=3000
    setupTranscript(
      [
        makeUserEntry('Hello', { timestamp: '2025-01-15T10:00:01.000Z' }),
        makeAssistantEntry([{ type: 'text', text: 'Hi' }], { timestamp: '2025-01-15T10:00:03.000Z' }),
      ].join('\n')
    )

    // Set up Sidekick events at t=2000 (between the two Claude Code entries)
    // findLogFiles is called twice (cli + daemon prefix), return file only for cli
    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:00:02.000Z').getTime(),
        type: 'reminder:staged',
        context: { sessionId: 'session-1' },
        payload: { reminderName: 'vc-build', reason: 'tool_threshold' },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    expect(lines).toHaveLength(3)
    // Should be sorted by timestamp: user(1s) → sidekick(2s) → assistant(3s)
    expect(lines[0].type).toBe('user-message')
    expect(lines[1].type).toBe('reminder:staged')
    expect(lines[1].reminderId).toBe('vc-build')
    expect(lines[2].type).toBe('assistant-message')
  })

  it('maps decision:recorded with title to decisionTitle', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'decision:recorded',
        context: { sessionId: 'session-1' },
        payload: {
          title: 'Skip session analysis',
          decision: 'skipped',
          reason: 'no user turns',
          subsystem: 'session-summary',
        },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const decisionLine = lines.find((l) => l.type === 'decision:recorded')
    expect(decisionLine).toBeDefined()
    expect(decisionLine!.decisionTitle).toBe('Skip session analysis')
    expect(decisionLine!.decisionCategory).toBe('skipped')
    expect(decisionLine!.decisionReasoning).toBe('no user turns')
    expect(decisionLine!.decisionSubsystem).toBe('session-summary')
  })

  it('maps decision:recorded with legacy detail field to decisionSubsystem', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'decision:recorded',
        context: { sessionId: 'session-1' },
        payload: {
          title: 'Skip session analysis',
          decision: 'skipped',
          reason: 'no user turns',
          detail: 'session-summary analysis',
        },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const decisionLine = lines.find((l) => l.type === 'decision:recorded')
    expect(decisionLine!.decisionSubsystem).toBe('session-summary analysis')
  })

  it('maps decision:recorded without title to decisionCategory only', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'decision:recorded',
        context: { sessionId: 'session-1' },
        payload: { decision: 'skip-tests', reason: 'tests already passed' },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const decisionLine = lines.find((l) => l.type === 'decision:recorded')
    expect(decisionLine).toBeDefined()
    expect(decisionLine!.decisionTitle).toBeUndefined()
    expect(decisionLine!.decisionCategory).toBe('skip-tests')
    expect(decisionLine!.decisionReasoning).toBe('tests already passed')
  })

  it('maps hook:received with input to hookInput', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'hook:received',
        context: { sessionId: 'session-1', hook: 'UserPromptSubmit' },
        payload: {
          hook: 'UserPromptSubmit',
          cwd: '/project',
          mode: 'hook',
          input: { prompt: 'fix the bug', cwd: '/project' },
        },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const hookLine = lines.find((l) => l.type === 'hook:received')
    expect(hookLine).toBeDefined()
    expect(hookLine!.hookName).toBe('UserPromptSubmit')
    expect(hookLine!.hookInput).toEqual({ prompt: 'fix the bug', cwd: '/project' })
    expect(hookLine!.hookReturnValue).toBeUndefined()
  })

  it('maps hook:completed with returnValue to hookReturnValue', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'hook:completed',
        context: { sessionId: 'session-1', hook: 'UserPromptSubmit' },
        payload: {
          hook: 'UserPromptSubmit',
          durationMs: 42,
          returnValue: { additionalContext: 'remember X' },
        },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const hookLine = lines.find((l) => l.type === 'hook:completed')
    expect(hookLine).toBeDefined()
    expect(hookLine!.hookDurationMs).toBe(42)
    expect(hookLine!.hookReturnValue).toEqual({ additionalContext: 'remember X' })
    expect(hookLine!.hookInput).toBeUndefined()
  })

  it('maps hook:completed without returnValue to undefined hookReturnValue', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'hook:completed',
        context: { sessionId: 'session-1', hook: 'Stop' },
        payload: { hook: 'Stop', durationMs: 5 },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const hookLine = lines.find((l) => l.type === 'hook:completed')
    expect(hookLine).toBeDefined()
    expect(hookLine!.hookReturnValue).toBeUndefined()
  })

  it('maps reminder:staged with reminderText to reminderText field', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'reminder:staged',
        context: { sessionId: 'session-1' },
        payload: {
          reminderName: 'vc-build',
          hookName: 'PostToolUse',
          blocking: true,
          priority: 80,
          persistent: true,
          reason: 'tool_threshold',
          reminderText: 'You MUST run `pnpm build` before claiming work is complete.',
        },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const reminderLine = lines.find((l) => l.type === 'reminder:staged')
    expect(reminderLine).toBeDefined()
    expect(reminderLine!.reminderId).toBe('vc-build')
    expect(reminderLine!.reminderBlocking).toBe(true)
    expect(reminderLine!.reminderText).toBe('You MUST run `pnpm build` before claiming work is complete.')
  })

  it('maps reminder:staged without reminderText to undefined reminderText', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'reminder:staged',
        context: { sessionId: 'session-1' },
        payload: {
          reminderName: 'vc-build',
          hookName: 'PostToolUse',
          blocking: true,
          priority: 80,
          persistent: true,
          reason: 'tool_threshold',
        },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const reminderLine = lines.find((l) => l.type === 'reminder:staged')
    expect(reminderLine).toBeDefined()
    expect(reminderLine!.reminderText).toBeUndefined()
  })

  it('maps statusline:rendered with renderedText to statuslineContent', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'statusline:rendered',
        context: { sessionId: 'session-1' },
        payload: {
          displayMode: 'session_summary',
          staleData: false,
          tokens: 3200,
          durationMs: 145,
          renderedText: '[sidekick] Fix auth bug | 3.2k tokens | $0.02',
          hookInput: { session_id: 'session-1', model: 'Claude Opus', cwd: '/project' },
        },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const statusLine = lines.find((l) => l.type === 'statusline:rendered')
    expect(statusLine).toBeDefined()
    // Prefers renderedText over legacy mode summary
    expect(statusLine!.statuslineContent).toBe('[sidekick] Fix auth bug | 3.2k tokens | $0.02')
    // Hook input summary is captured
    expect(statusLine!.hookInput).toEqual({ session_id: 'session-1', model: 'Claude Opus', cwd: '/project' })
  })

  it('maps statusline:rendered without renderedText uses legacy mode summary', async () => {
    setupTranscript(makeUserEntry('Hello'))

    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'statusline:rendered',
        context: { sessionId: 'session-1' },
        payload: {
          displayMode: 'session_summary',
          staleData: false,
          tokens: 3200,
          durationMs: 145,
        },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const statusLine = lines.find((l) => l.type === 'statusline:rendered')
    expect(statusLine).toBeDefined()
    expect(statusLine!.statuslineContent).toBe('session summary · 3200 chat tokens · 145ms')
    expect(statusLine!.hookInput).toBeUndefined()
  })

  it('returns only Claude Code lines when no projectDir', async () => {
    setupTranscript(makeUserEntry('Hello'))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('user-message')
    // Should not have called findLogFiles
    expect(mockFindLogFiles).not.toHaveBeenCalled()
  })

  it('returns empty array when readFile throws after resolveTranscriptPath succeeds', async () => {
    // stat succeeds (path found), but readFile throws
    mockStat.mockImplementation((p: string) => {
      if (p.endsWith('session-1.jsonl') && !p.includes('session-1/session-1')) {
        return Promise.resolve({ isFile: () => true })
      }
      return Promise.reject(new Error('ENOENT'))
    })
    mockReadFile.mockRejectedValue(new Error('EACCES: permission denied'))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toEqual([])
  })

  it('attaches agentId to the preceding tool-use line when agent_progress is encountered', async () => {
    const content = [
      makeAssistantEntry([
        { type: 'tool_use', id: 'toolu_abc', name: 'Agent', input: {} },
      ]),
      JSON.stringify({
        type: 'agent_progress',
        timestamp: DEFAULT_TIMESTAMP,
        data: { agentId: 'agent-007' },
      }),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    const toolUseLine = lines.find((l) => l.type === 'tool-use')
    expect(toolUseLine).toBeDefined()
    expect(toolUseLine!.agentId).toBe('agent-007')
  })

  it('skips agent_progress without agentId (no-op, no lines emitted)', async () => {
    const content = [
      makeAssistantEntry([{ type: 'tool_use', id: 'toolu_abc', name: 'Agent', input: {} }]),
      JSON.stringify({
        type: 'agent_progress',
        timestamp: DEFAULT_TIMESTAMP,
        data: {},
      }),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    // agent_progress emits no new lines — only the tool-use from the assistant entry
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('tool-use')
    expect(lines[0].agentId).toBeUndefined()
  })

  it('agent_progress skips backwards past non-tool-use lines to find the tool-use', async () => {
    const content = [
      makeAssistantEntry([
        { type: 'tool_use', id: 'toolu_first', name: 'Agent', input: {} },
        { type: 'text', text: 'Some text after tool use' },
      ]),
      JSON.stringify({
        type: 'agent_progress',
        timestamp: DEFAULT_TIMESTAMP,
        data: { agentId: 'agent-z' },
      }),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    const toolUseLine = lines.find((l) => l.type === 'tool-use')
    expect(toolUseLine!.agentId).toBe('agent-z')
  })

  it('agent_progress with no data field is a no-op', async () => {
    const content = [
      makeUserEntry('hi'),
      makeAssistantEntry([{ type: 'tool_use', id: 'tool-1', name: 'Bash', input: {} }]),
      JSON.stringify({ type: 'agent_progress', timestamp: DEFAULT_TIMESTAMP }),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    const toolUse = lines.find((l) => l.type === 'tool-use')
    expect(toolUse?.agentId).toBeUndefined()
  })

  it('clamps out-of-order timestamps to preserve file order', async () => {
    // Second entry has a LOWER timestamp than the first — clamping should raise it
    const t2s = '2025-01-15T10:00:02.000Z'
    const t1s = '2025-01-15T10:00:01.000Z'

    const content = [
      makeUserEntry('First', { timestamp: t2s }),
      makeAssistantEntry([{ type: 'text', text: 'Second' }], { timestamp: t1s }),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(2)
    // After clamping, the second line's timestamp should equal the first (the higher value)
    expect(lines[1].timestamp).toBe(lines[0].timestamp)
    expect(lines[1].timestamp).toBe(new Date(t2s).getTime())
  })

  it('extracts tool_result content from array of text blocks', async () => {
    // Covers the Array.isArray branch in extractToolResultContent
    setupTranscript(
      makeUserEntry([
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: [
            { type: 'text', text: 'First line' },
            { type: 'text', text: 'Second line' },
          ],
        },
      ])
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].toolOutput).toBe('First line\nSecond line')
  })

  it('extracts tool_result content falling back to String() for non-string/non-array', async () => {
    // Covers the String(content ?? '') fallback in extractToolResultContent
    setupTranscript(
      makeUserEntry([
        {
          type: 'tool_result',
          tool_use_id: 'tool-1',
          content: 42,
        },
      ])
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].toolOutput).toBe('42')
  })

  it('skips non-object blocks in user array content (primitive guards)', async () => {
    // Array content with a primitive (string) mixed in — must not crash, just skip it
    setupTranscript(makeUserEntry(['not-an-object', { type: 'text', text: 'Real message' }]))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].content).toBe('Real message')
  })

  it('skips non-object blocks in assistant array content (primitive guards)', async () => {
    // Assistant content array with a null block mixed in — must not crash
    setupTranscript(
      makeAssistantEntry([null as unknown as Record<string, unknown>, { type: 'text', text: 'Valid text' }])
    )

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].content).toBe('Valid text')
  })

  it('skips unknown system subtypes (returns no lines)', async () => {
    const content = [
      makeUserEntry('Hello'),
      makeSystemEntry('unknown_future_subtype'),
    ].join('\n')
    setupTranscript(content)

    const lines = await parseTranscriptLines('myproject', 'session-1')
    // Unknown subtype produces no output — only the user message survives
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('user-message')
  })

  it('parses summary entry -> recap with recapSource compaction', async () => {
    setupTranscript(JSON.stringify({
      uuid: 'sum-uuid-1',
      type: 'summary',
      timestamp: DEFAULT_TIMESTAMP,
      sessionId: DEFAULT_SESSION_ID,
      summary: 'Working on gitignore migration.',
      leafUuid: 'leaf-abc',
    }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('recap')
    expect(lines[0].content).toBe('Working on gitignore migration.')
    expect(lines[0].recapSource).toBe('compaction')
  })

  it('parses system/away_summary -> recap with recapSource away', async () => {
    setupTranscript(JSON.stringify({
      uuid: 'away-uuid-1',
      type: 'system',
      subtype: 'away_summary',
      timestamp: DEFAULT_TIMESTAMP,
      sessionId: DEFAULT_SESSION_ID,
      content: 'Waiting for user choice before merging.',
      isMeta: false,
    }))

    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(1)
    expect(lines[0].type).toBe('recap')
    expect(lines[0].content).toBe('Waiting for user choice before merging.')
    expect(lines[0].recapSource).toBe('away')
  })

  it('skips system/stop_hook_summary (regression guard)', async () => {
    setupTranscript(JSON.stringify({
      uuid: 'hook-uuid-1',
      type: 'system',
      subtype: 'stop_hook_summary',
      timestamp: DEFAULT_TIMESTAMP,
      hookCount: 1,
      hookInfos: [],
    }))
    const lines = await parseTranscriptLines('myproject', 'session-1')
    expect(lines).toHaveLength(0)
  })

  // Helper: set up Sidekick log events for interleaving tests
  function setupSidekickEvents(events: Record<string, unknown>[]): void {
    mockFindLogFiles.mockImplementation((_dir: string, prefix: string) => {
      if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
      return Promise.resolve([])
    })
    mockReadLogFile.mockResolvedValue(events)
  }

  it('maps reminder:consumed with renderedText to line.content', async () => {
    setupTranscript(makeUserEntry('Hello'))
    setupSidekickEvents([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'reminder:consumed',
        context: { sessionId: 'session-1' },
        payload: { reminderName: 'vc-build', renderedText: 'You MUST run pnpm build before completing.' },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const reminderLine = lines.find((l) => l.type === 'reminder:consumed')
    expect(reminderLine).toBeDefined()
    expect(reminderLine!.content).toBe('You MUST run pnpm build before completing.')
  })

  it('maps session-summary:finish with session_title to newValue', async () => {
    setupTranscript(makeUserEntry('Hello'))
    setupSidekickEvents([
      {
        time: new Date('2025-01-15T10:30:01.000Z').getTime(),
        type: 'session-summary:finish',
        context: { sessionId: 'session-1' },
        payload: { session_title: 'Fix auth bug in login flow' },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const summaryLine = lines.find((l) => l.type === 'session-summary:finish')
    expect(summaryLine).toBeDefined()
    expect(summaryLine!.newValue).toBe('Fix auth bug in login flow')
  })

  it('deduplicates Sidekick event IDs when two events share the same timestamp+type', async () => {
    setupTranscript(makeUserEntry('Hello'))
    const sharedTime = new Date('2025-01-15T10:30:01.000Z').getTime()
    setupSidekickEvents([
      {
        time: sharedTime,
        type: 'reminder:staged',
        context: { sessionId: 'session-1' },
        payload: { reminderName: 'vc-build' },
      },
      {
        time: sharedTime,
        type: 'reminder:staged',
        context: { sessionId: 'session-1' },
        payload: { reminderName: 'vc-typecheck' },
      },
    ])

    const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
    const sidekickLines = lines.filter((l) => l.type === 'reminder:staged')
    expect(sidekickLines).toHaveLength(2)
    const ids = sidekickLines.map((l) => l.id)
    const baseId = `sidekick-${sharedTime}-reminder:staged`
    expect(ids).toContain(baseId)
    expect(ids).toContain(`${baseId}-2`)
  })
})

// ============================================================================
// Subagent Support
// ============================================================================

const SUBAGENT_BASE = '/home/testuser/.claude/projects/myproject/session-1/subagents'

describe('listSubagents', () => {
  it('returns agent IDs from .jsonl files matching agent-*.jsonl', async () => {
    mockReaddir.mockResolvedValue(['agent-abc123.jsonl', 'agent-def456.jsonl', 'agent-abc123.meta.json'])

    const ids = await listSubagents('myproject', 'session-1')
    expect(ids).toEqual(['abc123', 'def456'])
  })

  it('filters out files that do not match agent-*.jsonl', async () => {
    mockReaddir.mockResolvedValue(['agent-abc123.jsonl', 'somethingelse.jsonl', 'README.md'])

    const ids = await listSubagents('myproject', 'session-1')
    expect(ids).toEqual(['abc123'])
  })

  it('returns empty array when directory does not exist', async () => {
    mockReaddir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const ids = await listSubagents('myproject', 'session-1')
    expect(ids).toEqual([])
  })

  it('returns empty array when directory is empty', async () => {
    mockReaddir.mockResolvedValue([])

    const ids = await listSubagents('myproject', 'session-1')
    expect(ids).toEqual([])
  })

  it('reads from the correct subagents directory path', async () => {
    mockReaddir.mockResolvedValue([])

    await listSubagents('myproject', 'session-1')

    expect(mockReaddir).toHaveBeenCalledWith(SUBAGENT_BASE)
  })
})

describe('parseSubagentTranscript', () => {
  const AGENT_ID = 'agent42'
  const JSONL_PATH = `${SUBAGENT_BASE}/agent-agent42.jsonl`

  function setupSubagentTranscript(content: string, metaContent?: string) {
    mockReadFile.mockImplementation((p: string) => {
      if (p === JSONL_PATH) return Promise.resolve(content)
      if (p.endsWith('.meta.json')) {
        if (metaContent !== undefined) return Promise.resolve(metaContent)
        return Promise.reject(new Error('ENOENT'))
      }
      return Promise.reject(new Error(`Unexpected path: ${p}`))
    })
  }

  it('returns null when the .jsonl file does not exist', async () => {
    mockReadFile.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }))

    const result = await parseSubagentTranscript('myproject', 'session-1', AGENT_ID)
    expect(result).toBeNull()
  })

  it('returns empty lines and empty meta when .jsonl is blank', async () => {
    setupSubagentTranscript('   \n  ')

    const result = await parseSubagentTranscript('myproject', 'session-1', AGENT_ID)
    expect(result).not.toBeNull()
    expect(result!.lines).toEqual([])
    expect(result!.meta).toEqual({})
  })

  it('derives .jsonl and .meta.json paths from projectId/sessionId/agentId', async () => {
    const meta = { agentType: 'subagent' }
    setupSubagentTranscript(makeUserEntry('Hello'), JSON.stringify(meta))

    await parseSubagentTranscript('myproject', 'session-1', AGENT_ID)

    const paths = mockReadFile.mock.calls.map((c: unknown[]) => c[0] as string)
    expect(paths).toContain(JSONL_PATH)
    expect(paths).toContain(`${SUBAGENT_BASE}/agent-agent42.meta.json`)
  })

  it('parses user and assistant entries from the .jsonl file', async () => {
    const content = [
      makeUserEntry('User prompt'),
      makeAssistantEntry([{ type: 'text', text: 'Assistant reply' }]),
    ].join('\n')
    setupSubagentTranscript(content)

    const result = await parseSubagentTranscript('myproject', 'session-1', AGENT_ID)
    expect(result).not.toBeNull()
    expect(result!.lines).toHaveLength(2)
    expect(result!.lines[0].type).toBe('user-message')
    expect(result!.lines[0].content).toBe('User prompt')
    expect(result!.lines[1].type).toBe('assistant-message')
    expect(result!.lines[1].content).toBe('Assistant reply')
  })

  it('returns empty meta when .meta.json does not exist', async () => {
    setupSubagentTranscript(makeUserEntry('Hello'))

    const result = await parseSubagentTranscript('myproject', 'session-1', AGENT_ID)
    expect(result).not.toBeNull()
    expect(result!.meta).toEqual({})
  })

  it('reads meta.json and maps agentType, worktreePath, parentToolUseId', async () => {
    const meta = {
      agentType: 'subagent',
      worktreePath: '/tmp/worktrees/agent-42',
      parentToolUseId: 'toolu_parent123',
    }
    setupSubagentTranscript(makeUserEntry('Hello'), JSON.stringify(meta))

    const result = await parseSubagentTranscript('myproject', 'session-1', AGENT_ID)
    expect(result).not.toBeNull()
    expect(result!.meta.agentType).toBe('subagent')
    expect(result!.meta.worktreePath).toBe('/tmp/worktrees/agent-42')
    expect(result!.meta.parentToolUseId).toBe('toolu_parent123')
  })

  it('ignores malformed meta.json and returns empty meta', async () => {
    setupSubagentTranscript(makeUserEntry('Hello'), '{not valid json}')

    const result = await parseSubagentTranscript('myproject', 'session-1', AGENT_ID)
    expect(result).not.toBeNull()
    expect(result!.meta).toEqual({})
  })

  it('does not interleave Sidekick events (findLogFiles not called)', async () => {
    setupSubagentTranscript(makeUserEntry('Hello'))

    await parseSubagentTranscript('myproject', 'session-1', AGENT_ID)

    expect(mockFindLogFiles).not.toHaveBeenCalled()
  })
})
