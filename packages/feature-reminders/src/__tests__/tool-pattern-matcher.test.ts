import { describe, it, expect } from 'vitest'
import { matchesToolPattern, findMatchingPattern } from '../tool-pattern-matcher.js'
import type { ToolPattern } from '../types.js'

describe('matchesToolPattern', () => {
  // Exact matches
  it('matches exact command', () => {
    expect(matchesToolPattern('pnpm build', 'pnpm build')).toBe(true)
  })

  it('matches single-token tool', () => {
    expect(matchesToolPattern('vitest', 'vitest')).toBe(true)
  })

  // Anchored first token
  it('rejects when first token differs', () => {
    expect(matchesToolPattern('echo pnpm build', 'pnpm build')).toBe(false)
  })

  it('rejects arbitrary words containing pattern tokens', () => {
    expect(matchesToolPattern('this contains pnpm and build', 'pnpm build')).toBe(false)
  })

  // Subsequence matching (skipping flags)
  it('matches pnpm with --filter flag between manager and subcommand', () => {
    expect(matchesToolPattern('pnpm --filter @sidekick/core build', 'pnpm build')).toBe(true)
  })

  it('matches pnpm with --filter and extra trailing args', () => {
    expect(matchesToolPattern('pnpm --filter @sidekick/core test -- --exclude foo', 'pnpm test')).toBe(true)
  })

  it('matches with multiple flags between anchors', () => {
    expect(matchesToolPattern('pnpm --filter foo --recursive build --verbose', 'pnpm build')).toBe(true)
  })

  // Wildcard matching
  it('matches wildcard pattern for workspace name', () => {
    expect(matchesToolPattern('pnpm --filter @sidekick/core build', 'pnpm --filter * build')).toBe(true)
  })

  it('matches yarn workspace wildcard', () => {
    expect(matchesToolPattern('yarn workspace my-pkg test', 'yarn workspace * test')).toBe(true)
  })

  // Trailing args (ignored)
  it('matches when command has trailing args', () => {
    expect(matchesToolPattern('pnpm test -- --run src/foo.test.ts', 'pnpm test')).toBe(true)
  })

  it('matches single tool with trailing file arg', () => {
    expect(matchesToolPattern('vitest src/foo.test.ts', 'vitest')).toBe(true)
  })

  // Chained commands
  it('matches in second segment of && chain', () => {
    expect(matchesToolPattern('pnpm build && pnpm test', 'pnpm test')).toBe(true)
  })

  it('matches in first segment of && chain', () => {
    expect(matchesToolPattern('pnpm build && pnpm test', 'pnpm build')).toBe(true)
  })

  it('matches across || operator', () => {
    expect(matchesToolPattern('pnpm build || echo failed', 'pnpm build')).toBe(true)
  })

  it('matches across ; operator', () => {
    expect(matchesToolPattern('pnpm build; pnpm lint', 'pnpm lint')).toBe(true)
  })

  // Non-matches
  it('rejects different package manager', () => {
    expect(matchesToolPattern('npm run build', 'pnpm build')).toBe(false)
  })

  it('rejects when subcommand is absent', () => {
    expect(matchesToolPattern('pnpm install', 'pnpm build')).toBe(false)
  })

  it('rejects empty command', () => {
    expect(matchesToolPattern('', 'pnpm build')).toBe(false)
  })

  it('rejects empty pattern', () => {
    expect(matchesToolPattern('pnpm build', '')).toBe(false)
  })

  // Multi-token tool patterns
  it('matches tsc --noEmit with extra flags', () => {
    expect(matchesToolPattern('tsc --noEmit --pretty', 'tsc --noEmit')).toBe(true)
  })

  it('matches python -m pytest', () => {
    expect(matchesToolPattern('python -m pytest tests/', 'python -m pytest')).toBe(true)
  })

  it('matches cmake --build with path', () => {
    expect(matchesToolPattern('cmake --build ./build', 'cmake --build')).toBe(true)
  })
})

describe('findMatchingPattern', () => {
  const patterns: ToolPattern[] = [
    { tool_id: 'pnpm-build', tool: 'pnpm build', scope: 'project' },
    { tool_id: 'pnpm-filter-build', tool: 'pnpm --filter * build', scope: 'package' },
    { tool_id: 'disabled', tool: null, scope: 'project' },
  ]

  it('returns first matching pattern', () => {
    const match = findMatchingPattern('pnpm build', patterns)
    expect(match?.tool_id).toBe('pnpm-build')
    expect(match?.scope).toBe('project')
  })

  it('matches the more specific pattern when applicable', () => {
    const match = findMatchingPattern('pnpm --filter foo build', patterns)
    expect(match).toBeDefined()
  })

  it('returns null for no match', () => {
    const match = findMatchingPattern('yarn build', patterns)
    expect(match).toBeNull()
  })

  it('skips disabled patterns (tool: null)', () => {
    const match = findMatchingPattern('disabled', [{ tool_id: 'x', tool: null, scope: 'project' }])
    expect(match).toBeNull()
  })
})
