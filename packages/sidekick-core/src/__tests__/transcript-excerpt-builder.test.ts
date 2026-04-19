/**
 * Tests for transcript-excerpt-builder module.
 *
 * Validates excerpt building, line formatting, text extraction,
 * and circular buffer operations.
 */

import { describe, it, expect } from 'vitest'
import {
  buildExcerpt,
  formatExcerptLine,
  extractTextContent,
  getRawContentString,
  getBufferedEntries,
} from '../transcript-excerpt-builder'
import { EXCERPT_BUFFER_SIZE, type BufferedEntry } from '../transcript-helpers'
import { createFakeLogger } from '@sidekick/testing-fixtures'

const defaultFilterOptions = {
  includeToolMessages: true,
  includeToolOutputs: false,
  includeAssistantThinking: false,
}

// ============================================================================
// getBufferedEntries
// ============================================================================

describe('getBufferedEntries', () => {
  it('returns empty array for empty buffer', () => {
    expect(getBufferedEntries([], 0, 0, EXCERPT_BUFFER_SIZE)).toEqual([])
  })

  it('returns entries in order when buffer is not full', () => {
    const buffer: BufferedEntry[] = [
      { lineNumber: 1, rawLine: '{"type":"user"}', uuid: null },
      { lineNumber: 2, rawLine: '{"type":"assistant"}', uuid: null },
    ]
    const result = getBufferedEntries(buffer, 0, 2, EXCERPT_BUFFER_SIZE)
    expect(result).toHaveLength(2)
    expect(result[0].lineNumber).toBe(1)
    expect(result[1].lineNumber).toBe(2)
  })

  it('returns entries in chronological order when buffer wraps', () => {
    const bufferSize = 3
    // Simulating a full buffer where head=1 (oldest at index 1)
    const buffer: BufferedEntry[] = [
      { lineNumber: 5, rawLine: '{"n":5}', uuid: null }, // idx 0 (newest)
      { lineNumber: 3, rawLine: '{"n":3}', uuid: null }, // idx 1 (oldest = head)
      { lineNumber: 4, rawLine: '{"n":4}', uuid: null }, // idx 2
    ]
    const result = getBufferedEntries(buffer, 1, 3, bufferSize)
    expect(result).toHaveLength(3)
    expect(result[0].lineNumber).toBe(3) // oldest
    expect(result[1].lineNumber).toBe(4)
    expect(result[2].lineNumber).toBe(5) // newest
  })
})

// ============================================================================
// formatExcerptLine
// ============================================================================

