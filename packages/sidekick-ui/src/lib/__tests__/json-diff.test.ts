/**
 * Tests for json-diff utility.
 *
 * Verifies generic diff computation for any JSON structure using microdiff.
 */

import { describe, it, expect } from 'vitest'
import { computeDiff, isEqual } from '../json-diff'

describe('computeDiff', () => {
  it('detects no changes when objects are identical', () => {
    const obj = { a: 1, b: 'hello', c: true }
    const result = computeDiff(obj, obj)
    expect(result).toEqual([])
  })

  it('detects added properties', () => {
    const prev = { a: 1 }
    const curr = { a: 1, b: 2 }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'add',
      path: 'b',
      newValue: 2,
    })
    expect(result[0].oldValue).toBeUndefined()
  })

  it('detects removed properties', () => {
    const prev = { a: 1, b: 2 }
    const curr = { a: 1 }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'remove',
      path: 'b',
      oldValue: 2,
    })
    expect(result[0].newValue).toBeUndefined()
  })

  it('detects modified properties', () => {
    const prev = { a: 1, b: 'old' }
    const curr = { a: 1, b: 'new' }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'modify',
      path: 'b',
      oldValue: 'old',
      newValue: 'new',
    })
  })

  it('handles nested object changes', () => {
    const prev = { user: { name: 'Alice', age: 30 } }
    const curr = { user: { name: 'Alice', age: 31 } }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'modify',
      path: 'user.age',
      oldValue: 30,
      newValue: 31,
    })
  })

  it('handles deeply nested changes', () => {
    const prev = { a: { b: { c: { d: 1 } } } }
    const curr = { a: { b: { c: { d: 2 } } } }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'modify',
      path: 'a.b.c.d',
      oldValue: 1,
      newValue: 2,
    })
  })

  it('handles array changes with index notation', () => {
    const prev = { items: ['a', 'b', 'c'] }
    const curr = { items: ['a', 'x', 'c'] }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'modify',
      path: 'items[1]',
      oldValue: 'b',
      newValue: 'x',
    })
  })

  it('handles array additions', () => {
    const prev = { items: ['a', 'b'] }
    const curr = { items: ['a', 'b', 'c'] }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'add',
      path: 'items[2]',
      newValue: 'c',
    })
  })

  it('handles array removals', () => {
    const prev = { items: ['a', 'b', 'c'] }
    const curr = { items: ['a', 'b'] }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'remove',
      path: 'items[2]',
      oldValue: 'c',
    })
  })

  it('handles nested array with object changes', () => {
    const prev = { users: [{ name: 'Alice', age: 30 }] }
    const curr = { users: [{ name: 'Alice', age: 31 }] }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject({
      type: 'modify',
      path: 'users[0].age',
      oldValue: 30,
      newValue: 31,
    })
  })

  it('handles multiple simultaneous changes', () => {
    const prev = {
      a: 1,
      b: 'old',
      c: { nested: 10 },
      removed: true,
    }
    const curr = {
      a: 1,
      b: 'new',
      c: { nested: 20 },
      added: 'value',
    }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(4)

    const changes = new Map(result.map((r) => [r.path, r]))

    expect(changes.get('b')).toMatchObject({
      type: 'modify',
      oldValue: 'old',
      newValue: 'new',
    })

    expect(changes.get('c.nested')).toMatchObject({
      type: 'modify',
      oldValue: 10,
      newValue: 20,
    })

    expect(changes.get('removed')).toMatchObject({
      type: 'remove',
      oldValue: true,
    })

    expect(changes.get('added')).toMatchObject({
      type: 'add',
      newValue: 'value',
    })
  })

  it('handles null and undefined values', () => {
    const prev = { a: null, b: undefined, c: 1 }
    const curr = { a: 'value', b: null, c: 1 }
    const result = computeDiff(prev, curr)

    expect(result.length).toBeGreaterThan(0)

    const aChange = result.find((r) => r.path === 'a')
    expect(aChange).toMatchObject({
      type: 'modify',
      oldValue: null,
      newValue: 'value',
    })
  })

  it('handles empty objects', () => {
    const result = computeDiff({}, {})
    expect(result).toEqual([])
  })

  it('handles transition from empty to populated', () => {
    const prev = {}
    const curr = { a: 1, b: 2 }
    const result = computeDiff(prev, curr)

    expect(result).toHaveLength(2)
    expect(result.every((r) => r.type === 'add')).toBe(true)
  })

  it('includes raw microdiff type in output', () => {
    const prev = { a: 1 }
    const curr = { a: 2 }
    const result = computeDiff(prev, curr)

    expect(result[0]).toHaveProperty('rawType')
    expect(result[0].rawType).toBe('CHANGE')
  })

  it('categorizes CREATE as add', () => {
    const prev = {}
    const curr = { new: 'field' }
    const result = computeDiff(prev, curr)

    expect(result[0].type).toBe('add')
    expect(result[0].rawType).toBe('CREATE')
  })

  it('categorizes REMOVE as remove', () => {
    const prev = { old: 'field' }
    const curr = {}
    const result = computeDiff(prev, curr)

    expect(result[0].type).toBe('remove')
    expect(result[0].rawType).toBe('REMOVE')
  })

  it('categorizes CHANGE as modify', () => {
    const prev = { field: 'old' }
    const curr = { field: 'new' }
    const result = computeDiff(prev, curr)

    expect(result[0].type).toBe('modify')
    expect(result[0].rawType).toBe('CHANGE')
  })
})

describe('isEqual', () => {
  it('returns true for identical objects', () => {
    const obj = { a: 1, b: { c: 2 } }
    expect(isEqual(obj, obj)).toBe(true)
  })

  it('returns true for structurally equal objects', () => {
    const obj1 = { a: 1, b: 'hello', c: [1, 2, 3] }
    const obj2 = { a: 1, b: 'hello', c: [1, 2, 3] }
    expect(isEqual(obj1, obj2)).toBe(true)
  })

  it('returns false for different objects', () => {
    const obj1 = { a: 1 }
    const obj2 = { a: 2 }
    expect(isEqual(obj1, obj2)).toBe(false)
  })

  it('returns false for objects with different keys', () => {
    const obj1 = { a: 1 }
    const obj2 = { b: 1 }
    expect(isEqual(obj1, obj2)).toBe(false)
  })

  it('handles nested equality', () => {
    const obj1 = { user: { name: 'Alice', age: 30 } }
    const obj2 = { user: { name: 'Alice', age: 30 } }
    expect(isEqual(obj1, obj2)).toBe(true)
  })

  it('handles array equality', () => {
    const arr1 = [1, 2, { a: 3 }]
    const arr2 = [1, 2, { a: 3 }]
    expect(isEqual(arr1, arr2)).toBe(true)
  })

  it('handles empty objects', () => {
    expect(isEqual({}, {})).toBe(true)
  })
})
