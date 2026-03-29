/**
 * Unit tests for config.ts helper functions: deepMerge, coerceValue, setNestedValue.
 *
 * These helpers power the configuration cascade and are exercised indirectly
 * by config-service.test.ts, but deserve direct unit tests for edge cases.
 *
 * @see packages/sidekick-core/src/config.ts
 */

import { describe, expect, it } from 'vitest'
import { deepMerge, coerceValue, setNestedValue } from '../config'

// ============================================================================
// deepMerge
// ============================================================================

describe('deepMerge', () => {
  it('merges flat objects', () => {
    const base = { a: 1, b: 2 }
    const override = { b: 3, c: 4 }
    const result = deepMerge(base, override)
    expect(result).toEqual({ a: 1, b: 3, c: 4 })
  })

  it('deep merges nested objects', () => {
    const base = { logging: { level: 'info', format: 'json' }, paths: { state: '.sidekick' } }
    const override = { logging: { level: 'debug' } }
    const result = deepMerge(base, override)
    expect(result).toEqual({
      logging: { level: 'debug', format: 'json' },
      paths: { state: '.sidekick' },
    })
  })

  it('replaces arrays (not merging)', () => {
    const base = { items: [1, 2, 3] }
    const override = { items: [4, 5] }
    const result = deepMerge(base, override)
    expect(result).toEqual({ items: [4, 5] })
  })

  it('replaces primitives', () => {
    const base = { count: 10, name: 'old' }
    const override = { count: 20, name: 'new' }
    const result = deepMerge(base, override)
    expect(result).toEqual({ count: 20, name: 'new' })
  })

  it('handles null override values', () => {
    const base = { a: { nested: true } } as Record<string, unknown>
    const override = { a: null } as Record<string, unknown>
    const result = deepMerge(base, override)
    expect(result.a).toBeNull()
  })

  it('handles null base values being overridden by objects', () => {
    const base = { a: null } as Record<string, unknown>
    const override = { a: { nested: true } }
    const result = deepMerge(base, override)
    expect(result.a).toEqual({ nested: true })
  })

  it('does not mutate the base object', () => {
    const base = { a: 1, nested: { b: 2 } }
    const override = { a: 10, nested: { b: 20 } }
    deepMerge(base, override)
    expect(base.a).toBe(1)
    expect(base.nested.b).toBe(2)
  })

  it('adds new keys from override', () => {
    const base = { existing: true }
    const override = { newKey: 'value' }
    const result = deepMerge(base, override)
    expect(result).toEqual({ existing: true, newKey: 'value' })
  })

  it('handles deeply nested objects (3+ levels)', () => {
    const base = { a: { b: { c: { d: 1 } } } }
    const override = { a: { b: { c: { d: 2, e: 3 } } } }
    const result = deepMerge(base, override)
    expect(result).toEqual({ a: { b: { c: { d: 2, e: 3 } } } })
  })

  it('handles empty override', () => {
    const base = { a: 1, b: 2 }
    const result = deepMerge(base, {})
    expect(result).toEqual({ a: 1, b: 2 })
  })

  it('handles empty base', () => {
    const base = {} as Record<string, unknown>
    const override = { a: 1 }
    const result = deepMerge(base, override)
    expect(result).toEqual({ a: 1 })
  })

  it('override array replaces base object (type change)', () => {
    const base = { a: { nested: true } } as Record<string, unknown>
    const override = { a: [1, 2, 3] } as Record<string, unknown>
    const result = deepMerge(base, override)
    expect(result.a).toEqual([1, 2, 3])
  })
})

// ============================================================================
// coerceValue
// ============================================================================

describe('coerceValue', () => {
  it('coerces "true" to boolean true', () => {
    expect(coerceValue('true')).toBe(true)
  })

  it('coerces "false" to boolean false', () => {
    expect(coerceValue('false')).toBe(false)
  })

  it('coerces numeric strings to numbers', () => {
    expect(coerceValue('42')).toBe(42)
    expect(coerceValue('3.14')).toBe(3.14)
    expect(coerceValue('0')).toBe(0)
    expect(coerceValue('-5')).toBe(-5)
  })

  it('coerces JSON arrays', () => {
    const result = coerceValue('["a","b","c"]')
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('coerces JSON objects', () => {
    const result = coerceValue('{"key":"value"}')
    expect(result).toEqual({ key: 'value' })
  })

  it('returns string for invalid JSON that looks like array', () => {
    const result = coerceValue('[not valid json')
    expect(result).toBe('[not valid json')
  })

  it('returns string for invalid JSON that looks like object', () => {
    const result = coerceValue('{not valid json')
    expect(result).toBe('{not valid json')
  })

  it('strips double quotes from quoted strings', () => {
    expect(coerceValue('"hello"')).toBe('hello')
  })

  it('strips single quotes from quoted strings', () => {
    expect(coerceValue("'hello'")).toBe('hello')
  })

  it('returns plain strings as-is', () => {
    expect(coerceValue('hello')).toBe('hello')
    expect(coerceValue('some value')).toBe('some value')
  })

  it('does not coerce empty string to number', () => {
    expect(coerceValue('')).toBe('')
  })

  it('handles strings that look numeric but are not (NaN check)', () => {
    // "NaN" as a string - Number("NaN") is NaN
    expect(coerceValue('NaN')).toBe('NaN')
  })

  it('coerces negative decimals', () => {
    expect(coerceValue('-3.14')).toBe(-3.14)
  })
})

// ============================================================================
// setNestedValue
// ============================================================================

describe('setNestedValue', () => {
  it('sets a top-level value', () => {
    const obj: Record<string, unknown> = {}
    setNestedValue(obj, ['key'], 'value')
    expect(obj.key).toBe('value')
  })

  it('sets a nested value', () => {
    const obj: Record<string, unknown> = {}
    setNestedValue(obj, ['logging', 'level'], 'debug')
    expect(obj).toEqual({ logging: { level: 'debug' } })
  })

  it('sets a deeply nested value', () => {
    const obj: Record<string, unknown> = {}
    setNestedValue(obj, ['a', 'b', 'c', 'd'], 42)
    expect(obj).toEqual({ a: { b: { c: { d: 42 } } } })
  })

  it('preserves existing nested values', () => {
    const obj: Record<string, unknown> = { logging: { level: 'info', format: 'json' } }
    setNestedValue(obj, ['logging', 'level'], 'debug')
    expect(obj).toEqual({ logging: { level: 'debug', format: 'json' } })
  })

  it('overwrites non-object intermediate values', () => {
    const obj: Record<string, unknown> = { a: 'string-value' }
    setNestedValue(obj, ['a', 'b'], 'nested')
    expect(obj).toEqual({ a: { b: 'nested' } })
  })

  it('overwrites null intermediate values', () => {
    const obj: Record<string, unknown> = { a: null }
    setNestedValue(obj, ['a', 'b'], 'nested')
    expect(obj).toEqual({ a: { b: 'nested' } })
  })

  it('handles single-element path', () => {
    const obj: Record<string, unknown> = { existing: true }
    setNestedValue(obj, ['newKey'], 'newValue')
    expect(obj).toEqual({ existing: true, newKey: 'newValue' })
  })

  it('sets array values', () => {
    const obj: Record<string, unknown> = {}
    setNestedValue(obj, ['items'], [1, 2, 3])
    expect(obj.items).toEqual([1, 2, 3])
  })

  it('sets object values', () => {
    const obj: Record<string, unknown> = {}
    setNestedValue(obj, ['config'], { key: 'value' })
    expect(obj.config).toEqual({ key: 'value' })
  })
})