describe('formatExcerptLine', () => {
  const knownUuids = new Set<string>()

  it('formats user text messages', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: 'Hello world' },
    })
    const result = formatExcerptLine(line, knownUuids, defaultFilterOptions)
    expect(result).toBe('[USER]: Hello world')
  })

  it('formats assistant text messages', () => {
    const line = JSON.stringify({
      type: 'assistant',
      message: { content: 'I can help with that.' },
    })
    const result = formatExcerptLine(line, knownUuids, defaultFilterOptions)
    expect(result).toBe('[ASSISTANT]: I can help with that.')
  })

  it('excludes file-history-snapshot entries', () => {
    const line = JSON.stringify({ type: 'file-history-snapshot' })
    expect(formatExcerptLine(line, knownUuids, defaultFilterOptions)).toBeNull()
  })

  it('excludes isMeta entries', () => {
    const line = JSON.stringify({
      type: 'user',
      isMeta: true,
      message: { content: 'meta content' },
    })
    expect(formatExcerptLine(line, knownUuids, defaultFilterOptions)).toBeNull()
  })

  it('excludes system-reminder content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: 'some <system-reminder> injected text' },
    })
    expect(formatExcerptLine(line, knownUuids, defaultFilterOptions)).toBeNull()
  })

  it('excludes hook feedback content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: 'Hook Feedback: some message' },
    })
    expect(formatExcerptLine(line, knownUuids, defaultFilterOptions)).toBeNull()
  })

  it('excludes local-command-stdout content', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: '<local-command-stdout>output</local-command-stdout>' },
    })
    expect(formatExcerptLine(line, knownUuids, defaultFilterOptions)).toBeNull()
  })

  it('excludes builtin slash commands', () => {
    const line = JSON.stringify({
      type: 'user',
      message: { content: '<command-name>/clear</command-name>' },
    })
    expect(formatExcerptLine(line, knownUuids, defaultFilterOptions)).toBeNull()
  })

  it('includes tool_use when includeToolMessages is true', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'Read' })
    const result = formatExcerptLine(line, knownUuids, defaultFilterOptions)
    expect(result).toBe('[TOOL]: Read')
  })

  it('excludes tool_use when includeToolMessages is false', () => {
    const line = JSON.stringify({ type: 'tool_use', name: 'Read' })
    const result = formatExcerptLine(line, knownUuids, {
      ...defaultFilterOptions,
      includeToolMessages: false,
    })
    expect(result).toBeNull()
  })

  it('excludes tool_result when includeToolOutputs is false', () => {
    const line = JSON.stringify({ type: 'tool_result', content: 'output' })
    const result = formatExcerptLine(line, knownUuids, defaultFilterOptions)
    expect(result).toBeNull() // includeToolOutputs defaults to false
  })

  it('includes thinking when includeAssistantThinking is true', () => {
    const line = JSON.stringify({ type: 'thinking', thinking: 'Let me consider...' })
    const result = formatExcerptLine(line, knownUuids, {
      ...defaultFilterOptions,
      includeAssistantThinking: true,
    })
    expect(result).toContain('[THINKING]:')
    expect(result).toContain('Let me consider')
  })

  it('includes summary entries when leafUuid is known', () => {
    const uuids = new Set(['leaf-uuid-1'])
    const line = JSON.stringify({
      type: 'summary',
      leafUuid: 'leaf-uuid-1',
      summary: 'Session is about testing',
    })
    const result = formatExcerptLine(line, uuids, defaultFilterOptions)
    expect(result).toBe('[SESSION_HINT]: Session is about testing')
  })

  it('excludes summary entries with unknown leafUuid', () => {
    const line = JSON.stringify({
      type: 'summary',
      leafUuid: 'unknown-uuid',
      summary: 'some summary',
    })
    expect(formatExcerptLine(line, knownUuids, defaultFilterOptions)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(formatExcerptLine('not json', knownUuids, defaultFilterOptions)).toBeNull()
  })

  it('formats system/away_summary as [SESSION_RECAP]', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'away_summary',
      content: 'Waiting for user choice before merging.',
      uuid: 'away-1',
      timestamp: '2026-04-15T10:00:00.000Z',
      isMeta: false,
    })
    expect(formatExcerptLine(line, new Set(), {})).toBe(
      '[SESSION_RECAP]: Waiting for user choice before merging.'
    )
  })

  it('returns null for system/stop_hook_summary (regression guard)', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'stop_hook_summary',
      hookCount: 2,
      hookInfos: [],
    })
    expect(formatExcerptLine(line, new Set(), {})).toBeNull()
  })

  it('returns null for system/compact_boundary (regression guard)', () => {
    const line = JSON.stringify({
      type: 'system',
      subtype: 'compact_boundary',
    })
    expect(formatExcerptLine(line, new Set(), {})).toBeNull()
  })
})

// ============================================================================
// extractTextContent
// ============================================================================

describe('extractTextContent', () => {
  const opts = { includeToolMessages: true, includeToolOutputs: false, includeAssistantThinking: false }

  it('returns string content as-is', () => {
    expect(extractTextContent('Hello', opts)).toBe('Hello')
  })

  it('returns null for non-string non-array content', () => {
    expect(extractTextContent(42, opts)).toBeNull()
    expect(extractTextContent(null, opts)).toBeNull()
  })

  it('extracts text blocks from array content', () => {
    const content = [
      { type: 'text', text: 'Part 1' },
      { type: 'tool_use', name: 'Read' },
      { type: 'text', text: 'Part 2' },
    ]
    expect(extractTextContent(content, opts)).toBe('Part 1 Part 2')
  })

  it('strips tool blocks entirely', () => {
    const content = [
      { type: 'tool_use', name: 'Read' },
      { type: 'tool_result', content: 'output' },
    ]
    expect(extractTextContent(content, opts)).toBeNull()
  })

  it('includes thinking blocks when enabled', () => {
    const content = [
      { type: 'thinking', thinking: 'Analyzing the problem...' },
      { type: 'text', text: 'Here is my answer.' },
    ]
    const result = extractTextContent(content, { ...opts, includeAssistantThinking: true })
    expect(result).toContain('(thinking:')
    expect(result).toContain('Here is my answer.')
  })
})

