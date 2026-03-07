# Structured VC Tool Patterns — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace flat string pattern matching in VC tool detection with structured, keyed tool patterns using anchored token subsequence matching.

**Architecture:** Add `ToolPattern` schema (`tool_id`, `tool`, `scope`) to config types, implement `matchesToolPattern()` with first-token anchoring and subsequence matching, update handler and defaults YAML. No new files — changes scoped to existing types, handler, tests, and config.

**Tech Stack:** TypeScript, Zod, Vitest, picomatch (existing)

**Design doc:** `docs/plans/2026-03-07-structured-vc-tool-patterns-design.md`
**Bead:** sidekick-xcd5

---

### Task 1: Add ToolPattern schema and update config types

**Files:**
- Modify: `packages/feature-reminders/src/types.ts:12-25` (schemas)
- Modify: `packages/feature-reminders/src/types.ts:28-134` (DEFAULT_VERIFICATION_TOOLS)
- Test: `packages/feature-reminders/src/__tests__/verification-tool-config.test.ts`

**Step 1: Write failing tests for new schema**

Add tests to `verification-tool-config.test.ts` that validate the new structured pattern format:

```typescript
import { ToolPatternSchema, VerificationToolConfigSchema, DEFAULT_VERIFICATION_TOOLS } from '../types.js'

describe('ToolPatternSchema', () => {
  it('validates a complete tool pattern', () => {
    const result = ToolPatternSchema.safeParse({
      tool_id: 'pnpm-build',
      tool: 'pnpm build',
      scope: 'project',
    })
    expect(result.success).toBe(true)
  })

  it('defaults scope to project', () => {
    const result = ToolPatternSchema.parse({
      tool_id: 'tsc',
      tool: 'tsc',
    })
    expect(result.scope).toBe('project')
  })

  it('accepts null tool (disabled pattern)', () => {
    const result = ToolPatternSchema.safeParse({
      tool_id: 'esbuild',
      tool: null,
      scope: 'file',
    })
    expect(result.success).toBe(true)
  })

  it('rejects missing tool_id', () => {
    const result = ToolPatternSchema.safeParse({ tool: 'pnpm build' })
    expect(result.success).toBe(false)
  })

  it('validates scope enum', () => {
    const result = ToolPatternSchema.safeParse({
      tool_id: 'x',
      tool: 'x',
      scope: 'invalid',
    })
    expect(result.success).toBe(false)
  })
})
```

Update existing tests: change `patterns: ['pnpm build']` to `patterns: [{ tool_id: 'pnpm-build', tool: 'pnpm build', scope: 'project' }]` in the well-formed config test.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern verification-tool-config`
Expected: FAIL — `ToolPatternSchema` doesn't exist yet, old tests fail with new format.

**Step 3: Implement schema changes**

In `packages/feature-reminders/src/types.ts`:

1. Add `ToolPatternSchema` before `VerificationToolConfigSchema`:

```typescript
/** Scope of a verification tool invocation */
export const ToolPatternScopeSchema = z.enum(['project', 'package', 'file'])
export type ToolPatternScope = z.infer<typeof ToolPatternScopeSchema>

/** Zod schema for a structured tool pattern */
export const ToolPatternSchema = z.object({
  tool_id: z.string(),
  tool: z.string().nullable(),
  scope: ToolPatternScopeSchema.default('project'),
})

