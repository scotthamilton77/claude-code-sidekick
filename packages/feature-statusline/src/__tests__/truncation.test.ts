import { describe, expect, it } from 'vitest'
import { truncateSuffix, truncatePrefix, truncatePath } from '../truncation.js'

describe('truncateSuffix', () => {
  it('returns string as-is when under limit', () => {
    expect(truncateSuffix('hello', 10)).toBe('hello')
  })

  it('truncates with trailing ellipsis', () => {
    expect(truncateSuffix('claude-code-sidekick', 15)).toBe('claude-code-si…')
  })

  it('handles maxLength of 1', () => {
    expect(truncateSuffix('hello', 1)).toBe('…')
  })

  it('handles exact length', () => {
    expect(truncateSuffix('hello', 5)).toBe('hello')
  })

  it('handles ANSI-colored input (measures visible width)', () => {
    const colored = '\x1b[31mhello\x1b[0m'
    // "hello" is 5 visible chars, should not truncate at maxLength=5
    expect(truncateSuffix(colored, 5)).toBe(colored)
  })
})

describe('truncatePrefix', () => {
  it('returns string as-is when under limit', () => {
    expect(truncatePrefix('hello', 10)).toBe('hello')
  })

  it('truncates with leading ellipsis', () => {
    expect(truncatePrefix('claude-code-sidekick', 15)).toBe('…-code-sidekick')
  })

  it('handles maxLength of 1', () => {
    expect(truncatePrefix('hello', 1)).toBe('…')
  })

  it('handles exact length', () => {
    expect(truncatePrefix('hello', 5)).toBe('hello')
  })
})

describe('truncatePath', () => {
  it('returns path as-is when under limit', () => {
    expect(truncatePath('project/src', 20)).toBe('project/src')
  })

  it('two segments: left-truncates first segment', () => {
    // "claude-code-sidekick/src" = 24 chars
    expect(truncatePath('claude-code-sidekick/src', 15)).toBe('…e-sidekick/src')
  })

  it('3+ segments: uses first/…/last', () => {
    expect(truncatePath('project/packages/core/src', 20)).toBe('project/…/src')
  })

  it('3+ segments: left-truncates first when still too long', () => {
    expect(truncatePath('claude-code-sidekick/packages/core/src', 20)).toBe('…code-sidekick/…/src')
  })

  it('handles single segment (no slashes)', () => {
    expect(truncatePath('claude-code-sidekick', 10)).toBe('…-sidekick')
  })

  it('handles single segment that fits', () => {
    expect(truncatePath('project', 10)).toBe('project')
  })

  it('falls back to prefix-truncate when first segment has no room in 3+ segment path', () => {
    // With very small maxLength, the fixed part "/…/last" leaves no room for first segment
    // This triggers the availableForFirst <= 1 branch
    expect(truncatePath('aaa/bbb/ccc', 5)).toBe('…/ccc')
  })
})
