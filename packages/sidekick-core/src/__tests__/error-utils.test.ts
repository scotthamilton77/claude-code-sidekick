import { describe, it, expect } from 'vitest'
import { toErrorMessage } from '../error-utils.js'

describe('toErrorMessage', () => {
  it('returns .message for Error instances', () => {
    expect(toErrorMessage(new Error('boom'))).toBe('boom')
  })

  it('returns .message for Error subclasses', () => {
    expect(toErrorMessage(new TypeError('bad type'))).toBe('bad type')
    expect(toErrorMessage(new RangeError('out of range'))).toBe('out of range')
  })

  it('returns the string itself for string values', () => {
    expect(toErrorMessage('something went wrong')).toBe('something went wrong')
  })

  it('returns String() representation for numbers', () => {
    expect(toErrorMessage(42)).toBe('42')
    expect(toErrorMessage(0)).toBe('0')
    expect(toErrorMessage(NaN)).toBe('NaN')
  })

  it('returns String() representation for null and undefined', () => {
    expect(toErrorMessage(null)).toBe('null')
    expect(toErrorMessage(undefined)).toBe('undefined')
  })

  it('returns String() representation for objects', () => {
    expect(toErrorMessage({ key: 'value' })).toBe('[object Object]')
  })

  it('returns String() representation for booleans', () => {
    expect(toErrorMessage(true)).toBe('true')
    expect(toErrorMessage(false)).toBe('false')
  })
})