export type ToolPattern = z.infer<typeof ToolPatternSchema>
```

2. Update `VerificationToolConfigSchema` patterns field:

```typescript
export const VerificationToolConfigSchema = z.object({
  enabled: z.boolean(),
  patterns: z.array(ToolPatternSchema).min(1),
  clearing_threshold: z.number().int().positive(),
  clearing_patterns: z.array(z.string()).min(1),
})
```

3. Update `DEFAULT_VERIFICATION_TOOLS` — replace flat string arrays with structured patterns. Full replacement (build shown as example):

```typescript
export const DEFAULT_VERIFICATION_TOOLS: VerificationToolsMap = {
  build: {
    enabled: true,
    patterns: [
      // TypeScript/JavaScript
      { tool_id: 'tsc', tool: 'tsc', scope: 'project' },
      { tool_id: 'esbuild', tool: 'esbuild', scope: 'file' },
      { tool_id: 'pnpm-build', tool: 'pnpm build', scope: 'project' },
      { tool_id: 'pnpm-filter-build', tool: 'pnpm --filter * build', scope: 'package' },
      { tool_id: 'npm-build', tool: 'npm run build', scope: 'project' },
      { tool_id: 'yarn-build', tool: 'yarn build', scope: 'project' },
      { tool_id: 'yarn-workspace-build', tool: 'yarn workspace * build', scope: 'package' },
      // Python
      { tool_id: 'python-setup-build', tool: 'python setup.py build', scope: 'project' },
      { tool_id: 'pip-install', tool: 'pip install', scope: 'project' },
      { tool_id: 'poetry-build', tool: 'poetry build', scope: 'project' },
      // JVM
      { tool_id: 'mvn-compile', tool: 'mvn compile', scope: 'project' },
      { tool_id: 'mvn-package', tool: 'mvn package', scope: 'project' },
      { tool_id: 'gradle-build', tool: 'gradle build', scope: 'project' },
      { tool_id: 'gradlew-build', tool: './gradlew build', scope: 'project' },
      // Go
      { tool_id: 'go-build', tool: 'go build', scope: 'project' },
      // Rust
      { tool_id: 'cargo-build', tool: 'cargo build', scope: 'project' },
      // C/C++
      { tool_id: 'make-build', tool: 'make build', scope: 'project' },
      { tool_id: 'make-default', tool: 'make', scope: 'project' },
      { tool_id: 'cmake-build', tool: 'cmake --build', scope: 'project' },
      // Containers
      { tool_id: 'docker-build', tool: 'docker build', scope: 'project' },
    ],
    clearing_threshold: 3,
    clearing_patterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py', '**/*.java', '**/*.kt', '**/*.go',
      '**/*.rs', '**/*.c', '**/*.cpp', '**/*.cs',
    ],
  },
  typecheck: {
    enabled: true,
    patterns: [
      { tool_id: 'tsc-noEmit', tool: 'tsc --noEmit', scope: 'project' },
      { tool_id: 'pnpm-typecheck', tool: 'pnpm typecheck', scope: 'project' },
      { tool_id: 'pnpm-filter-typecheck', tool: 'pnpm --filter * typecheck', scope: 'package' },
      { tool_id: 'npm-typecheck', tool: 'npm run typecheck', scope: 'project' },
      { tool_id: 'yarn-typecheck', tool: 'yarn typecheck', scope: 'project' },
      { tool_id: 'yarn-workspace-typecheck', tool: 'yarn workspace * typecheck', scope: 'package' },
      { tool_id: 'mypy', tool: 'mypy', scope: 'project' },
      { tool_id: 'pyright', tool: 'pyright', scope: 'project' },
      { tool_id: 'pytype', tool: 'pytype', scope: 'project' },
      { tool_id: 'go-vet', tool: 'go vet', scope: 'project' },
    ],
    clearing_threshold: 3,
    clearing_patterns: ['**/*.ts', '**/*.tsx', '**/*.py', '**/*.go'],
  },
  test: {
    enabled: true,
    patterns: [
      { tool_id: 'vitest', tool: 'vitest', scope: 'project' },
      { tool_id: 'jest', tool: 'jest', scope: 'project' },
      { tool_id: 'pnpm-test', tool: 'pnpm test', scope: 'project' },
      { tool_id: 'pnpm-filter-test', tool: 'pnpm --filter * test', scope: 'package' },
      { tool_id: 'npm-test', tool: 'npm test', scope: 'project' },
      { tool_id: 'yarn-test', tool: 'yarn test', scope: 'project' },
      { tool_id: 'yarn-workspace-test', tool: 'yarn workspace * test', scope: 'package' },
      { tool_id: 'pytest', tool: 'pytest', scope: 'project' },
      { tool_id: 'python-pytest', tool: 'python -m pytest', scope: 'project' },
      { tool_id: 'python-unittest', tool: 'python -m unittest', scope: 'project' },
      { tool_id: 'mvn-test', tool: 'mvn test', scope: 'project' },
      { tool_id: 'gradle-test', tool: 'gradle test', scope: 'project' },
      { tool_id: 'gradlew-test', tool: './gradlew test', scope: 'project' },
      { tool_id: 'go-test', tool: 'go test', scope: 'project' },
      { tool_id: 'cargo-test', tool: 'cargo test', scope: 'project' },
      { tool_id: 'dotnet-test', tool: 'dotnet test', scope: 'project' },
      { tool_id: 'make-test', tool: 'make test', scope: 'project' },
    ],
    clearing_threshold: 3,
    clearing_patterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py', '**/*.java', '**/*.kt', '**/*.go', '**/*.rs',
      '**/*.test.*', '**/*.spec.*', '**/test_*',
    ],
  },
  lint: {
    enabled: true,
    patterns: [
      { tool_id: 'eslint', tool: 'eslint', scope: 'project' },
      { tool_id: 'pnpm-lint', tool: 'pnpm lint', scope: 'project' },
      { tool_id: 'pnpm-filter-lint', tool: 'pnpm --filter * lint', scope: 'package' },
      { tool_id: 'npm-lint', tool: 'npm run lint', scope: 'project' },
      { tool_id: 'yarn-lint', tool: 'yarn lint', scope: 'project' },
      { tool_id: 'yarn-workspace-lint', tool: 'yarn workspace * lint', scope: 'package' },
      { tool_id: 'ruff', tool: 'ruff', scope: 'project' },
      { tool_id: 'flake8', tool: 'flake8', scope: 'project' },
      { tool_id: 'pylint', tool: 'pylint', scope: 'project' },
      { tool_id: 'golangci-lint', tool: 'golangci-lint', scope: 'project' },
      { tool_id: 'cargo-clippy', tool: 'cargo clippy', scope: 'project' },
      { tool_id: 'ktlint', tool: 'ktlint', scope: 'project' },
      { tool_id: 'dotnet-format', tool: 'dotnet format', scope: 'project' },
    ],
    clearing_threshold: 5,
    clearing_patterns: [
      '**/*.ts', '**/*.tsx', '**/*.js', '**/*.jsx',
      '**/*.py', '**/*.java', '**/*.kt', '**/*.go', '**/*.rs',
    ],
  },
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern verification-tool-config`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/feature-reminders/src/types.ts packages/feature-reminders/src/__tests__/verification-tool-config.test.ts
git commit -m "feat(reminders): add ToolPattern schema and structured default patterns"
```

