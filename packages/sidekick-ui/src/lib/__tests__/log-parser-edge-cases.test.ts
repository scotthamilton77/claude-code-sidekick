/**
 * Log Parser Edge Case Tests - Malformed NDJSON Handling
 *
 * Tests robustness guardrails for NDJSON parsing:
 * - Malformed JSON lines
 * - Truncated JSON
 * - Mixed valid/invalid lines
 * - Warning logging behavior
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseLine, parseNdjson, parseNdjsonWithErrors, NdjsonStreamParser } from '../log-parser'

// ============================================================================
// Console Warning Tests
// ============================================================================

describe('Malformed NDJSON Warning Logging', () => {
  let consoleWarnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    consoleWarnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleWarnSpy.mockRestore()
  })

  describe('parseNdjson warnings', () => {
    it('logs warning for malformed JSON line', () => {
      const content = 'not valid json'

      parseNdjson(content)

      // Test behavior: warning is emitted with context about the problematic line
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.any(String), // Message format may change
        expect.objectContaining({
          line: 'not valid json', // Context includes original line
        })
      )
    })

    it('logs warning for truncated JSON line', () => {
      const content = '{"level": 30, "time"'

      parseNdjson(content)

      // Test behavior: warning is emitted for truncated JSON
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
    })

    it('does NOT log warning for empty lines', () => {
      const content = '\n\n  \n\t\n'

      parseNdjson(content)

      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('logs warning for each malformed line in multi-line content', () => {
      const content = [
        '{"level": 30, "time": 1234}', // valid
        'bad json 1',
        '{"level": 30}', // valid
        'bad json 2',
        '', // empty, no warning
      ].join('\n')

      parseNdjson(content)

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2)
    })

    it('truncates long lines in warning messages', () => {
      const longLine = 'x'.repeat(200)

      parseNdjson(longLine)

      // Test behavior: long lines are truncated in warning context
      // The exact truncation length (currently 100 chars) is an implementation detail
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          line: expect.stringMatching(/^x+$/), // Contains truncated x's
        })
      )
      // Verify truncation occurred (line in context is shorter than original)
      const warningContext = consoleWarnSpy.mock.calls[0][1] as { line: string }
      expect(warningContext.line.length).toBeLessThan(longLine.length)
    })

    it('can suppress warnings with silent=true', () => {
      const content = 'not valid json'

      parseNdjson(content, true)

      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('logs warnings by default (silent=false)', () => {
      const content = 'not valid json'

      parseNdjson(content, false)

      expect(consoleWarnSpy).toHaveBeenCalled()
    })
  })

  describe('NdjsonStreamParser warnings', () => {
    let parser: NdjsonStreamParser

    beforeEach(() => {
      parser = new NdjsonStreamParser()
    })

    it('logs warning for malformed line in stream', () => {
      parser.push('not valid json\n')

      // Test behavior: warning is emitted with context
      expect(consoleWarnSpy).toHaveBeenCalledTimes(1)
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.any(String), // Message format may change
        expect.objectContaining({
          line: 'not valid json',
        })
      )
    })

    it('does NOT log warning for empty lines in stream', () => {
      parser.push('\n\n')

      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('can suppress warnings with silent=true', () => {
      parser.push('not valid json\n', true)

      expect(consoleWarnSpy).not.toHaveBeenCalled()
    })

    it('logs warnings for each malformed chunk', () => {
      parser.push('bad json 1\n')
      parser.push('{"level": 30}\n') // valid
      parser.push('bad json 2\n')

      expect(consoleWarnSpy).toHaveBeenCalledTimes(2)
    })

    it('truncates long lines in stream warnings', () => {
      const longLine = 'y'.repeat(200) + '\n'

      parser.push(longLine)

      // Test behavior: long lines are truncated in warning context
      expect(consoleWarnSpy).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          line: expect.stringMatching(/^y+$/), // Contains truncated y's
        })
      )
      // Verify truncation occurred
      const warningContext = consoleWarnSpy.mock.calls[0][1] as { line: string }
      expect(warningContext.line.length).toBeLessThan(longLine.length - 1) // -1 for newline
    })
  })
})

// ============================================================================
// Malformed NDJSON Resilience Tests
// ============================================================================

describe('Malformed NDJSON Resilience', () => {
  beforeEach(() => {
    // Suppress console warnings during tests
    vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('parseLine edge cases', () => {
    it('handles completely invalid JSON', () => {
      const result = parseLine('this is not json at all')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Invalid JSON')
        expect(result.line).toBe('this is not json at all')
      }
    })

    it('handles truncated JSON (unclosed braces)', () => {
      const result = parseLine('{"level": 30, "time": 1234')

      expect(result.ok).toBe(false)
      if (!result.ok) {
        expect(result.error).toBe('Invalid JSON')
      }
    })

    it('handles JSON with syntax errors (trailing comma)', () => {
      const result = parseLine('{"level": 30,}')

      expect(result.ok).toBe(false)
    })

    it('handles non-object JSON (arrays)', () => {
      const result = parseLine('[1, 2, 3]')

      // Arrays are valid JSON, should parse successfully
      expect(result.ok).toBe(true)
    })

    it('handles non-object JSON (primitives)', () => {
      const result = parseLine('"just a string"')

      expect(result.ok).toBe(true)
    })

    it('handles JSON with unicode escape sequences', () => {
      const result = parseLine('{"msg": "Hello \\u0041"}')

      expect(result.ok).toBe(true)
    })

    it('handles JSON with control characters', () => {
      const result = parseLine('{"msg": "Line 1\\nLine 2"}')

      expect(result.ok).toBe(true)
    })
  })

  describe('parseNdjson resilience', () => {
    it('continues parsing after malformed lines', () => {
      const content = [
        '{"level": 30, "time": 1000}', // valid
        'malformed line 1',
        '{"level": 40, "time": 2000}', // valid
        'malformed line 2',
        '{"level": 50, "time": 3000}', // valid
      ].join('\n')

      const records = parseNdjson(content, true) // silent to suppress warnings

      expect(records).toHaveLength(3)
      expect(records[0].pino.time).toBe(1000)
      expect(records[1].pino.time).toBe(2000)
      expect(records[2].pino.time).toBe(3000)
    })

    it('handles mix of empty and malformed lines', () => {
      const content = ['', '{"level": 30}', '  \t  ', 'bad json', '', '{"level": 40}'].join('\n')

      const records = parseNdjson(content, true)

      expect(records).toHaveLength(2)
    })

    it('returns empty array for all-malformed content', () => {
      const content = ['bad line 1', 'bad line 2', 'bad line 3'].join('\n')

      const records = parseNdjson(content, true)

      expect(records).toHaveLength(0)
    })

    it('handles very long malformed lines', () => {
      const longBadLine = 'x'.repeat(10000)
      const content = ['{"level": 30}', longBadLine, '{"level": 40}'].join('\n')

      const records = parseNdjson(content, true)

      expect(records).toHaveLength(2)
    })
  })

  describe('parseNdjsonWithErrors behavior', () => {
    it('captures errors for malformed lines', () => {
      const content = ['{"level": 30}', 'bad json', '{"level": 40}'].join('\n')

      const { records, errors } = parseNdjsonWithErrors(content)

      expect(records).toHaveLength(2)
      expect(errors).toHaveLength(1)
      expect(errors[0].line).toBe(2)
      expect(errors[0].error).toBe('Invalid JSON')
      expect(errors[0].content).toBe('bad json')
    })

    it('does not report empty lines as errors', () => {
      const content = ['{"level": 30}', '', '  ', '{"level": 40}'].join('\n')

      const { records, errors } = parseNdjsonWithErrors(content)

      expect(records).toHaveLength(2)
      expect(errors).toHaveLength(0)
    })
  })

  describe('NdjsonStreamParser resilience', () => {
    let parser: NdjsonStreamParser

    beforeEach(() => {
      parser = new NdjsonStreamParser()
    })

    it('continues parsing after malformed chunks', () => {
      parser.push('{"level": 30}\n', true)
      parser.push('bad json\n', true)
      parser.push('{"level": 40}\n', true)

      const records = parser.getRecords()
      expect(records).toHaveLength(2)
    })

    it('handles malformed line split across chunks', () => {
      const part1 = 'bad js'
      const part2 = 'on here\n'

      parser.push(part1, true)
      parser.push(part2, true)

      const records = parser.getRecords()
      expect(records).toHaveLength(0)
    })

    it('recovers after malformed buffered line', () => {
      parser.push('bad json\n', true)
      parser.push('{"level": 30}\n', true)

      const records = parser.getRecords()
      expect(records).toHaveLength(1)
    })
  })
})
