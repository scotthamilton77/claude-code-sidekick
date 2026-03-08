# Statusline Template Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enhance the statusline template system with per-token truncation, responsive line wrapping, worktree-aware tokens, and visible-width measurement.

**Architecture:** The formatter's template parser gains attribute handling for `maxLength`, `truncateStyle`, `wrapAt`, and `wrapPrefix`/`wrapSuffix`. Three truncation strategies (`suffix`, `prefix`, `path`) are implemented as pure functions. New tokens (`projectDirShort`, `projectDirFull`, `worktreeName`, `worktreeOrBranch`) are populated from Claude Code's hook input `worktree` object. The `{branch}` token becomes raw (no baked-in icon). Width measurement strips ANSI codes to count visible characters only.

**Tech Stack:** TypeScript, Vitest, Zod (config schemas)

**Design doc:** `docs/plans/2026-03-08-statusline-template-enhancements-design.md`

---

### Task 1: ANSI Strip Utility and Visible Width Measurement

Pure utility function — no dependencies on other tasks.

**Files:**
- Create: `packages/feature-statusline/src/ansi-utils.ts`
- Test: `packages/feature-statusline/src/__tests__/ansi-utils.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/feature-statusline/src/__tests__/ansi-utils.test.ts
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
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run ansi-utils`
Expected: FAIL — module not found

**Step 3: Implement**

```typescript
// packages/feature-statusline/src/ansi-utils.ts
/**
 * ANSI escape code utilities for visible-width measurement.
 */

// Matches all ANSI escape sequences (CSI sequences, OSC, etc.)
const ANSI_REGEX = /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*\x07/g

/** Strip ANSI escape codes from a string. */
export function stripAnsi(str: string): string {
  return str.replace(ANSI_REGEX, '')
}

/** Get visible character length (excluding ANSI codes). */
export function visibleLength(str: string): number {
  return stripAnsi(str).length
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run ansi-utils`
Expected: PASS

**Step 5: Export from index**

Add export to `packages/feature-statusline/src/index.ts`:
```typescript
export { stripAnsi, visibleLength } from './ansi-utils.js'
```

**Step 6: Commit**

```
git add packages/feature-statusline/src/ansi-utils.ts packages/feature-statusline/src/__tests__/ansi-utils.test.ts packages/feature-statusline/src/index.ts
git commit -m "feat(statusline): add ANSI strip utility and visible width measurement"
```

---

### Task 2: Truncation Strategies

Three pure truncation functions. Depends on Task 1 (uses `visibleLength`).

**Files:**
- Create: `packages/feature-statusline/src/truncation.ts`
- Test: `packages/feature-statusline/src/__tests__/truncation.test.ts`

**Step 1: Write failing tests**

```typescript
// packages/feature-statusline/src/__tests__/truncation.test.ts
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
    expect(truncatePrefix('claude-code-sidekick', 15)).toBe('…ode-sidekick')
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
    expect(truncatePath('claude-code-sidekick/packages/core/src', 20)).toBe('…de-sidekick/…/src')
  })

  it('handles single segment (no slashes)', () => {
    expect(truncatePath('claude-code-sidekick', 10)).toBe('…-sidekick')
  })

  it('handles single segment that fits', () => {
    expect(truncatePath('project', 10)).toBe('project')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run truncation`
Expected: FAIL — module not found

**Step 3: Implement**