// ============================================================================
// getRawContentString
// ============================================================================

describe('getRawContentString', () => {
  it('returns string content directly', () => {
    expect(getRawContentString({ content: 'hello' })).toBe('hello')
  })

  it('returns string from message.content', () => {
    expect(getRawContentString({ message: { content: 'world' } })).toBe('world')
  })

  it('joins text blocks from array content', () => {
    const entry = {
      message: {
        content: [
          { type: 'text', text: 'part1' },
          { type: 'text', text: 'part2' },
        ],
      },
    }
    expect(getRawContentString(entry)).toBe('part1 part2')
  })

  it('returns null for missing content', () => {
    expect(getRawContentString({})).toBeNull()
  })
})

// ============================================================================
// buildExcerpt
// ============================================================================

describe('buildExcerpt', () => {
  const logger = createFakeLogger()
  const knownUuids = new Set<string>()

  function makeBufferedEntry(lineNumber: number, type: string, content: string): BufferedEntry {
    return {
      lineNumber,
      rawLine: JSON.stringify({
        type,
        message: { content },
      }),
      uuid: null,
    }
  }

  it('returns empty excerpt for empty buffer', () => {
    const result = buildExcerpt([], knownUuids, {}, logger)
    expect(result.content).toBe('')
    expect(result.lineCount).toBe(0)
  })

  it('builds excerpt from buffered entries', () => {
    const entries = [makeBufferedEntry(1, 'user', 'Hello'), makeBufferedEntry(2, 'assistant', 'Hi there')]

    const result = buildExcerpt(entries, knownUuids, {}, logger)
    expect(result.lineCount).toBe(2)
    expect(result.content).toContain('[USER]: Hello')
    expect(result.content).toContain('[ASSISTANT]: Hi there')
    expect(result.startLine).toBe(1)
    expect(result.endLine).toBe(2)
  })

  it('respects maxLines option', () => {
    const entries = [
      makeBufferedEntry(1, 'user', 'First'),
      makeBufferedEntry(2, 'assistant', 'Second'),
      makeBufferedEntry(3, 'user', 'Third'),
    ]

    const result = buildExcerpt(entries, knownUuids, { maxLines: 2 }, logger)
    expect(result.lineCount).toBe(2)
    // Should get the LAST 2 lines
    expect(result.content).toContain('[ASSISTANT]: Second')
    expect(result.content).toContain('[USER]: Third')
  })

  it('applies bookmark filter', () => {
    const entries = [
      makeBufferedEntry(1, 'user', 'Before bookmark'),
      makeBufferedEntry(2, 'assistant', 'Also before'),
      makeBufferedEntry(3, 'user', 'After bookmark'),
    ]

    const result = buildExcerpt(entries, knownUuids, { bookmarkLine: 2 }, logger)
    expect(result.bookmarkApplied).toBe(true)
    expect(result.lineCount).toBe(1)
    expect(result.content).toContain('After bookmark')
  })

  it('does not apply bookmark when it equals max line number', () => {
    const entries = [makeBufferedEntry(1, 'user', 'First'), makeBufferedEntry(2, 'assistant', 'Last')]

    const result = buildExcerpt(entries, knownUuids, { bookmarkLine: 2 }, logger)
    expect(result.bookmarkApplied).toBe(false)
    expect(result.lineCount).toBe(2)
  })

  it('filters out excluded entry types', () => {
    const entries: BufferedEntry[] = [
      makeBufferedEntry(1, 'user', 'Hello'),
      {
        lineNumber: 2,
        rawLine: JSON.stringify({ type: 'file-history-snapshot' }),
        uuid: null,
      },
      makeBufferedEntry(3, 'assistant', 'Response'),
    ]

    const result = buildExcerpt(entries, knownUuids, {}, logger)
    expect(result.lineCount).toBe(2)
    expect(result.content).not.toContain('file-history-snapshot')
  })
})
