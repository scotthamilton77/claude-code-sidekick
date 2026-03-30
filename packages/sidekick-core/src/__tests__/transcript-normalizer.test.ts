/**
 * Tests for transcript-normalizer module.
 *
 * Validates entry normalization, UUID parsing, buffered entry parsing,
 * and transcript string rendering.
 */

import { describe, it, expect, vi } from 'vitest'
import { normalizeEntry, parseBufferedEntry, parseUuid, renderTranscriptString } from '../transcript-normalizer'
import type { Logger, TranscriptEntry, CanonicalTranscriptEntry } from '@sidekick/types'

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn(() => createMockLogger()),
    flush: vi.fn(() => Promise.resolve()),
  }
}

// ============================================================================
// normalizeEntry
// ============================================================================

describe('normalizeEntry', () => {
  it('normalizes a simple user text message', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      uuid: 'test-uuid-1',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        role: 'user',
        content: 'Hello world',
        id: 'msg-1',
      },
    }

    const result = normalizeEntry(entry, 1)
    expect(result).toHaveLength(1)
    expect(result![0].id).toBe('test-uuid-1')
    expect(result![0].role).toBe('user')
    expect(result![0].type).toBe('text')
    expect(result![0].content).toBe('Hello world')
    expect(result![0].metadata.lineNumber).toBe(1)
  })

  it('normalizes an assistant message with nested content blocks', () => {
    const entry: TranscriptEntry = {
      type: 'assistant',
      uuid: 'test-uuid-2',
      timestamp: '2026-01-01T00:00:01Z',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me help you.' },
          { type: 'tool_use', id: 'tool-1', name: 'Read', input: { path: '/file.ts' } },
        ],
        id: 'msg-2',
      },
    }

    const result = normalizeEntry(entry, 2)
    expect(result).toHaveLength(2)
    expect(result![0].type).toBe('text')
    expect(result![0].content).toBe('Let me help you.')
    expect(result![1].type).toBe('tool_use')
    expect(result![1].metadata.toolName).toBe('Read')
  })

  it('normalizes user message with tool_result blocks', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      uuid: 'test-uuid-3',
      timestamp: '2026-01-01T00:00:02Z',
      message: {
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: 'file contents', is_error: false }],
        id: 'msg-3',
      },
    }

    const result = normalizeEntry(entry, 3)
    expect(result).toHaveLength(1)
    expect(result![0].type).toBe('tool_result')
    expect(result![0].metadata.toolUseId).toBe('tool-1')
    expect(result![0].metadata.isError).toBe(false)
  })

  it('returns null for non-message types', () => {
    const entry: TranscriptEntry = {
      type: 'summary',
      uuid: 'summary-1',
    }

    expect(normalizeEntry(entry, 1)).toBeNull()
  })

  it('returns null when message is missing', () => {
    const entry: TranscriptEntry = {
      type: 'user',
    }

    expect(normalizeEntry(entry, 1)).toBeNull()
  })

  it('handles isMeta and isCompactSummary flags', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      uuid: 'meta-1',
      isMeta: true,
      isCompactSummary: true,
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        role: 'user',
        content: 'meta content',
      },
    }

    const result = normalizeEntry(entry, 1)
    expect(result).toHaveLength(1)
    expect(result![0].metadata.isMeta).toBe(true)
    expect(result![0].metadata.isCompactSummary).toBe(true)
  })

  it('generates line-based id when uuid is missing', () => {
    const entry: TranscriptEntry = {
      type: 'user',
      timestamp: '2026-01-01T00:00:00Z',
      message: {
        role: 'user',
        content: 'no uuid',
      },
    }

    const result = normalizeEntry(entry, 42)
    expect(result![0].id).toBe('line-42')
  })
})

// ============================================================================
// parseBufferedEntry
// ============================================================================

describe('parseBufferedEntry', () => {
  it('parses valid buffered entry', () => {
    const logger = createMockLogger()
    const entry = {
      lineNumber: 1,
      rawLine: JSON.stringify({
        type: 'user',
        uuid: 'test-1',
        timestamp: '2026-01-01T00:00:00Z',
        message: { role: 'user', content: 'hello' },
      }),
      uuid: 'test-1',
    }

    const result = parseBufferedEntry(entry, logger)
    expect(result).toHaveLength(1)
    expect(result![0].content).toBe('hello')
  })

  it('returns null for malformed JSON', () => {
    const logger = createMockLogger()
    const entry = {
      lineNumber: 1,
      rawLine: '{ invalid json }',
      uuid: null,
    }

    const result = parseBufferedEntry(entry, logger)
    expect(result).toBeNull()
    expect(logger.warn).toHaveBeenCalled()
  })

  it('returns null for non-message entry types', () => {
    const logger = createMockLogger()
    const entry = {
      lineNumber: 1,
      rawLine: JSON.stringify({ type: 'file-history-snapshot' }),
      uuid: null,
    }

    const result = parseBufferedEntry(entry, logger)
    expect(result).toBeNull()
  })
})

// ============================================================================
// parseUuid
// ============================================================================

describe('parseUuid', () => {
  it('extracts UUID from valid JSON', () => {
    const line = JSON.stringify({ uuid: 'test-uuid-123', type: 'user' })
    expect(parseUuid(line)).toBe('test-uuid-123')
  })

  it('returns null when uuid field is missing', () => {
    const line = JSON.stringify({ type: 'user' })
    expect(parseUuid(line)).toBeNull()
  })

  it('returns null for malformed JSON', () => {
    expect(parseUuid('not json')).toBeNull()
  })
})

// ============================================================================
// renderTranscriptString
// ============================================================================

describe('renderTranscriptString', () => {
  it('renders text entries', () => {
    const entries: CanonicalTranscriptEntry[] = [
      {
        id: '1',
        timestamp: new Date('2026-01-01T00:00:00Z'),
        role: 'user',
        type: 'text',
        content: 'Hello',
        metadata: { provider: 'claude', lineNumber: 1 },
      },
      {
        id: '2',
        timestamp: new Date('2026-01-01T00:00:01Z'),
        role: 'assistant',
        type: 'text',
        content: 'Hi there',
        metadata: { provider: 'claude', lineNumber: 2 },
      },
    ]

    const result = renderTranscriptString(entries)
    expect(result).toContain('[2026-01-01T00:00:00.000Z] USER: Hello')
    expect(result).toContain('[2026-01-01T00:00:01.000Z] ASSISTANT: Hi there')
  })

  it('renders tool_use entries', () => {
    const entries: CanonicalTranscriptEntry[] = [
      {
        id: '1',
        timestamp: new Date('2026-01-01T00:00:00Z'),
        role: 'assistant',
        type: 'tool_use',
        content: { name: 'Read', input: {} },
        metadata: { provider: 'claude', lineNumber: 1, toolName: 'Read' },
      },
    ]

    const result = renderTranscriptString(entries)
    expect(result).toContain('ASSISTANT TOOL_USE: Read')
  })

  it('renders tool_result entries', () => {
    const entries: CanonicalTranscriptEntry[] = [
      {
        id: '1',
        timestamp: new Date('2026-01-01T00:00:00Z'),
        role: 'user',
        type: 'tool_result',
        content: { output: 'data' },
        metadata: { provider: 'claude', lineNumber: 1 },
      },
    ]

    const result = renderTranscriptString(entries)
    expect(result).toContain('USER TOOL_RESULT')
  })

  it('returns empty string for empty array', () => {
    expect(renderTranscriptString([])).toBe('')
  })
})