```typescript
// packages/feature-statusline/src/truncation.ts
/**
 * Truncation strategies for statusline token values.
 *
 * All strategies measure visible width (ANSI codes excluded).
 */

import { stripAnsi, visibleLength } from './ansi-utils.js'

/**
 * Right-truncate with trailing ellipsis.
 * "claude-code-sidekick" → "claude-code-si…" (maxLength=15)
 */
export function truncateSuffix(str: string, maxLength: number): string {
  if (visibleLength(str) <= maxLength) return str
  // For ANSI strings, strip first, truncate, add ellipsis
  const plain = stripAnsi(str)
  if (maxLength <= 1) return '…'
  return plain.slice(0, maxLength - 1) + '…'
}

/**
 * Left-truncate with leading ellipsis.
 * "claude-code-sidekick" → "…ode-sidekick" (maxLength=15)
 */
export function truncatePrefix(str: string, maxLength: number): string {
  if (visibleLength(str) <= maxLength) return str
  const plain = stripAnsi(str)
  if (maxLength <= 1) return '…'
  return '…' + plain.slice(-(maxLength - 1))
}

/**
 * Path-aware truncation:
 * 1. If fits, return as-is
 * 2. Two segments: left-truncate until it fits
 * 3. 3+ segments: first/…/last, left-truncate first if still too long
 */
export function truncatePath(str: string, maxLength: number): string {
  const plain = stripAnsi(str)
  if (plain.length <= maxLength) return str

  const parts = plain.split('/')

  // Single segment — fall back to prefix truncation
  if (parts.length === 1) {
    return truncatePrefix(plain, maxLength)
  }

  // Two segments — left-truncate the combined string
  if (parts.length === 2) {
    return truncatePrefix(plain, maxLength)
  }

  // 3+ segments: first/…/last
  const first = parts[0]
  const last = parts[parts.length - 1]
  const candidate = `${first}/…/${last}`

  if (candidate.length <= maxLength) {
    return candidate
  }

  // Left-truncate the first segment to fit
  // Format: …<truncated-first>/…/<last>
  // We need: ellipsis + partial-first + "/…/" + last <= maxLength
  const fixedPart = `/…/${last}`
  const availableForFirst = maxLength - fixedPart.length
  if (availableForFirst <= 1) {
    // Not enough room for first segment — just prefix-truncate the whole thing
    return truncatePrefix(plain, maxLength)
  }
  const truncatedFirst = truncatePrefix(first, availableForFirst)
  return `${truncatedFirst}${fixedPart}`
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run truncation`
Expected: PASS

**Step 5: Export from index**

Add export to `packages/feature-statusline/src/index.ts`:
```typescript
export { truncateSuffix, truncatePrefix, truncatePath } from './truncation.js'
```

**Step 6: Commit**

```
git add packages/feature-statusline/src/truncation.ts packages/feature-statusline/src/__tests__/truncation.test.ts packages/feature-statusline/src/index.ts
git commit -m "feat(statusline): add suffix, prefix, and path truncation strategies"
```

---

### Task 3: Add Worktree Type to Hook Input

Add the `worktree` object to `ClaudeCodeStatusInput` and pass it through the service. No behavior change — just plumbing.

**Files:**
- Modify: `packages/feature-statusline/src/statusline-service.ts:176-197` (ClaudeCodeStatusInput interface)
- Modify: `packages/sidekick-cli/src/commands/statusline.ts:67-144` (parseStatuslineInput)

**Step 1: Add worktree type to ClaudeCodeStatusInput**

In `packages/feature-statusline/src/statusline-service.ts`, after the `context_window` field in `ClaudeCodeStatusInput` (line 196), add:

```typescript
  /** Worktree information (present only when session is in a git worktree) */
  worktree?: ClaudeCodeWorktree
```

Add new interface before `ClaudeCodeStatusInput`:

```typescript
/**
 * Worktree information from Claude Code status hook.
 * Present only when the session is running inside a git worktree.
 */
export interface ClaudeCodeWorktree {
  /** Worktree name */
  name: string
  /** Full path to worktree directory */
  path: string
  /** Branch name in the worktree */
  branch: string
  /** Original working directory (main repo root) */
  original_cwd: string
  /** Branch name of the original repo */
  original_branch: string
}
```

**Step 2: Parse worktree in CLI**

In `packages/sidekick-cli/src/commands/statusline.ts`, in `parseStatuslineInput`, after the `context_window` field in the return object, add worktree parsing:

```typescript
    // Parse optional worktree data (only present in worktree sessions)
    worktree: raw.worktree
      ? (() => {
          const wt = raw.worktree as Record<string, unknown>
          return {
            name: typeof wt.name === 'string' ? wt.name : '',
            path: typeof wt.path === 'string' ? wt.path : '',
            branch: typeof wt.branch === 'string' ? wt.branch : '',
            original_cwd: typeof wt.original_cwd === 'string' ? wt.original_cwd : '',
            original_branch: typeof wt.original_branch === 'string' ? wt.original_branch : '',
          }
        })()
      : undefined,
```

**Step 3: Export the new type**

In `packages/feature-statusline/src/index.ts`, add `ClaudeCodeWorktree` to exports.

**Step 4: Commit**

