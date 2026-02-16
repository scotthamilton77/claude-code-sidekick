# Bash VC Detection Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Detect source code modifications made via Bash tool by diffing git status snapshots, triggering the verify-completion reminder.

**Architecture:** Daemon-side only. A UserPromptSubmit hook handler captures a git status baseline per session. A ToolResult transcript staging handler compares after Bash execution and stages VC if source files changed. Shared `getGitFileStatus` utility in sidekick-core.

**Tech Stack:** Node.js `spawn`, picomatch, vitest

**Design doc:** `docs/plans/2026-02-16-bash-vc-detection-design.md`

---

### Task 1: `getGitFileStatus` utility - tests

**Files:**
- Create: `packages/sidekick-core/src/__tests__/git-status.test.ts`

**Step 1: Write the test file**

```typescript
/**
 * Tests for git-status utility
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { spawn } from 'node:child_process'
import { getGitFileStatus, parseGitStatusOutput } from '../git-status'

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const mockSpawn = spawn as unknown as ReturnType<typeof vi.fn>

function createMockProcess(stdout: string, exitCode: number, error?: Error) {
  const stdoutHandlers: Record<string, Function> = {}
  const procHandlers: Record<string, Function> = {}

  const proc = {
    stdout: {
      on: vi.fn((event: string, handler: Function) => {
        stdoutHandlers[event] = handler
      }),
    },
    on: vi.fn((event: string, handler: Function) => {
      procHandlers[event] = handler
    }),
  }

  // Simulate async behavior
  setImmediate(() => {
    if (error) {
      procHandlers['error']?.(error)
    } else {
      if (stdout) stdoutHandlers['data']?.(Buffer.from(stdout))
      procHandlers['close']?.(exitCode)
    }
  })

  return proc
}

describe('parseGitStatusOutput', () => {
  it('parses modified files', () => {
    expect(parseGitStatusOutput(' M src/foo.ts')).toEqual(['src/foo.ts'])
  })

  it('parses new untracked files', () => {
    expect(parseGitStatusOutput('?? src/new.ts')).toEqual(['src/new.ts'])
  })

  it('parses staged files', () => {
    expect(parseGitStatusOutput('A  src/added.ts')).toEqual(['src/added.ts'])
  })

  it('parses deleted files', () => {
    expect(parseGitStatusOutput('D  src/deleted.ts')).toEqual(['src/deleted.ts'])
  })

  it('parses renamed files (takes new path)', () => {
    expect(parseGitStatusOutput('R  old.ts -> new.ts')).toEqual(['new.ts'])
  })

  it('parses multiple lines', () => {
    const output = ' M src/a.ts\n?? src/b.ts\nA  src/c.ts'
    expect(parseGitStatusOutput(output)).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts'])
  })

  it('handles empty output', () => {
    expect(parseGitStatusOutput('')).toEqual([])
  })

  it('skips empty lines', () => {
    expect(parseGitStatusOutput(' M src/a.ts\n\n M src/b.ts')).toEqual(['src/a.ts', 'src/b.ts'])
  })
})

describe('getGitFileStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns parsed file paths on success', async () => {
    mockSpawn.mockReturnValue(createMockProcess(' M src/foo.ts\n?? src/bar.ts', 0))

    const result = await getGitFileStatus('/test/dir')

    expect(result).toEqual(['src/foo.ts', 'src/bar.ts'])
    expect(mockSpawn).toHaveBeenCalledWith(
      'git', ['status', '--porcelain'],
      expect.objectContaining({ cwd: '/test/dir' })
    )
  })

  it('returns empty array on non-zero exit code', async () => {
    mockSpawn.mockReturnValue(createMockProcess('', 128))

    const result = await getGitFileStatus('/not-a-repo')

    expect(result).toEqual([])
  })

  it('returns empty array on spawn error', async () => {
    mockSpawn.mockReturnValue(createMockProcess('', 0, new Error('ENOENT')))

    const result = await getGitFileStatus('/test/dir')

    expect(result).toEqual([])
  })

  it('returns empty array on timeout', async () => {
    vi.useFakeTimers()

    // Create a process that never completes
    const proc = {
      stdout: { on: vi.fn() },
      on: vi.fn(),
      kill: vi.fn(),
    }
    mockSpawn.mockReturnValue(proc)

    const promise = getGitFileStatus('/test/dir', 100)

    vi.advanceTimersByTime(101)

    const result = await promise

    expect(result).toEqual([])

    vi.useRealTimers()
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/core test -- --run src/__tests__/git-status.test.ts`
Expected: FAIL - module not found

