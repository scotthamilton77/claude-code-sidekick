/**
 * Tests for transcript excerpt extraction
 *
 * Validates behavioral parity with Track 1 (scripts/benchmark/lib/preprocessing.sh)
 */

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, join } from 'path'
import { extractExcerpt, extractExcerptFromFile } from '../../../src/lib/transcript/excerpt.js'
import type { TranscriptMessage } from '../../../src/benchmark/data/types.js'
import type { ProcessedMessage } from '../../../src/lib/transcript/types.js'

// Helper to load fixtures
const FIXTURES_DIR = resolve(__dirname, '../../fixtures/transcript')
const TEST_DATA_DIR = resolve(__dirname, '../../../../test-data/transcripts')

function loadFixture(name: string): ProcessedMessage[] {
  const content = readFileSync(join(FIXTURES_DIR, name), 'utf-8')
  return JSON.parse(content) as ProcessedMessage[]
}

function loadTranscript(name: string): TranscriptMessage[] {
  const content = readFileSync(join(TEST_DATA_DIR, name), 'utf-8')
  return content
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line) as TranscriptMessage)
}

describe('extractExcerpt', () => {
  describe('line extraction', () => {
    it('extracts last N lines from transcript (default 80)', () => {
      const transcript = loadTranscript('long-001.jsonl')
      const expected = loadFixture('long-001-preprocessed-default.json')

      const result = extractExcerpt(transcript)

      expect(result.messages).toHaveLength(expected.length)
      expect(result.messages).toEqual(expected)
      expect(result.linesExtracted).toBe(80)
    })

    it('handles transcripts shorter than lineCount', () => {
      const transcript = loadTranscript('short-001.jsonl')
      const expected = loadFixture('short-001-preprocessed.json')

      const result = extractExcerpt(transcript, { lineCount: 80 })

      expect(result.messages).toHaveLength(expected.length)
      expect(result.messages).toEqual(expected)
      expect(result.linesExtracted).toBe(33) // actual line count
    })

    it('respects custom lineCount option', () => {
      const transcript = loadTranscript('long-001.jsonl')
      const expected = loadFixture('long-001-preprocessed-10-lines.json')

      const result = extractExcerpt(transcript, { lineCount: 10 })

      expect(result.messages).toHaveLength(expected.length)
      expect(result.messages).toEqual(expected)
      expect(result.linesExtracted).toBe(10)
    })
  })

  describe('message filtering', () => {
    it('filters tool messages by default', () => {
      const transcript = loadTranscript('long-001.jsonl')
      const withFilter = loadFixture('long-001-preprocessed-default.json')
      const withoutFilter = loadFixture('long-001-preprocessed-no-filter.json')

      const resultFiltered = extractExcerpt(transcript, {
        filterToolMessages: true,
      })
      const resultUnfiltered = extractExcerpt(transcript, {
        filterToolMessages: false,
      })

      expect(resultFiltered.messages).toEqual(withFilter)
      expect(resultUnfiltered.messages).toEqual(withoutFilter)
      expect(resultUnfiltered.messages.length).toBeGreaterThan(resultFiltered.messages.length)
    })

    it('filters messages without .message field', () => {
      const transcript = loadTranscript('short-001.jsonl')
      const result = extractExcerpt(transcript)

      // All returned messages should have role and content
      result.messages.forEach((msg) => {
        expect(msg).toHaveProperty('role')
        expect(msg).toHaveProperty('content')
      })
    })
  })

  describe('metadata stripping', () => {
    it('strips metadata fields by default', () => {
      const transcript = loadTranscript('short-001.jsonl')
      const result = extractExcerpt(transcript)

      result.messages.forEach((msg) => {
        // Should keep only role and content
        expect(Object.keys(msg).sort()).toEqual(['content', 'role'])
        // Should NOT have metadata fields
        expect(msg).not.toHaveProperty('model')
        expect(msg).not.toHaveProperty('id')
        expect(msg).not.toHaveProperty('type')
        expect(msg).not.toHaveProperty('stop_reason')
        expect(msg).not.toHaveProperty('stop_sequence')
        expect(msg).not.toHaveProperty('usage')
      })
    })

    it('preserves metadata when stripMetadata=false', () => {
      const transcript = loadTranscript('long-001.jsonl')
      const result = extractExcerpt(transcript, {
        lineCount: 10,
        stripMetadata: false,
      })

      // Find at least one message with metadata
      const msgWithMetadata = result.messages.find(
        (msg) => 'model' in msg && msg.model !== undefined
      )
      expect(msgWithMetadata).toBeDefined()
    })
  })

  describe('edge cases', () => {
    it('handles empty transcript', () => {
      const result = extractExcerpt([])

      expect(result.messages).toEqual([])
      expect(result.linesExtracted).toBe(0)
      expect(result.messageCount).toBe(0)
    })

    it('handles transcript with no messages (only metadata)', () => {
      const transcript: TranscriptMessage[] = [
        {
          type: 'summary',
          parentUuid: null,
          isSidechain: false,
          userType: 'external',
          cwd: '/test',
          sessionId: 'test',
          version: '1.0.0',
          gitBranch: 'main',
          uuid: 'test',
          timestamp: '2025-01-01T00:00:00Z',
        },
      ]

      const result = extractExcerpt(transcript)

      expect(result.messages).toEqual([])
      expect(result.linesExtracted).toBe(1)
      expect(result.messageCount).toBe(0)
    })

    it('handles lineCount of 0', () => {
      const transcript = loadTranscript('short-001.jsonl')
      const result = extractExcerpt(transcript, { lineCount: 0 })

      expect(result.messages).toEqual([])
      expect(result.linesExtracted).toBe(0)
    })

    it('handles lineCount larger than transcript', () => {
      const transcript = loadTranscript('short-001.jsonl')
      const result = extractExcerpt(transcript, { lineCount: 1000 })

      // Should extract all 33 lines
      expect(result.linesExtracted).toBe(33)
    })
  })

  describe('content preservation', () => {
    it('preserves string content', () => {
      const transcript = loadTranscript('short-001.jsonl')
      const result = extractExcerpt(transcript, { lineCount: 10 })

      const stringContent = result.messages.find((msg) => typeof msg.content === 'string')
      expect(stringContent).toBeDefined()
      expect(typeof stringContent?.content).toBe('string')
    })

    it('preserves array content (content blocks)', () => {
      const transcript = loadTranscript('long-001.jsonl')
      const result = extractExcerpt(transcript, { lineCount: 20 })

      const arrayContent = result.messages.find((msg) => Array.isArray(msg.content))
      expect(arrayContent).toBeDefined()
      expect(Array.isArray(arrayContent?.content)).toBe(true)
    })
  })
})

describe('extractExcerptFromFile', () => {
  it('loads and processes transcript from file', () => {
    const filePath = join(TEST_DATA_DIR, 'short-001.jsonl')
    const expected = loadFixture('short-001-preprocessed.json')

    const result = extractExcerptFromFile(filePath)

    expect(result.messages).toEqual(expected)
    expect(result.messageCount).toBe(expected.length)
  })

  it('respects options when loading from file', () => {
    const filePath = join(TEST_DATA_DIR, 'long-001.jsonl')
    const expected = loadFixture('long-001-preprocessed-10-lines.json')

    const result = extractExcerptFromFile(filePath, { lineCount: 10 })

    expect(result.messages).toEqual(expected)
    expect(result.linesExtracted).toBe(10)
  })

  it('throws error for non-existent file', () => {
    expect(() => extractExcerptFromFile('/nonexistent/file.jsonl')).toThrow()
  })
})