```
git add packages/feature-statusline/src/statusline-service.ts packages/sidekick-cli/src/commands/statusline.ts packages/feature-statusline/src/index.ts
git commit -m "feat(statusline): add worktree type to ClaudeCodeStatusInput"
```

---

### Task 4: New Tokens and Raw Branch

Add new view model fields, populate them from hook input, and make `{branch}` raw.

**Files:**
- Modify: `packages/feature-statusline/src/types.ts:206-251` (StatuslineViewModel)
- Modify: `packages/feature-statusline/src/formatter.ts:119-139` (token map in `format()`)
- Modify: `packages/feature-statusline/src/formatter.ts:339-359` (formatCwd, formatBranch)
- Modify: `packages/feature-statusline/src/statusline-service.ts:850-860` (view model building)

**Step 1: Write failing tests**

Add to `packages/feature-statusline/src/__tests__/statusline.test.ts`:

```typescript
describe('new tokens', () => {
  describe('projectDirShort', () => {
    it('uses basename of workspace.project_dir in normal session', () => {
      // Test via view model — projectDirShort should be populated
    })

    it('uses basename of worktree.original_cwd in worktree session', () => {
      // Test via view model — projectDirShort should use original repo name
    })
  })

  describe('worktreeOrBranch', () => {
    it('returns branch name in normal session', () => {
      // view model worktreeOrBranch should be raw branch name
    })

    it('returns worktree name in worktree session', () => {
      // view model worktreeOrBranch should be worktree name
    })
  })

  describe('branch (raw)', () => {
    it('returns raw branch name without icon', () => {
      expect(formatBranch('main')).toBe('main')
    })

    it('returns empty string for empty branch', () => {
      expect(formatBranch('')).toBe('')
    })
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run statusline`
Expected: FAIL

**Step 3: Update StatuslineViewModel**

In `packages/feature-statusline/src/types.ts`, add to `StatuslineViewModel`:

```typescript
  /** Project directory basename (e.g., "claude-code-sidekick") */
  projectDirShort: string
  /** Project directory full path, home-shortened (e.g., "~/src/projects/claude-code-sidekick") */
  projectDirFull: string
  /** Worktree name (empty if not in worktree) */
  worktreeName: string
  /** Worktree name if in worktree, else raw branch name */
  worktreeOrBranch: string
```

**Step 4: Update formatBranch to be raw**

In `packages/feature-statusline/src/formatter.ts`, change `formatBranch`:

```typescript
export function formatBranch(branch: string): string {
  return branch
}
```

Remove the `symbolMode` parameter and icon logic.

**Step 5: Update formatCwd to return full home-shortened path**

Change `formatCwd` to just do home-shortening (no truncation or icon):

```typescript
export function formatCwd(fullPath: string, homeDir?: string): string {
  if (homeDir && fullPath.startsWith(homeDir)) {
    return '~' + fullPath.slice(homeDir.length)
  }
  return fullPath
}
```

**Step 6: Update view model building in statusline-service.ts**

In `StatuslineService.render()` (around line 858), update the view model to include new tokens:

```typescript
const worktree = this.hookInput?.worktree
const projectRoot = worktree?.original_cwd ?? this.hookInput?.workspace?.project_dir ?? this.cwd
const projectDirShort = path.basename(projectRoot)
const homeShorten = (p: string) => this.homeDir && p.startsWith(this.homeDir) ? '~' + p.slice(this.homeDir.length) : p

// ... in viewModel:
cwd: formatCwd(this.cwd, this.homeDir),
branch: formatBranch(branch),
projectDirShort,
projectDirFull: homeShorten(projectRoot),
worktreeName: worktree?.name ?? '',
worktreeOrBranch: worktree?.name ?? branch,
```

**Step 7: Update token map in Formatter.format()**

In `packages/feature-statusline/src/formatter.ts`, add new tokens to the `tokens` map:

```typescript
projectDirShort: this.colorize(viewModel.projectDirShort, this.theme.colors.cwd),
projectDirFull: this.colorize(viewModel.projectDirFull, this.theme.colors.cwd),
worktreeName: viewModel.worktreeName ? this.colorize(viewModel.worktreeName, branchColor) : '',
worktreeOrBranch: this.colorize(viewModel.worktreeOrBranch, branchColor),
```

