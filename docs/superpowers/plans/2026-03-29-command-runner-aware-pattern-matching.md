# Command Runner-Aware Pattern Matching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the tool-pattern-matcher recognize commands invoked through package runners (e.g., `uv run mypy`, `npx jest`) by switching from anchored to unanchored token subsequence matching when a known runner prefix is detected.

**Architecture:** Add a configurable `command_runners` list to reminders settings. Extend `matchesToolPattern()` with a runner prefix detection step that, when matched, drops the first-token anchor and performs unanchored subsequence matching. Pass runners from config through the handler to the matcher.

**Tech Stack:** TypeScript, Vitest, Zod

**Spec:** `docs/superpowers/specs/2026-03-29-command-runner-aware-pattern-matching-design.md`

---

### Task 1: Add CommandRunner schema and update RemindersSettings

**Files:**
- Modify: `packages/feature-reminders/src/types.ts:6` (imports), `:182-192` (interface), `:308-317` (defaults)

- [ ] **Step 1: Write the failing test for CommandRunner schema validation**

Create a new test file for the schema.

Test file: `packages/feature-reminders/src/__tests__/command-runner-schema.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import { CommandRunnerSchema } from '../types.js'

describe('CommandRunnerSchema', () => {
  it('accepts valid runner with prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: 'uv run' })
    expect(result.success).toBe(true)
  })

  it('accepts single-token prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: 'npx' })
    expect(result.success).toBe(true)
  })

  it('rejects empty prefix', () => {
    const result = CommandRunnerSchema.safeParse({ prefix: '' })
    expect(result.success).toBe(false)
  })

  it('rejects missing prefix', () => {
    const result = CommandRunnerSchema.safeParse({})
    expect(result.success).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/command-runner-schema.test.ts`

Expected: FAIL — `CommandRunnerSchema` is not exported from `types.ts`

- [ ] **Step 3: Add CommandRunnerSchema and update RemindersSettings**

In `packages/feature-reminders/src/types.ts`, add after the `VerificationToolsMap` type (line 38):

```typescript
/** Zod schema for a command runner prefix */
export const CommandRunnerSchema = z.object({
  prefix: z.string().min(1),
})

export type CommandRunner = z.infer<typeof CommandRunnerSchema>
```

Update the `RemindersSettings` interface (line 182) to add:

```typescript
/** Command runner prefixes that trigger unanchored pattern matching */
command_runners?: CommandRunner[]
```

Add to `DEFAULT_REMINDERS_SETTINGS` (line 308) inside the object:

```typescript
command_runners: [
  // Python
  { prefix: 'uv run' },
  { prefix: 'poetry run' },
  { prefix: 'pipx run' },
  { prefix: 'pdm run' },
  { prefix: 'hatch run' },
  { prefix: 'conda run' },
  // Node.js
  { prefix: 'npx' },
  { prefix: 'pnpx' },
  { prefix: 'bunx' },
  { prefix: 'pnpm dlx' },
  { prefix: 'pnpm exec' },
  { prefix: 'bun run' },
  { prefix: 'yarn dlx' },
  { prefix: 'yarn exec' },
  { prefix: 'npm exec' },
  // Ruby
  { prefix: 'bundle exec' },
  // .NET
  { prefix: 'dotnet tool run' },
],
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/command-runner-schema.test.ts`

Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/feature-reminders/src/types.ts packages/feature-reminders/src/__tests__/command-runner-schema.test.ts
git commit -m "feat(reminders): add CommandRunner schema and update RemindersSettings"
```

---

### Task 2: Add runner prefix detection to tool-pattern-matcher

**Files:**
- Modify: `packages/feature-reminders/src/tool-pattern-matcher.ts:1-56`
- Test: `packages/feature-reminders/src/__tests__/tool-pattern-matcher.test.ts`

- [ ] **Step 1: Write failing tests for runner-aware matching**

Add to `packages/feature-reminders/src/__tests__/tool-pattern-matcher.test.ts`, inside the existing `describe('matchesToolPattern')` block, after the existing tests:

```typescript
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
  expect(matchesToolPattern('dotnet tool run dotnet-format src/', 'dotnet format', runners)).toBe(false)
  // Note: 'dotnet-format' (hyphenated binary name) != token 'dotnet' from pattern 'dotnet format'
  // But the actual binary invoked through 'dotnet tool run' would just be the tool name:
  expect(matchesToolPattern('dotnet tool run formatter --check', 'formatter', runners)).toBe(true)
})

it('does not match runner prefix as a substring of first token', () => {
  // 'npxtra' starts with 'npx' as a string but is a different token
  expect(matchesToolPattern('npxtra jest', 'jest', runners)).toBe(false)
})
```

Also add to the `describe('findMatchingPattern')` block:

```typescript
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/tool-pattern-matcher.test.ts`

Expected: FAIL — `matchesToolPattern` does not accept a third argument

- [ ] **Step 3: Implement runner prefix detection in the matcher**

Replace the contents of `packages/feature-reminders/src/tool-pattern-matcher.ts` with:

```typescript
/**
 * Anchored token subsequence matching for verification tool patterns.
 *
 * Splits commands on shell operators, then matches pattern tokens as a
 * subsequence of command tokens with the first token anchored (must match
 * exactly at position 0). Wildcard `*` matches any single token.
 *
 * When a known command runner prefix is detected (e.g., `uv run`, `npx`),
 * switches to unanchored subsequence matching — same algorithm without the
 * first-token anchor — so `uv run mypy` matches pattern `mypy`.
 *
 * @see docs/superpowers/specs/2026-03-29-command-runner-aware-pattern-matching-design.md
 */