---

### Task 2: Add matchesToolPattern() with tests

**Files:**
- Create: `packages/feature-reminders/src/tool-pattern-matcher.ts`
- Create: `packages/feature-reminders/src/__tests__/tool-pattern-matcher.test.ts`

**Step 1: Write failing tests for the matching function**

Create `packages/feature-reminders/src/__tests__/tool-pattern-matcher.test.ts`:

```typescript
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
    // "pnpm --filter foo build" matches both "pnpm build" and "pnpm --filter * build"
    // Returns the first match (pnpm-build) since it's listed first
    const match = findMatchingPattern('pnpm --filter foo build', patterns)
    expect(match).toBeDefined()
  })

  it('returns null for no match', () => {
    const match = findMatchingPattern('yarn build', patterns)
    expect(match).toBeNull()
  })

  it('skips disabled patterns (tool: null)', () => {
    const match = findMatchingPattern('disabled', [
      { tool_id: 'x', tool: null, scope: 'project' },
    ])
    expect(match).toBeNull()
  })
})
```

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern tool-pattern-matcher`
Expected: FAIL — module doesn't exist yet.

**Step 3: Implement the matching functions**

Create `packages/feature-reminders/src/tool-pattern-matcher.ts`:

```typescript
/**
 * Anchored token subsequence matching for verification tool patterns.
 *
 * Splits commands on shell operators, then matches pattern tokens as a
 * subsequence of command tokens with the first token anchored (must match
 * exactly at position 0). Wildcard `*` matches any single token.
 *
 * @see docs/plans/2026-03-07-structured-vc-tool-patterns-design.md
 */

import type { ToolPattern } from './types.js'

/** Split a command string into segments on shell operators */
const SHELL_OPERATOR_RE = /\s*(?:&&|\|\||[;|])\s*/

/**
 * Test whether a shell command matches a tool pattern string.
 * First token is anchored; remaining tokens match as subsequence.
 * `*` in the pattern matches any single command token.
 */