Also update `branch` token — remove the leading space (it was compensating for the icon):

```typescript
branch: viewModel.branch ? this.colorize(viewModel.branch, branchColor) : '',
```

**Step 8: Fix all existing tests**

Existing tests reference `formatBranch(branch, symbolMode)` and `formatCwd(path, homeDir, symbolMode)`. Update call sites:
- `formatBranch('main', 'full')` → `formatBranch('main')`
- `formatCwd(path, homeDir, 'full')` → `formatCwd(path, homeDir)`
- Update expected values: `'⎇ main'` → `'main'`
- Update view model assertions to include new fields

**Step 9: Run tests**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run statusline`
Expected: PASS

**Step 10: Commit**

```
git add packages/feature-statusline/src/
git commit -m "feat(statusline): add projectDirShort, worktreeName, worktreeOrBranch tokens; make branch raw"
```

---

### Task 5: Template Parser — maxLength and truncateStyle Attributes

Enhance the template regex and replacement logic in `Formatter.format()` to support `maxLength` and `truncateStyle`.

**Files:**
- Modify: `packages/feature-statusline/src/formatter.ts:147-173` (template replacement in `format()`)
- Test: `packages/feature-statusline/src/__tests__/statusline.test.ts`

**Step 1: Write failing tests**

Add to test file, in a new `describe('template truncation')` block:

```typescript
describe('template truncation', () => {
  it('applies suffix truncation with maxLength', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: false })
    const viewModel = createMinimalViewModel({ cwd: 'claude-code-sidekick' })
    const result = formatter.format("{cwd,maxLength=10,truncateStyle='suffix'}", viewModel)
    expect(result).toBe('claude-co…')
  })

  it('applies prefix truncation with maxLength', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: false })
    const viewModel = createMinimalViewModel({ cwd: 'claude-code-sidekick' })
    const result = formatter.format("{cwd,maxLength=10,truncateStyle='prefix'}", viewModel)
    expect(result).toBe('…-sidekick')
  })

  it('applies path truncation with maxLength', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: false })
    const viewModel = createMinimalViewModel({ cwd: 'project/packages/core/src' })
    const result = formatter.format("{cwd,maxLength=20,truncateStyle='path'}", viewModel)
    expect(result).toBe('project/…/src')
  })

  it('defaults truncateStyle to suffix', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: false })
    const viewModel = createMinimalViewModel({ cwd: 'claude-code-sidekick' })
    const result = formatter.format('{cwd,maxLength=10}', viewModel)
    expect(result).toBe('claude-co…')
  })

  it('applies maxLength after prefix/suffix', () => {
    // maxLength applies to the TOKEN VALUE, not including prefix/suffix
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: false })
    const viewModel = createMinimalViewModel({ cwd: 'claude-code-sidekick' })
    const result = formatter.format("{cwd,maxLength=10,prefix=' | '}", viewModel)
    expect(result).toBe(' | claude-co…')
  })

  it('handles maxLength with ANSI-colored text', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: true })
    const viewModel = createMinimalViewModel({ cwd: 'short' })
    // "short" is 5 chars, maxLength=10 → no truncation, just color codes added
    const result = formatter.format('{cwd,maxLength=10}', viewModel)
    expect(result).toContain('short')
  })
})
```

Note: `createMinimalViewModel` is a test helper that creates a StatuslineViewModel with the specified overrides. Implement it if it doesn't exist.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run statusline`
Expected: FAIL — truncation not applied

**Step 3: Implement — update template parser**

In `Formatter.format()`, update the regex replacement callback to parse `maxLength` and `truncateStyle`, then apply truncation to the raw value before colorization.

The key insight: truncation must happen on the **raw** (pre-color) value, then colorization is applied to the truncated result. This means we need to restructure the flow:

1. Build raw token values (no colors)
2. Parse template, for each token: get raw value → truncate → colorize → apply prefix/suffix
3. Then handle wrapAt (Task 6)

This is a significant refactor of `format()`. The current approach pre-colorizes all tokens, then substitutes. The new approach must defer colorization.

Restructured `format()` approach:

```typescript
format(template: string, viewModel: StatuslineViewModel): string {
  // Build RAW token values (no ANSI codes)
  const rawTokens: Record<string, string> = { /* ... */ }
  // Build color map for each token
  const tokenColors: Record<string, string> = { /* ... */ }

  // Replace template tokens
  let result = template.replace(/\{(\w+)(?:,([^}]*))?\}/g, (_match, tokenName, optionsStr) => {
    let value = rawTokens[tokenName] ?? ''
    if (!value) return EMPTY_MARKER

    // Parse options
    const options = parseTokenOptions(optionsStr)

    // Apply truncation to raw value
    if (options.maxLength !== undefined) {
      const style = options.truncateStyle ?? 'suffix'
      value = applyTruncation(value, options.maxLength, style)
    }

    // Colorize the (possibly truncated) value
    const colorized = this.colorize(value, tokenColors[tokenName])

    return (options.prefix ?? '') + colorized + (options.suffix ?? '')
  })

  // ... cleanup as before
}
```

Extract `parseTokenOptions` as a helper:

```typescript
interface TokenOptions {
  prefix?: string
  suffix?: string
  maxLength?: number
  truncateStyle?: 'suffix' | 'prefix' | 'path'
  wrapAt?: number
  wrapPrefix?: string
  wrapSuffix?: string
}

function parseTokenOptions(optionsStr?: string): TokenOptions {
  if (!optionsStr) return {}
  const options: TokenOptions = {}

  // Parse string options: key='value' with escaped quotes
  const stringPattern = /(\w+)='((?:[^'\\]|\\.)*)'/g
  let match
  while ((match = stringPattern.exec(optionsStr)) !== null) {
    const key = match[1]
    const val = match[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\')
    switch (key) {
      case 'prefix': options.prefix = val; break
      case 'suffix': options.suffix = val; break
      case 'truncateStyle': options.truncateStyle = val as 'suffix' | 'prefix' | 'path'; break
      case 'wrapPrefix': options.wrapPrefix = val; break
      case 'wrapSuffix': options.wrapSuffix = val; break
    }
  }

  // Parse numeric options: key=number
  const numPattern = /(\w+)=(\d+)(?=[,}]|$)/g
  while ((match = numPattern.exec(optionsStr)) !== null) {
    const key = match[1]
    const val = parseInt(match[2], 10)
    switch (key) {
      case 'maxLength': options.maxLength = val; break
      case 'wrapAt': options.wrapAt = val; break
    }
  }

  return options
}
```

