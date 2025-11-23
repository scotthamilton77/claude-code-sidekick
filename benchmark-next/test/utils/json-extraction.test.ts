import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { extractJSONFromMarkdown, extractJSON } from '../../src/lib/utils/json-extraction.js'

// Helper to load test fixtures
function loadFixture(filename: string): string {
  const path = join(__dirname, '../fixtures/json-extraction', filename)
  return readFileSync(path, 'utf-8')
}

describe('extractJSONFromMarkdown', () => {
  it('should extract JSON from markdown code fence', () => {
    const input = loadFixture('markdown-json.txt')
    const result = extractJSONFromMarkdown(input)

    expect(result).toBe('{"name": "test", "value": 42, "nested": {"key": "value"}}')
  })

  it('should extract JSON from markdown with surrounding text', () => {
    const input = loadFixture('markdown-with-text.txt')
    const result = extractJSONFromMarkdown(input)

    expect(result).toBe('{"name": "test", "value": 42}')
  })

  it('should return original text if no markdown fence found', () => {
    const input = loadFixture('raw-json.txt')
    const result = extractJSONFromMarkdown(input)

    expect(result).toBe(input)
  })

  it('should handle multiline JSON in markdown fence', () => {
    const input = '```json\n{\n  "name": "test",\n  "value": 42\n}\n```'
    const result = extractJSONFromMarkdown(input)

    expect(result).toBe('{\n  "name": "test",\n  "value": 42\n}')
  })
})

describe('extractJSON', () => {
  it('should extract raw JSON without modification', () => {
    const input = loadFixture('raw-json.txt')
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      name: 'test',
      value: 42,
      nested: { key: 'value' },
    })
  })

  it('should extract JSON from markdown code fence', () => {
    const input = loadFixture('markdown-json.txt')
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      name: 'test',
      value: 42,
      nested: { key: 'value' },
    })
  })

  it('should extract JSON from markdown with surrounding text', () => {
    const input = loadFixture('markdown-with-text.txt')
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      name: 'test',
      value: 42,
    })
  })

  it('should unwrap single-element arrays', () => {
    const input = loadFixture('single-element-array.txt')
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      name: 'test',
      value: 42,
    })
  })

  it('should extract JSON object from text with surrounding content', () => {
    const input = loadFixture('text-with-json.txt')
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      name: 'test',
      value: 42,
    })
  })

  it('should handle multiline JSON', () => {
    const input = loadFixture('multiline-json.txt')
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      name: 'test',
      value: 42,
      nested: { key: 'value' },
    })
  })

  it('should preserve multi-element arrays', () => {
    const input = '[{"name": "test1"}, {"name": "test2"}]'
    const result = extractJSON(input)

    // Multi-element arrays should NOT be unwrapped (only single-element)
    expect(JSON.parse(result)).toEqual([{ name: 'test1' }, { name: 'test2' }])
  })

  it('should handle JSON with various whitespace', () => {
    const input = '  \n\n  {"name": "test"}  \n\n  '
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({ name: 'test' })
  })

  it('should extract JSON even with text around it', () => {
    // Edge case: multiple objects on one line
    // The implementation extracts from first { to last }, which may not be valid JSON
    // This matches bash behavior for single-line input
    const input = 'First: {"name": "test1"} Second: {"name": "test2"}'
    const result = extractJSON(input)

    // Result will be from first { to last }, including middle text
    // This is invalid JSON and will fail validation in the caller
    expect(result).toContain('"name": "test1"')
    expect(result).toContain('"name": "test2"')
  })

  it('should handle nested objects correctly', () => {
    const input = '{"outer": {"inner": {"deep": "value"}}}'
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      outer: { inner: { deep: 'value' } },
    })
  })

  it('should handle arrays within objects', () => {
    const input = '{"items": [1, 2, 3], "nested": {"arr": ["a", "b"]}}'
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      items: [1, 2, 3],
      nested: { arr: ['a', 'b'] },
    })
  })

  it('should handle escaped quotes in strings', () => {
    const input = '{"message": "He said \\"hello\\""}'
    const result = extractJSON(input)

    expect(JSON.parse(result)).toEqual({
      message: 'He said "hello"',
    })
  })
})