---

### Task 2: `getGitFileStatus` utility - implementation

**Files:**
- Create: `packages/sidekick-core/src/git-status.ts`
- Modify: `packages/sidekick-core/src/index.ts`

**Step 1: Write the implementation**

```typescript
/**
 * Git status utility for detecting file changes
 *
 * Runs `git status --porcelain` with timeout protection.
 * Used by reminders feature to detect Bash-made file modifications.
 */
import { spawn } from 'node:child_process'

const DEFAULT_TIMEOUT_MS = 200

/**
 * Parse git status --porcelain output into file paths.
 *
 * Format: XY filename
 * - XY is a 2-char status code
 * - For renames: XY old -> new (take new path)
 */
export function parseGitStatusOutput(output: string): string[] {
  if (!output.trim()) return []

  return output
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      // Strip 2-char status + space prefix
      const filePart = line.slice(3)
      // Handle renames: "old.ts -> new.ts"
      const arrowIndex = filePart.indexOf(' -> ')
      return arrowIndex !== -1 ? filePart.slice(arrowIndex + 4) : filePart
    })
}

/**
 * Get list of changed files from git status.
 *
 * Returns file paths from `git status --porcelain`.
 * Returns empty array on timeout, error, or if not a git repo.
 */
export async function getGitFileStatus(cwd: string, timeoutMs: number = DEFAULT_TIMEOUT_MS): Promise<string[]> {
  return new Promise((resolve) => {
    const timeoutId = setTimeout(() => {
      resolve([])
    }, timeoutMs)

    const proc = spawn('git', ['status', '--porcelain'], {
      cwd,
      stdio: ['ignore', 'pipe', 'ignore'],
      shell: false,
    })

    let stdout = ''

    proc.stdout.on('data', (data: Buffer) => {
      stdout += data.toString()
    })

    proc.on('close', (code) => {
      clearTimeout(timeoutId)
      if (code === 0) {
        resolve(parseGitStatusOutput(stdout))
      } else {
        resolve([])
      }
    })

    proc.on('error', () => {
      clearTimeout(timeoutId)
      resolve([])
    })
  })
}
```

**Step 2: Add export to index.ts**

Add to `packages/sidekick-core/src/index.ts` after the `isInSandbox` export (line 209):

```typescript
export { getGitFileStatus, parseGitStatusOutput } from './git-status'
```

**Step 3: Run tests**

Run: `pnpm --filter @sidekick/core test -- --run src/__tests__/git-status.test.ts`
Expected: All PASS

**Step 4: Typecheck**

Run: `pnpm --filter @sidekick/core exec tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```
feat(core): add getGitFileStatus utility for git status diffing
```

---

### Task 3: Bash change detection staging handler - tests

**Files:**
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts`

**Step 1: Add test describe block**

Add the following test section after the `registerStageStopReminders` describe block (after line 708). Model tests on the existing `registerStageStopReminders` tests.

Key test cases to add in a `describe('registerStageBashChanges', () => { ... })` block:

1. **Registers two handlers** - one hook handler for UserPromptSubmit, one transcript handler for ToolResult
2. **Baseline capture** - UserPromptSubmit handler calls `getGitFileStatus` and stores baseline
3. **Stages VC when Bash modifies source file** - ToolResult with toolName='Bash', git status shows new `.ts` file vs baseline
4. **Does not stage when Bash doesn't modify files** - git status unchanged from baseline
5. **Does not stage for non-Bash tools** - ToolResult with toolName='Read'
6. **Does not stage when changed file is not source code** - git shows new `.md` file
7. **Skips git call when VC already staged** - idempotency via factory
8. **Handles no baseline (daemon restart mid-turn)** - no baseline stored, returns undefined
9. **Once-per-turn reactivation** - same logic as existing VC staging handler

Mock `getGitFileStatus` at module level. Use `createTestTranscriptEvent` helper adapted for ToolResult eventType.