**Step 4: Run tests**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run statusline`
Expected: PASS

**Step 5: Commit**

```
git add packages/feature-statusline/src/formatter.ts packages/feature-statusline/src/__tests__/statusline.test.ts
git commit -m "feat(statusline): template parser supports maxLength and truncateStyle attributes"
```

---

### Task 6: Responsive Line Wrapping (wrapAt)

Add `wrapAt`, `wrapPrefix`, `wrapSuffix` support to the template engine. Depends on Tasks 1 and 5.

**Files:**
- Modify: `packages/feature-statusline/src/formatter.ts` (format method)
- Test: `packages/feature-statusline/src/__tests__/statusline.test.ts`

**Step 1: Write failing tests**

```typescript
describe('responsive wrapping', () => {
  it('uses normal prefix when line width is under wrapAt', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: false })
    const viewModel = createMinimalViewModel({ title: 'short' })
    // Template where first part is short, well under 80 chars
    const result = formatter.format("{model} | {title,wrapAt=80,prefix=' | ',wrapPrefix='\\n'}", viewModel)
    expect(result).toContain(' | short')
    expect(result).not.toContain('\nshort')
  })

  it('uses wrapPrefix when line width would exceed wrapAt', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: false })
    // Create a view model where model + other content is very long
    const viewModel = createMinimalViewModel({
      model: 'A'.repeat(78),
      title: 'my title',
    })
    const result = formatter.format("{model}{title,wrapAt=80,prefix=' | ',wrapPrefix='\\n'}", viewModel)
    expect(result).toContain('\nmy title')
    expect(result).not.toContain(' | my title')
  })

  it('measures visible width excluding ANSI codes', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: true })
    const viewModel = createMinimalViewModel({
      model: 'Opus', // short — even with ANSI, well under 80
      title: 'task',
    })
    const result = formatter.format("{model}{title,wrapAt=80,prefix=' | ',wrapPrefix='\\n'}", viewModel)
    // Should use normal prefix since visible width is well under 80
    // (ANSI codes don't count toward width)
    expect(stripAnsi(result)).toContain(' | task')
  })

  it('measures from last newline, not from start of string', () => {
    const formatter = createFormatter({ theme: DEFAULT_STATUSLINE_CONFIG.theme, useColors: false })
    const viewModel = createMinimalViewModel({
      model: 'A'.repeat(50),
      summary: 'B'.repeat(50),
      title: 'my title',
    })
    // After \n, summary starts a new line — wrapAt should measure from there
    const result = formatter.format("{model}\\n{summary}{title,wrapAt=80,prefix=' | ',wrapPrefix='\\n'}", viewModel)
    // summary (50 chars) + " | " + "my title" (8 chars) = 61 < 80, so normal prefix
    expect(result).toContain(' | my title')
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run statusline`
Expected: FAIL

**Step 3: Implement**

The `wrapAt` logic requires a two-pass approach:
1. First pass: replace all tokens without wrapAt, tracking the current visible line width
2. Second pass: replace tokens with wrapAt, using accumulated width to choose prefix/suffix

Or simpler: process tokens left-to-right, maintaining a running visible width counter. When a token has `wrapAt`, check if appending it with normal prefix would exceed the limit.

Since the regex-based `replace()` processes left-to-right, we can maintain state in a closure:

```typescript
// In format(), after building rawTokens and tokenColors:
let currentLineWidth = 0

let result = template.replace(/\{(\w+)(?:,([^}]*))?\}/g, (_match, tokenName, optionsStr) => {
  let value = rawTokens[tokenName] ?? ''
  if (!value) return EMPTY_MARKER

  const options = parseTokenOptions(optionsStr)

  // Apply truncation
  if (options.maxLength !== undefined) {
    value = applyTruncation(value, options.maxLength, options.truncateStyle ?? 'suffix')
  }

  // Colorize
  const colorized = this.colorize(value, tokenColors[tokenName])

  // Choose prefix/suffix based on wrapAt
  let prefix = options.prefix ?? ''
  let suffix = options.suffix ?? ''

  if (options.wrapAt !== undefined) {
    const candidateWidth = currentLineWidth + visibleLength(prefix) + visibleLength(value)
    if (candidateWidth > options.wrapAt) {
      prefix = options.wrapPrefix ?? prefix
      suffix = options.wrapSuffix ?? suffix
    }
  }

  // Update line width tracking
  const segment = prefix + colorized + suffix
  // Check for newlines in the segment — reset counter after last newline
  const lastNewline = segment.lastIndexOf('\n')
  if (lastNewline >= 0) {
    currentLineWidth = visibleLength(segment.slice(lastNewline + 1))
  } else {
    currentLineWidth += visibleLength(segment)
  }

  return segment
})
```

Also handle literal `\n` in templates updating the counter (the template may have literal `\n` between tokens).

**Step 4: Run tests**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run statusline`
Expected: PASS

**Step 5: Commit**

```
git add packages/feature-statusline/src/formatter.ts packages/feature-statusline/src/__tests__/statusline.test.ts
git commit -m "feat(statusline): responsive line wrapping with wrapAt/wrapPrefix/wrapSuffix"
```

---

### Task 7: Update Defaults and Config

Update the default format string, session title color, and YAML docs.

**Files:**
- Modify: `assets/sidekick/defaults/features/statusline.defaults.yaml`
- Modify: `packages/feature-statusline/src/types.ts:125-145` (DEFAULT_STATUSLINE_CONFIG)

**Step 1: Update defaults YAML**

Update the format string (line 43):

```yaml
format: "{personaName,prefix='[',suffix='] | '}{model,prefix='[',suffix='] | '}{contextBar} {tokenPercentageActual} | {logs} | {cwd,maxLength=40,truncateStyle='path'}{branch,prefix=' ∗ ',maxLength=40} | {title,wrapAt=80,prefix=' | ',wrapPrefix='\\n'}\n{summary}"
```

Update the available placeholders documentation in the YAML comments to include:
- `{projectDirShort}` - Project directory basename
- `{projectDirFull}` - Project directory full path (home-shortened)
- `{worktreeName}` - Worktree name (empty if not in worktree)
- `{worktreeOrBranch}` - Worktree name if in worktree, else branch name (raw)

Update `{branch}` documentation: "Git branch name (raw, use prefix for icon)"

Add new attribute documentation:
- `maxLength=N` — Maximum visible character width
- `truncateStyle='suffix|prefix|path'` — Truncation strategy (default: suffix)
- `wrapAt=N` — Line width threshold for responsive wrapping
- `wrapPrefix='...'` / `wrapSuffix='...'` — Alternatives used when line exceeds wrapAt

Update title color default (line 89):
```yaml
title: cyan
```

**Step 2: Update DEFAULT_STATUSLINE_CONFIG in types.ts**

Update format string and title color to match YAML:

```typescript
format: "{personaName,prefix='[',suffix='] | '}{model,prefix='[',suffix='] | '}{contextBar} {tokenPercentageActual} | {logs} | {cwd,maxLength=40,truncateStyle='path'}{branch,prefix=' ∗ ',maxLength=40} | {title,wrapAt=80,prefix=' | ',wrapPrefix='\\n'}\n{summary}",
// ...
colors: {
  // ...
  title: 'cyan',
  // ...
}
```

**Step 3: Update existing tests that assert on default format output**

Search for tests that check rendered output against the old format string or old title color. Update expected values.

**Step 4: Run full test suite**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run`
Expected: PASS

**Step 5: Commit**

```
git add assets/sidekick/defaults/features/statusline.defaults.yaml packages/feature-statusline/src/types.ts packages/feature-statusline/src/__tests__/
git commit -m "feat(statusline): update default format string, title color to cyan, and YAML docs"
```

---

### Task 8: Remove Legacy shortenPath and formatCwd/formatBranch Icon Logic

Clean up the old `shortenPath`, icon-based `formatCwd`, and icon-based `formatBranch` functions. Update all callers.

**Files:**
- Modify: `packages/feature-statusline/src/formatter.ts` — remove `shortenPath`, simplify `formatCwd` and `formatBranch`
- Modify: `packages/feature-statusline/src/__tests__/statusline.test.ts` — update/remove old tests

**Step 1: Remove `shortenPath` function** (formatter.ts:300-331)

Delete the function entirely. Its behavior is replaced by `truncatePath` + `truncatePrefix`/`truncateSuffix` via template attributes.

**Step 2: Simplify `formatCwd`** — already done in Task 4 (just home-shortening)

**Step 3: Simplify `formatBranch`** — already done in Task 4 (just returns raw value)

**Step 4: Remove/update old tests**

- Remove the `describe('shortenPath')` block (lines 253-298)
- Update `describe('formatBranch')` assertions to not expect icons
- Update `describe('formatCwd')` if icon assertions exist

**Step 5: Run tests**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run`
Expected: PASS

**Step 6: Commit**

```
git add packages/feature-statusline/src/formatter.ts packages/feature-statusline/src/__tests__/statusline.test.ts
git commit -m "refactor(statusline): remove legacy shortenPath and icon-based formatting"
```

---

### Task 9: Build, Typecheck, Lint

Final verification across the whole project.

**Step 1: Build**

Run: `pnpm build`
Expected: PASS

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Lint**

Run: `pnpm lint`
Expected: PASS (fix any issues)

**Step 4: Full test run**

Run: `pnpm --filter @sidekick/feature-statusline test -- --run`
Expected: PASS

Also run CLI tests that may reference statusline types:

Run: `pnpm --filter @sidekick/sidekick-cli test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: PASS

**Step 5: Commit any fixes**

```
git commit -m "chore(statusline): fix lint/type issues from template enhancement refactor"
```

---

### Task 10: Integration Test — Manual Verification

Verify the statusline renders correctly in a real Claude Code session.

**Step 1: Build and enable dev mode**

```
pnpm build
pnpm sidekick dev-mode enable
```

**Step 2: Test normal session**

Start Claude Code in the project. Verify:
- cwd shows project-aware path truncation
- branch shows with prefix icon from template
- title uses cyan color (distinct from branch)
- Long lines wrap correctly at 80 chars

**Step 3: Test worktree session**

Enter a worktree. Verify:
- cwd reflects worktree path
- `{worktreeOrBranch}` shows worktree name
- `{projectDirShort}` shows original repo basename

**Step 4: Commit final state, push**

```
git push -u origin worktree-statusline-debug
```
