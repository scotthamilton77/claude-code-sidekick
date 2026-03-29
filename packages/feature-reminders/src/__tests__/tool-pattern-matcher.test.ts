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

  // Whitespace handling
  it('matches pattern with leading/trailing whitespace', () => {
    expect(matchesToolPattern('pnpm build', '  pnpm build  ')).toBe(true)
  })

  it('rejects whitespace-only pattern', () => {
    expect(matchesToolPattern('pnpm build', '   ')).toBe(false)
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

  // Runner-aware matching (unanchored when runner prefix detected)
  const runners = [
    { prefix: 'uv run' },
    { prefix: 'npx' },
    { prefix: 'poetry run' },
    { prefix: 'pnpm dlx' },
    { prefix: 'pnpm exec' },
    { prefix: 'bundle exec' },
    { prefix: 'dotnet tool run' },
  ]

  it('matches single-token tool through runner', () => {
    expect(matchesToolPattern('uv run mypy --strict', 'mypy', runners)).toBe(true)
  })

  it('matches single-token tool through single-token runner', () => {
    expect(matchesToolPattern('npx jest src/', 'jest', runners)).toBe(true)
  })

  it('matches multi-token tool through runner', () => {
    expect(matchesToolPattern('uv run python -m pytest tests/', 'python -m pytest', runners)).toBe(true)
  })

  it('matches tool through runner with flags between', () => {
    expect(matchesToolPattern('uv run --python 3.11 mypy --strict', 'mypy', runners)).toBe(true)
  })

  it('matches longest runner prefix (pnpm dlx beats pnpm)', () => {
    expect(matchesToolPattern('pnpm dlx jest src/', 'jest', runners)).toBe(true)
  })

  it('matches wildcard pattern through runner', () => {
    expect(matchesToolPattern('npx pnpm --filter @scope/pkg build', 'pnpm --filter * build', runners)).toBe(true)
  })

  it('does not false-positive on tool name as substring in flag value', () => {
    expect(matchesToolPattern('uv run sometool --formatter=mypy', 'mypy', runners)).toBe(false)
  })

  it('does not false-positive on tool name as partial token', () => {
    expect(matchesToolPattern('uv run mypy123', 'mypy', runners)).toBe(false)
  })

  it('matches runner-wrapped command in chained segments', () => {
    expect(matchesToolPattern('uv run mypy src/ && uv run pytest tests/', 'pytest', runners)).toBe(true)
  })

  it('matches runner-wrapped command in chained segments (first segment)', () => {
    expect(matchesToolPattern('uv run mypy src/ && uv run pytest tests/', 'mypy', runners)).toBe(true)
  })

  it('still uses anchored matching when no runner matches', () => {
    expect(matchesToolPattern('echo mypy', 'mypy', runners)).toBe(false)
  })

  it('still uses anchored matching when runners is empty', () => {
    expect(matchesToolPattern('uv run mypy', 'mypy', [])).toBe(false)
  })

  it('still uses anchored matching when runners is undefined', () => {
    expect(matchesToolPattern('uv run mypy', 'mypy')).toBe(false)
  })

  it('matches 3-token runner prefix', () => {
    expect(matchesToolPattern('dotnet tool run formatter --check', 'formatter', runners)).toBe(true)
  })

  it('does not match runner prefix as a substring of first token', () => {
    expect(matchesToolPattern('npxtra jest', 'jest', runners)).toBe(false)
  })
})

describe('findMatchingPattern', () => {
  // Order matters: specific workspace patterns must precede generic ones
  // (mirrors DEFAULT_VERIFICATION_TOOLS in types.ts)
  const patterns: ToolPattern[] = [
    { tool_id: 'pnpm-filter-build', tool: 'pnpm --filter * build', scope: 'package' },
    { tool_id: 'pnpm-build', tool: 'pnpm build', scope: 'project' },
    { tool_id: 'disabled', tool: null, scope: 'project' },
  ]

  it('returns first matching pattern', () => {
    const match = findMatchingPattern('pnpm build', patterns)
    expect(match?.tool_id).toBe('pnpm-build')
    expect(match?.scope).toBe('project')
  })

  it('matches workspace-scoped pattern with correct scope for filtered commands', () => {
    const match = findMatchingPattern('pnpm --filter foo build', patterns)
    expect(match?.tool_id).toBe('pnpm-filter-build')
    expect(match?.scope).toBe('package')
  })

  it('returns null for no match', () => {
    const match = findMatchingPattern('yarn build', patterns)
    expect(match).toBeNull()
  })

  it('skips disabled patterns (tool: null)', () => {
    const match = findMatchingPattern('disabled', [{ tool_id: 'x', tool: null, scope: 'project' }])
    expect(match).toBeNull()
  })

  it('matches through runner when runners are provided', () => {
    const runners = [{ prefix: 'uv run' }]
    const match = findMatchingPattern('uv run pnpm build', patterns, runners)
    expect(match?.tool_id).toBe('pnpm-build')
  })

  it('falls back to anchored matching when no runner matches', () => {
    const runners = [{ prefix: 'uv run' }]
    const match = findMatchingPattern('pnpm build', patterns, runners)
    expect(match?.tool_id).toBe('pnpm-build')
  })
})