export function matchesToolPattern(command: string, pattern: string): boolean {
  if (!command || !pattern) return false

  const segments = command.split(SHELL_OPERATOR_RE)
  const patternTokens = pattern.split(/\s+/)
  if (patternTokens.length === 0) return false

  return segments.some((segment) => {
    const cmdTokens = segment.trim().split(/\s+/)
    if (cmdTokens.length === 0 || cmdTokens[0] === '') return false

    // First token must match exactly (anchored to command start)
    if (cmdTokens[0] !== patternTokens[0]) return false

    // Remaining pattern tokens: subsequence match
    let pi = 1
    for (let ci = 1; ci < cmdTokens.length && pi < patternTokens.length; ci++) {
      if (patternTokens[pi] === '*' || patternTokens[pi] === cmdTokens[ci]) {
        pi++
      }
    }
    return pi === patternTokens.length
  })
}

/**
 * Find the first matching ToolPattern for a command.
 * Skips disabled patterns (tool: null). Returns null if no match.
 */
export function findMatchingPattern(command: string, patterns: ToolPattern[]): ToolPattern | null {
  for (const pattern of patterns) {
    if (pattern.tool === null) continue
    if (matchesToolPattern(command, pattern.tool)) return pattern
  }
  return null
}
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern tool-pattern-matcher`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/feature-reminders/src/tool-pattern-matcher.ts packages/feature-reminders/src/__tests__/tool-pattern-matcher.test.ts
git commit -m "feat(reminders): add anchored token subsequence matcher for tool patterns"
```

---

### Task 3: Update state schema with match metadata

**Files:**
- Modify: `packages/types/src/services/state.ts:334-343`

**Step 1: Add optional match metadata fields**

In `packages/types/src/services/state.ts`, update `VerificationToolStatusSchema`:

```typescript
export const VerificationToolStatusSchema = z.object({
  /** Current state: staged (needs run), verified (recently run), cooldown (post-verified, counting edits) */
  status: z.enum(['staged', 'verified', 'cooldown']),
  /** Number of qualifying file edits since last verification */
  editsSinceVerified: z.number(),
  /** Unix timestamp (ms) when last verified, null if never */
  lastVerifiedAt: z.number().nullable(),
  /** Unix timestamp (ms) when last staged, null if never */
  lastStagedAt: z.number().nullable(),
  /** tool_id of the pattern that last matched (metadata for future scope-aware logic) */
  lastMatchedToolId: z.string().nullable().optional(),
  /** Scope of the last matched pattern */
  lastMatchedScope: z.enum(['project', 'package', 'file']).nullable().optional(),
})
```

**Step 2: Build to check types**

Run: `pnpm build`
Expected: PASS — optional fields are backward compatible with existing state files.

**Step 3: Commit**

```bash
git add packages/types/src/services/state.ts
git commit -m "feat(types): add lastMatchedToolId and lastMatchedScope to verification state"
```

---

### Task 4: Update handler to use new matching

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts:153-196`
- Test: `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`

**Step 1: Update existing tests for structured patterns**

In `track-verification-tools.test.ts`, the tests use `createBashEvent` with commands like `'pnpm build'`. These should continue to work. Add new tests for workspace-scoped commands:

```typescript
it('unstages vc-test when workspace-scoped test command is observed', async () => {
  const handler = getRegisteredHandler()

  await handler(
    createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
    ctx as any
  )
  await handler(
    createBashEvent(
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'pnpm --filter @sidekick/core test -- --exclude foo'
    ),
    ctx as any
  )

  expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TEST)
})

it('unstages vc-build when workspace-scoped build command is observed', async () => {
  const handler = getRegisteredHandler()

  await handler(
    createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
    ctx as any
  )
  await handler(
    createBashEvent(
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'pnpm --filter @sidekick/core build'
    ),
    ctx as any
  )

  expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_BUILD)
})

it('stores lastMatchedToolId and lastMatchedScope on verification', async () => {
  const handler = getRegisteredHandler()

  await handler(
    createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/index.ts'),
    ctx as any
  )
  await handler(
    createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'pnpm build'),
    ctx as any
  )

  const state = stateService.getState('verification-tools')
  expect(state.build.lastMatchedToolId).toBe('pnpm-build')
  expect(state.build.lastMatchedScope).toBe('project')
})
```

**Step 2: Run tests to verify the new ones fail**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern track-verification-tools`
Expected: FAIL — workspace commands don't match yet, no lastMatchedToolId in state.