import type { ToolPattern, CommandRunner } from './types.js'

/** Split a command string into segments on shell operators */
const SHELL_OPERATOR_RE = /\s*(?:&&|\|\||[;|])\s*/

/**
 * Detect if a segment starts with a known command runner prefix.
 * Uses token-level comparison: splits both segment and prefix into tokens
 * and checks that the first N segment tokens exactly equal the prefix tokens.
 * Returns the number of prefix tokens matched, or 0 if no runner matches.
 * When multiple runners match, the longest (most tokens) wins.
 */
export function detectRunnerPrefix(segmentTokens: string[], runners: CommandRunner[]): number {
  let longestMatch = 0

  for (const runner of runners) {
    const prefixTokens = runner.prefix.trim().split(/\s+/)
    if (prefixTokens.length === 0) continue
    if (prefixTokens.length > segmentTokens.length) continue

    let matches = true
    for (let i = 0; i < prefixTokens.length; i++) {
      if (segmentTokens[i] !== prefixTokens[i]) {
        matches = false
        break
      }
    }

    if (matches && prefixTokens.length > longestMatch) {
      longestMatch = prefixTokens.length
    }
  }

  return longestMatch
}

/**
 * Test whether a shell command matches a tool pattern string.
 *
 * Without runners (or when no runner prefix matches): first token is anchored;
 * remaining tokens match as subsequence. `*` in the pattern matches any single
 * command token.
 *
 * With runners: when a segment starts with a known runner prefix, switches to
 * unanchored subsequence matching (scans for first pattern token from any position).
 */
