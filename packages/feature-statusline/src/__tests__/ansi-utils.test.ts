import { describe, expect, it } from 'vitest'
import { stripAnsi, visibleLength } from '../ansi-utils.js'

describe('stripAnsi', () => {
  it('strips color codes', () => {
    expect(stripAnsi('\x1b[31mhello\x1b[0m')).toBe('hello')
  })

  it('strips bold/italic/dim codes', () => {
    expect(stripAnsi('\x1b[1mbold\x1b[22m \x1b[3mitalic\x1b[23m')).toBe('bold italic')
  })

  it('returns plain text unchanged', () => {
    expect(stripAnsi('hello world')).toBe('hello world')
  })

  it('handles empty string', () => {
    expect(stripAnsi('')).toBe('')
  })

  it('handles multiple color codes in sequence', () => {
    expect(stripAnsi('\x1b[34m\x1b[1mblue bold\x1b[0m')).toBe('blue bold')
  })
})

describe('visibleLength', () => {
  it('returns length of plain text', () => {
    expect(visibleLength('hello')).toBe(5)
  })

  it('excludes ANSI codes from length', () => {
    expect(visibleLength('\x1b[31mhello\x1b[0m')).toBe(5)
  })

  it('returns 0 for empty string', () => {
    expect(visibleLength('')).toBe(0)
  })
})