**Step 2: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts`
Expected: FAIL - module not found / function not defined

---

### Task 4: Bash change detection staging handler - implementation

**Files:**
- Create: `packages/feature-reminders/src/handlers/staging/stage-stop-bash-changes.ts`
- Modify: `packages/feature-reminders/src/handlers/staging/index.ts`

**Step 1: Write the handler**

```typescript
/**
 * Stage verify-completion when Bash tool modifies source files
 *
 * Two cooperating handlers sharing closure state:
 * 1. UserPromptSubmit hook handler - captures git status baseline per session
 * 2. ToolResult transcript handler - compares git status after Bash execution
 *
 * @see docs/plans/2026-02-16-bash-vc-detection-design.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { getGitFileStatus } from '@sidekick/core'
import { isDaemonContext, isHookEvent, isTranscriptEvent } from '@sidekick/types'
import type { DaemonContext } from '@sidekick/types'
import picomatch from 'picomatch'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'

const GIT_STATUS_TIMEOUT_MS = 200

export function registerStageBashChanges(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  // Shared state: per-session git baselines
  const baselines = new Map<string, string[]>()

  const cwd = context.paths.projectDir

  // Handler A: Capture git baseline on UserPromptSubmit
  context.handlers.register({
    id: 'reminders:git-baseline-capture',
    priority: 40, // Before unstage-verify-completion (45)
    filter: { kind: 'hook', hooks: ['UserPromptSubmit'] },
    handler: async (event, ctx) => {
      if (!isHookEvent(event)) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context?.sessionId
      if (!sessionId) return

      const files = await getGitFileStatus(cwd, GIT_STATUS_TIMEOUT_MS)
      baselines.set(sessionId, files)

      daemonCtx.logger.debug('Git baseline captured', {
        sessionId,
        fileCount: files.length,
      })
    },
  })

  // Handler B: Detect Bash file changes on ToolResult
  createStagingHandler(context, {
    id: 'reminders:stage-stop-bash-changes',
    priority: 55, // Between default (50) and VC via Write/Edit (60)
    filter: { kind: 'transcript', eventTypes: ['ToolResult'] },
    execute: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return undefined

      // Only check Bash tool results
      const toolName = event.payload.toolName
      if (toolName !== 'Bash') return undefined

      const sessionId = event.context?.sessionId
      if (!sessionId) return undefined

      // Get baseline - if none exists (daemon restart mid-turn), skip
      const baseline = baselines.get(sessionId)
      if (!baseline) {
        ctx.logger.debug('Bash VC: no baseline for session, skipping', { sessionId })
        return undefined
      }

      // Check once-per-turn reactivation (same logic as stage-stop-reminders)
      const metrics = event.metadata.metrics
      const lastConsumed = await ctx.staging.getLastConsumed('Stop', ReminderIds.VERIFY_COMPLETION)
      if (lastConsumed?.stagedAt) {
        const shouldReactivate = metrics.turnCount > lastConsumed.stagedAt.turnCount
        if (!shouldReactivate) {
          ctx.logger.debug('Bash VC: skipped (already consumed this turn)', {
            currentTurn: metrics.turnCount,
            lastConsumedTurn: lastConsumed.stagedAt.turnCount,
          })
          return undefined
        }
      }

      // Run git status and compare
      const current = await getGitFileStatus(cwd, GIT_STATUS_TIMEOUT_MS)
      const baselineSet = new Set(baseline)
      const newFiles = current.filter((f) => !baselineSet.has(f))

      if (newFiles.length === 0) return undefined

      // Filter through source code patterns
      const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
      const sourceMatches = newFiles.filter((f) => picomatch.isMatch(f, config.source_code_patterns))

      if (sourceMatches.length === 0) {
        ctx.logger.debug('Bash VC: new files found but no source code matches', {
          newFiles,
        })
        return undefined
      }

      ctx.logger.info('Bash VC: staging verify-completion', {
        sourceMatches,
        turnCount: metrics.turnCount,
        toolCount: metrics.toolCount,
      })

      return {
        reminderId: ReminderIds.VERIFY_COMPLETION,
        targetHook: 'Stop',
      }
    },
  })
}
```

**Step 2: Register in staging/index.ts**

Add import after line 14:
```typescript
import { registerStageBashChanges } from './stage-stop-bash-changes'
```

Add call after line 22 (after `registerStageStopReminders`):
```typescript
registerStageBashChanges(context)
```

**Step 3: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts`
Expected: All PASS

**Step 4: Build and typecheck**

Run: `pnpm build && pnpm typecheck`
Expected: No errors

**Step 5: Commit**

```
feat(reminders): detect Bash file changes via git status diffing

Stages verify-completion when Bash tool modifies source code files.
Uses git status baseline captured at UserPromptSubmit, compared
after each Bash ToolResult. Closes sidekick-kqu.
```

---

### Task 5: Verify end-to-end

**Step 1: Run full test suite**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Run: `pnpm --filter @sidekick/feature-reminders test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: All PASS

**Step 2: Build the entire project**

Run: `pnpm build && pnpm typecheck`
Expected: No errors

**Step 3: Run lint**

Run: `pnpm lint`
Expected: No errors