export function matchesToolPattern(command: string, pattern: string, runners?: CommandRunner[]): boolean {
  if (!command || !pattern) return false

  const segments = command.split(SHELL_OPERATOR_RE)
  const patternTokens = pattern.trim().split(/\s+/).filter(Boolean)
  if (patternTokens.length === 0) return false

  const activeRunners = runners?.length ? runners : undefined

  return segments.some((segment) => {
    const cmdTokens = segment.trim().split(/\s+/)
    if (cmdTokens.length === 0 || cmdTokens[0] === '') return false

    const runnerTokenCount = activeRunners ? detectRunnerPrefix(cmdTokens, activeRunners) : 0

    if (runnerTokenCount > 0) {
      // Unanchored subsequence match — scan for first pattern token from any position
      let pi = 0
      for (let ci = runnerTokenCount; ci < cmdTokens.length && pi < patternTokens.length; ci++) {
        if (patternTokens[pi] === '*' || patternTokens[pi] === cmdTokens[ci]) {
          pi++
        }
      }
      return pi === patternTokens.length
    }

    // Anchored: first token must match exactly
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
export function findMatchingPattern(
  command: string,
  patterns: ToolPattern[],
  runners?: CommandRunner[]
): ToolPattern | null {
  for (const pattern of patterns) {
    if (pattern.tool === null) continue
    if (matchesToolPattern(command, pattern.tool, runners)) return pattern
  }
  return null
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/tool-pattern-matcher.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/feature-reminders/src/tool-pattern-matcher.ts packages/feature-reminders/src/__tests__/tool-pattern-matcher.test.ts
git commit -m "feat(reminders): add runner-aware unanchored matching to tool-pattern-matcher"
```

---

### Task 3: Wire runners through handler to matcher

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts:25,34,67,273`
- Test: `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`

- [ ] **Step 1: Write failing handler test for runner-wrapped commands**

Add to `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`, inside the `describe('registerTrackVerificationTools')` block, after the existing verification command detection tests (around line 307):

```typescript
// --------------------------------------------------------------------------
// Runner-wrapped command detection
// --------------------------------------------------------------------------

it('unstages vc-typecheck when mypy is invoked through uv run', async () => {
  const handler = getRegisteredHandler()

  await handler(
    createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/app.py'),
    ctx as any
  )
  expect(getStagedNames(staging)).toContain(ReminderIds.VC_TYPECHECK)

  await handler(
    createBashEvent(
      { turnCount: 1, toolsThisTurn: 2, toolCount: 2 },
      'uv run mypy tests/test_feedback_server.py --ignore-missing-imports'
    ),
    ctx as any
  )

  expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TYPECHECK)
})

it('unstages vc-test when pytest is invoked through uv run', async () => {
  const handler = getRegisteredHandler()

  await handler(
    createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/app.py'),
    ctx as any
  )

  await handler(
    createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'uv run pytest tests/'),
    ctx as any
  )

  expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TEST)
})

it('unstages vc-lint when ruff is invoked through poetry run', async () => {
  const handler = getRegisteredHandler()

  await handler(
    createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/app.py'),
    ctx as any
  )

  await handler(
    createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'poetry run ruff check src/'),
    ctx as any
  )

  expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_LINT)
})
```

Also add to verify config wiring (can be placed in the same test block or a new sub-describe):

```typescript
it('respects custom command_runners from project config', async () => {
  // Create a fresh context with custom runner config
  const customCtx = createMockDaemonContext({
    staging, logger, handlers: new MockHandlerRegistry(), assets, stateService,
    configOverrides: {
      features: {
        reminders: {
          enabled: true,
          settings: {
            command_runners: [{ prefix: 'mise exec' }],
          },
        },
      },
    },
  })
  registerTrackVerificationTools(customCtx)
  const reg = (customCtx as any).handlers.getHandler('reminders:track-verification-tools')
  const handler = reg!.handler

  await handler(
    createFileEditEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, '/mock/project/src/app.py'),
    customCtx as any
  )

  await handler(
    createBashEvent({ turnCount: 1, toolsThisTurn: 2, toolCount: 2 }, 'mise exec mypy src/'),
    customCtx as any
  )

  expect(getStagedNames(staging)).not.toContain(ReminderIds.VC_TYPECHECK)
})
```

Note: If `createMockDaemonContext` does not support `configOverrides`, the implementer should check how the existing test infrastructure exposes config mutation (e.g., `MockConfigService.set()` or constructor options) and adapt accordingly. The intent is to verify that custom runners from project config are wired through to the matcher.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/handlers/staging/track-verification-tools.test.ts`

Expected: FAIL — the handler doesn't pass runners to `findMatchingPattern`, so runner-wrapped commands don't match

- [ ] **Step 3: Update handler to pass runners to matcher**

In `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts`:

1. Update the import from `../../types.js` (line 27-34) to also import `CommandRunner`:

```typescript
import {
  ReminderIds,
  TOOL_REMINDER_MAP,
  DEFAULT_REMINDERS_SETTINGS,
  VC_TOOL_REMINDER_IDS,
  type RemindersSettings,
  type VerificationToolsMap,
  type CommandRunner,
} from '../../types.js'
```

2. In the handler function (line 65-67), after loading config, extract runners:

```typescript
const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
const verificationTools = config.verification_tools ?? {}
const runners = config.command_runners ?? []
```

3. Pass `runners` to `handleBashCommand` (line 76):

```typescript
await handleBashCommand(event, daemonCtx, sessionId, verificationTools, toolsState, remindersState, runners)
```

4. Update `handleBashCommand` signature (line 255-262) to accept runners:

```typescript
async function handleBashCommand(
  event: TranscriptEvent,
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors,
  runners: CommandRunner[] = []
): Promise<void> {
```

5. Update the `findMatchingPattern` call (line 273) to pass runners:

```typescript
const match = findMatchingPattern(command, toolConfig.patterns, runners)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/handlers/staging/track-verification-tools.test.ts`

Expected: ALL PASS

- [ ] **Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/track-verification-tools.ts packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts
git commit -m "feat(reminders): wire command runners through handler to pattern matcher"
```

---

### Task 4: Add command_runners to YAML defaults

**Files:**
- Modify: `assets/sidekick/defaults/features/reminders.defaults.yaml`

- [ ] **Step 1: Add command_runners section to YAML defaults**

In `assets/sidekick/defaults/features/reminders.defaults.yaml`, add after `reminder_thresholds` (line 19) and before `source_code_patterns` (line 22):

```yaml
  # Command runner prefixes that trigger unanchored pattern matching.
  # When a bash command starts with one of these prefixes, the tool pattern
  # matcher drops its first-token anchor and scans for the tool name at any
  # position. This allows commands like 'uv run mypy' to match pattern 'mypy'.
  # Array merge strategy: replace (project/user config replaces defaults entirely).
  command_runners:
    # Python
    - prefix: "uv run"
    - prefix: "poetry run"
    - prefix: "pipx run"
    - prefix: "pdm run"
    - prefix: "hatch run"
    - prefix: "conda run"
    # Node.js
    - prefix: "npx"
    - prefix: "pnpx"
    - prefix: "bunx"
    - prefix: "pnpm dlx"
    - prefix: "pnpm exec"
    - prefix: "bun run"
    - prefix: "yarn dlx"
    - prefix: "yarn exec"
    - prefix: "npm exec"
    # Ruby
    - prefix: "bundle exec"
    # .NET
    - prefix: "dotnet tool run"
```

- [ ] **Step 2: Commit**

```bash
git add assets/sidekick/defaults/features/reminders.defaults.yaml
git commit -m "feat(reminders): add command_runners defaults to YAML config"
```

---

### Task 5: Full verification

**Files:** None (verification only)

- [ ] **Step 1: Run all feature-reminders tests (excluding IPC)**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter @sidekick/feature-reminders test`

Expected: ALL PASS

- [ ] **Step 2: Run typecheck**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm typecheck`

Expected: PASS (no type errors)

- [ ] **Step 3: Run build**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm build`

Expected: PASS

- [ ] **Step 4: Run lint**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm lint`

Expected: PASS