**Step 3: Update the handler**

In `track-verification-tools.ts`:

1. Add import:
```typescript
import { findMatchingPattern } from '../../tool-pattern-matcher.js'
```

2. Update `handleBashCommand` — replace line 171's `command.includes()` with `findMatchingPattern()`:

```typescript
async function handleBashCommand(
  event: TranscriptEvent,
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors
): Promise<void> {
  const command = extractToolInput(event)?.command as string | undefined
  if (!command) return

  let anyUnstaged = false

  for (const [toolName, toolConfig] of Object.entries(verificationTools)) {
    if (!toolConfig.enabled) continue

    const reminderId = TOOL_REMINDER_MAP[toolName]
    if (!reminderId) continue

    const match = findMatchingPattern(command, toolConfig.patterns)
    if (!match) continue

    toolsState[toolName] = {
      status: 'verified',
      editsSinceVerified: 0,
      lastVerifiedAt: Date.now(),
      lastStagedAt: toolsState[toolName]?.lastStagedAt ?? null,
      lastMatchedToolId: match.tool_id,
      lastMatchedScope: match.scope,
    }

    await daemonCtx.staging.deleteReminder('Stop', reminderId)
    anyUnstaged = true

    daemonCtx.logger.debug('VC tool verified', {
      toolName,
      reminderId,
      matchedToolId: match.tool_id,
      matchedScope: match.scope,
      command: command.slice(0, 100),
    })
  }

  if (anyUnstaged) {
    const remaining = await daemonCtx.staging.listReminders('Stop')
    const hasPerToolReminders = remaining.some((r) => VC_TOOL_NAME_SET.has(r.name))

    if (!hasPerToolReminders) {
      await daemonCtx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
      daemonCtx.logger.info('All VC tools verified, unstaged wrapper', { sessionId })
    }

    await remindersState.verificationTools.write(sessionId, toolsState)
  }
}
```

3. Remove the now-unused `VerificationToolsMap` import alias if the type changed (patterns is now `ToolPattern[]` not `string[]`).

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern track-verification-tools`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/track-verification-tools.ts packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts
git commit -m "fix(reminders): use anchored token matching for VC tool detection

Fixes workspace-scoped commands like 'pnpm --filter foo test' not being
recognized as verification commands."
```

---

### Task 5: Update YAML defaults

**Files:**
- Modify: `assets/sidekick/defaults/features/reminders.defaults.yaml:71-176`

**Step 1: Replace flat pattern lists with structured format**

Update the `verification_tools` section to use `tool_id`/`tool`/`scope` objects. Match the patterns from `DEFAULT_VERIFICATION_TOOLS` in Task 1 exactly.

Example for the build section:

```yaml
    build:
      enabled: true
      patterns:
        - tool_id: tsc
          tool: "tsc"
          scope: project
        - tool_id: esbuild
          tool: "esbuild"
          scope: file
        # ... (all patterns from DEFAULT_VERIFICATION_TOOLS.build)
      clearing_threshold: 3
      clearing_patterns:
        - "**/*.ts"
        # ... (unchanged)
```

The YAML must mirror the TypeScript defaults exactly — same tool_ids, same tools, same scopes.

**Step 2: Verify YAML is valid**

Run: `node -e "const yaml = require('yaml'); const fs = require('fs'); yaml.parse(fs.readFileSync('assets/sidekick/defaults/features/reminders.defaults.yaml', 'utf8')); console.log('OK')"`
Expected: OK

**Step 3: Commit**

```bash
git add assets/sidekick/defaults/features/reminders.defaults.yaml
git commit -m "chore(config): update YAML defaults to structured VC tool patterns"
```

---

### Task 6: Full verification

**Step 1: Build**

Run: `pnpm build`
Expected: PASS

**Step 2: Typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run all tests (excluding IPC)**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: PASS

**Step 4: Lint**

Run: `pnpm lint`
Expected: PASS

**Step 5: Interactive smoke test**

Edit a `.ts` file, verify VC reminders stage. Run `pnpm --filter @sidekick/core test -- --exclude ...` and verify `vc-test` unstages (the exact command that failed before this fix).
