# Fix Orphaned verify-completion Wrapper Reminder

**Goal:** Prevent the `verify-completion` wrapper reminder from staging without per-tool VC children, fixing two independent orphaning paths.

**Architecture:** Extract shared file-to-tool staging logic from `handleFileEdit`, reuse in `stage-stop-bash-changes` and `unstage-verify-completion`. Enforce invariant: wrapper never stages without at least one per-tool child.

**Tech Stack:** TypeScript, vitest, @sidekick/feature-reminders, picomatch

**Branch:** `fix/orphaned-vc-wrapper`

**Date:** 2026-03-07
**Issue:** sidekick-tw9t
**Status:** Approved

---

## Problem

The `verify-completion` wrapper reminder can become orphaned — staged in the Stop hook queue with zero per-tool VC children (`vc-build`, `vc-typecheck`, `vc-test`, `vc-lint`). When the Stop hook fires, the agent sees "Verify completion before stopping" but has no actionable verification steps. This also triggers an unnecessary LLM classification call.

### Root Cause

Two independent staging paths create the wrapper without awareness of per-tool state:

**Scenario A — `stage-stop-bash-changes`:** After a Bash command, git diff detects new source files. The handler stages the wrapper directly via `createStagingHandler`, returning a single `StagingAction` for `verify-completion` only. It never stages per-tool reminders.

**Scenario B — `unstage-verify-completion`:** On `UserPromptSubmit`, if `vc-unverified` state exists (from a prior non-blocking classification), the handler re-stages the wrapper for the next Stop. It does not check or re-stage per-tool reminders.

### Reproduction

Both scenarios are reproduced in `orphaned-vc-wrapper.test.ts`. The staging state at each step confirms wrapper-without-children.

## Design

### Invariant

**The wrapper reminder must never be staged without at least one per-tool child.** All paths that stage the wrapper must go through per-tool staging logic first.

### Change 1: Extract shared file-to-tool staging logic

Extract the "file path → which tools need staging" logic from `handleFileEdit()` in `track-verification-tools.ts` into a reusable function:

```typescript
export async function stageToolsForFiles(
  filePaths: string[],
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors
): Promise<boolean> // returns true if any tool was staged
```

This function:
- Iterates file paths × verification tools
- Respects the per-tool state machine (staged/verified/cooldown with clearing_threshold)
- Stages per-tool reminders as needed
- If any per-tool reminder was staged, stages the wrapper
- Returns whether anything was staged

### Change 2: Refactor `handleFileEdit`

Replace the inline file-to-tool loop with a call to `stageToolsForFiles([filePath], ...)`.

### Change 3: Refactor `stage-stop-bash-changes`

Convert from `createStagingHandler` (single `StagingAction` return) to a direct handler registration. After computing `sourceMatches` from git diff:

- Read verification tools config and state (same as `track-verification-tools` does)
- Call `stageToolsForFiles(sourceMatches, ...)` with the matched file paths
- No longer stages the wrapper directly — the shared function handles it

This means `stage-stop-bash-changes` loses its dependency on `createStagingHandler` and gains a dependency on `stageToolsForFiles` from `track-verification-tools`.

### Change 4: Fix `unstage-verify-completion` re-staging path

When `vc-unverified` state exists and the handler would re-stage the wrapper:

1. Read `verification-tools.json` state for the session
2. Check if any tool has `status: 'staged'` or has accumulated enough edits to re-stage
3. If no tools need verification → skip re-staging the wrapper, delete `vc-unverified` state
4. If tools need verification → re-stage those per-tool reminders, then stage wrapper

### Impact on existing behavior

- `stage-stop-bash-changes` now stages per-tool reminders (new behavior). Previously it only staged the wrapper. This means a Bash command that creates `src/foo.ts` will now also stage `vc-build`, `vc-typecheck`, etc. — which is *more correct* than before.
- The cooldown/threshold state machine is respected, so recently-verified tools won't be immediately re-staged by Bash changes (same as with file edits).
- The wrapper's dual-mode behavior (blocking vs non-blocking via classifier) is unchanged — it still fires at Stop time with the same classification logic.

### Files changed

| File | Change |
|------|--------|
| `track-verification-tools.ts` | Extract `stageToolsForFiles`, refactor `handleFileEdit` to use it |
| `stage-stop-bash-changes.ts` | Convert to direct handler, use `stageToolsForFiles` |
| `unstage-verify-completion.ts` | Check per-tool state before re-staging wrapper |
| `orphaned-vc-wrapper.test.ts` | Update expectations: tests should now FAIL to reproduce orphaning |

### Test plan

1. Existing tests pass (no regression)
2. Reproduction tests updated: orphan scenarios now result in correct per-tool + wrapper staging (or no staging at all)
3. New test: `stage-stop-bash-changes` stages per-tool reminders for matching source files
4. New test: `unstage-verify-completion` skips re-staging when all tools are verified with zero pending edits

---

## Implementation Plan

### Task 1: Extract `stageToolsForFiles` from `track-verification-tools.ts`

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts:85-152`

**Step 1: Write the failing test**

Add to `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`:

```typescript
import { stageToolsForFiles } from '../../../handlers/staging/track-verification-tools.js'

describe('stageToolsForFiles', () => {
  it('is exported as a function', () => {
    expect(typeof stageToolsForFiles).toBe('function')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/handlers/staging/track-verification-tools.test.ts`
Expected: FAIL — `stageToolsForFiles` is not exported.

**Step 3: Extract and export `stageToolsForFiles`**

In `track-verification-tools.ts`, extract lines 100-151 from `handleFileEdit` into a new exported function. The function takes `filePaths: string[]` and iterates each path against each tool:

```typescript
/**
 * Stage per-tool VC reminders for the given file paths.
 * Respects the per-tool state machine (staged/verified/cooldown).
 * Stages the wrapper reminder if any per-tool reminder was staged.
 *
 * @returns true if any per-tool reminder was staged
 */
export async function stageToolsForFiles(
  filePaths: string[],
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors
): Promise<boolean> {
  const existingReminders = await daemonCtx.staging.listReminders('Stop')
  const stagedNames = new Set(existingReminders.map((r) => r.name))
  let anyStaged = false

  for (const filePath of filePaths) {
    for (const [toolName, toolConfig] of Object.entries(verificationTools)) {
      if (!toolConfig.enabled) continue

      const reminderId = TOOL_REMINDER_MAP[toolName]
      if (!reminderId) continue
      if (!picomatch.isMatch(filePath, toolConfig.clearing_patterns)) continue

      const current = toolsState[toolName]

      if (!current || current.status === 'staged') {
        if (!current) {
          toolsState[toolName] = {
            status: 'staged',
            editsSinceVerified: 0,
            lastVerifiedAt: null,
            lastStagedAt: Date.now(),
          }
        }
        await stageToolReminderIfNeeded(daemonCtx, reminderId, stagedNames)
        anyStaged = true
      } else {
        // verified or cooldown — count edits toward re-staging threshold
        const newEdits = current.editsSinceVerified + 1
        if (newEdits >= toolConfig.clearing_threshold) {
          toolsState[toolName] = {
            ...current,
            status: 'staged',
            editsSinceVerified: 0,
            lastStagedAt: Date.now(),
          }
          await stageToolReminderIfNeeded(daemonCtx, reminderId, stagedNames)
          anyStaged = true
        } else {
          toolsState[toolName] = {
            ...current,
            status: 'cooldown',
            editsSinceVerified: newEdits,
          }
        }
      }
    }
  }

  if (anyStaged) {
    await stageToolReminderIfNeeded(daemonCtx, ReminderIds.VERIFY_COMPLETION, stagedNames)
  }

  await remindersState.verificationTools.write(sessionId, toolsState)
  return anyStaged
}
```

**Step 4: Refactor `handleFileEdit` to use it**

Replace the body of `handleFileEdit` (lines 93-151) with:

```typescript
async function handleFileEdit(
  event: TranscriptEvent,
  daemonCtx: DaemonContext,
  sessionId: string,
  verificationTools: VerificationToolsMap,
  toolsState: VerificationToolsState,
  remindersState: RemindersStateAccessors
): Promise<void> {
  const filePath = extractToolInput(event)?.file_path as string | undefined
  if (!filePath) return

  // Guard: only track edits within the project directory
  const projectDir = daemonCtx.paths?.projectDir
  if (projectDir && !filePath.startsWith(projectDir)) return

  await stageToolsForFiles([filePath], daemonCtx, sessionId, verificationTools, toolsState, remindersState)
}
```

**Step 5: Run all track-verification-tools tests to verify no regression**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/handlers/staging/track-verification-tools.test.ts`
Expected: ALL PASS — behavior unchanged, just refactored.

**Step 6: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/track-verification-tools.ts \
       packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts
git commit -m "refactor(reminders): extract stageToolsForFiles from handleFileEdit"
```

---

### Task 2: Refactor `stage-stop-bash-changes` to use `stageToolsForFiles`

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-stop-bash-changes.ts`
- Test: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts`

**Step 1: Write the failing test**

Add to the `registerStageBashChanges` describe block in `staging-handlers.test.ts`:

```typescript
it('stages per-tool VC reminders when Bash modifies source files', async () => {
  registerStageBashChanges(ctx)

  // Capture baseline with no files
  mockGetGitFileStatus.mockResolvedValue([])
  const baselineHandler = handlers.getHandler('reminders:git-baseline-capture')
  await baselineHandler?.handler(
    createUserPromptSubmitEvent(),
    ctx as unknown as import('@sidekick/types').HandlerContext
  )

  // Bash creates a source file
  mockGetGitFileStatus.mockResolvedValue(['src/new-feature.ts'])
  const bashHandler = handlers.getHandler('reminders:stage-stop-bash-changes')
  const event = createToolResultEvent({ turnCount: 1, toolsThisTurn: 1, toolCount: 1 }, 'Bash')
  await bashHandler?.handler(event, ctx as unknown as import('@sidekick/types').HandlerContext)

  const names = staging.getRemindersForHook('Stop').map((r) => r.name)
  // Should have per-tool reminders AND wrapper
  expect(names).toContain('vc-build')
  expect(names).toContain('vc-typecheck')
  expect(names).toContain('vc-test')
  expect(names).toContain('vc-lint')
  expect(names).toContain('verify-completion')
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts -t "stages per-tool VC reminders"`
Expected: FAIL — currently only the wrapper is staged (1 reminder, not 5).

**Step 3: Refactor `stage-stop-bash-changes` to use `stageToolsForFiles`**

Replace Handler B (lines 59-134) in `stage-stop-bash-changes.ts`. Convert from `createStagingHandler` to direct handler registration:

```typescript
import type { VerificationToolsState } from '@sidekick/types'
import { stageToolsForFiles } from './track-verification-tools.js'
import { createRemindersState } from '../../state.js'

// ... in registerStageBashChanges, replace Handler B:

// Handler B: Detect Bash file changes on ToolResult
context.handlers.register({
  id: 'reminders:stage-stop-bash-changes',
  priority: 55,
  filter: { kind: 'transcript', eventTypes: ['ToolResult'] },
  handler: async (event, ctx) => {
    if (!isTranscriptEvent(event)) return
    if (event.metadata.isBulkProcessing) return
    if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

    const daemonCtx = ctx as unknown as DaemonContext

    const toolName = event.payload.toolName
    if (toolName !== 'Bash') return

    const sessionId = event.context?.sessionId
    if (!sessionId) return

    const baseline = baselines.get(sessionId)
    if (!baseline) {
      daemonCtx.logger.debug('Bash VC: no baseline for session, skipping', { sessionId })
      return
    }

    // Check once-per-turn reactivation
    const metrics = event.metadata.metrics
    const lastConsumed = await daemonCtx.staging.getLastConsumed('Stop', ReminderIds.VERIFY_COMPLETION)
    if (lastConsumed?.stagedAt) {
      const shouldReactivate = metrics.turnCount > lastConsumed.stagedAt.turnCount
      if (!shouldReactivate) {
        daemonCtx.logger.debug('Bash VC: skipped (already consumed this turn)', {
          currentTurn: metrics.turnCount,
          lastConsumedTurn: lastConsumed.stagedAt.turnCount,
        })
        return
      }
    }

    // Run git status and compare against baseline
    const current = await getGitFileStatus(cwd, GIT_STATUS_TIMEOUT_MS)
    const baselineSet = new Set(baseline)
    const newFiles = current.filter((f) => !baselineSet.has(f))

    daemonCtx.logger.debug('Bash VC: git status diff', {
      baselineCount: baseline.length,
      currentCount: current.length,
      newFileCount: newFiles.length,
    })

    if (newFiles.length === 0) return

    // Filter through source code patterns
    const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
    const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
    const sourceMatches = newFiles.filter((f) => picomatch.isMatch(f, config.source_code_patterns))

    if (sourceMatches.length === 0) {
      daemonCtx.logger.debug('Bash VC: new files found but no source code matches', { newFiles })
      return
    }

    daemonCtx.logger.info('Bash VC: staging per-tool reminders for source changes', {
      sourceMatches,
      turnCount: metrics.turnCount,
      toolCount: metrics.toolCount,
    })

    // Update baseline to current state
    baselines.set(sessionId, current)

    // Stage per-tool reminders using shared logic
    const verificationTools = config.verification_tools ?? {}
    const remindersState = createRemindersState(daemonCtx.stateService)
    const stateResult = await remindersState.verificationTools.read(sessionId)
    const toolsState: VerificationToolsState = { ...stateResult.data }

    await stageToolsForFiles(sourceMatches, daemonCtx, sessionId, verificationTools, toolsState, remindersState)
  },
})
```

Remove the `createStagingHandler` import if it's no longer used in this file.

**Step 4: Run tests to verify pass**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts -t "registerStageBashChanges"`
Expected: ALL PASS including the new test.

**Step 5: Run the Scenario A reproduction test — should no longer orphan**

First update `orphaned-vc-wrapper.test.ts` Scenario A: change the final assertion from `expect(wrapperOrphaned).toBe(true)` to:

```typescript
// FIX: wrapper is now staged WITH per-tool children
expect(hasWrapper(staging)).toBe(true)
expect(getPerToolNames(staging).length).toBeGreaterThan(0)
```

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/handlers/staging/orphaned-vc-wrapper.test.ts -t "Scenario A"`
Expected: PASS — wrapper staged with per-tool children.

**Step 6: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/stage-stop-bash-changes.ts \
       packages/feature-reminders/src/__tests__/staging-handlers.test.ts \
       packages/feature-reminders/src/__tests__/handlers/staging/orphaned-vc-wrapper.test.ts
git commit -m "fix(reminders): stage-stop-bash-changes stages per-tool VC reminders (sidekick-tw9t)"
```

---

### Task 3: Fix `unstage-verify-completion` re-staging path (Scenario B)

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/unstage-verify-completion.ts`
- Test: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts`

**Step 1: Write the failing test**

Add to the `registerUnstageVerifyCompletion` describe block in `staging-handlers.test.ts`:

```typescript
it('does not re-stage wrapper when all tools are verified with zero pending edits', async () => {
  const stateService = new MockStateService(testProjectDir)

  // Set vc-unverified state (would normally trigger re-staging)
  const vcUnverifiedPath = stateService.sessionStatePath(sessionId, 'vc-unverified.json')
  stateService.setStored(vcUnverifiedPath, {
    hasUnverifiedChanges: true,
    cycleCount: 1,
    setAt: { timestamp: Date.now(), turnCount: 1, toolsThisTurn: 5, toolCount: 5 },
    lastClassification: { category: 'OTHER', confidence: 0.5 },
  })

  // Set verification-tools state: all tools verified, zero pending edits
  const vtPath = stateService.sessionStatePath(sessionId, 'verification-tools.json')
  stateService.setStored(vtPath, {
    build: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
    typecheck: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
    test: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
    lint: { status: 'verified', editsSinceVerified: 0, lastVerifiedAt: Date.now(), lastStagedAt: Date.now() },
  })

  const ctxWithPath = createMockDaemonContext({
    staging, logger, handlers, assets, stateService,
    paths: { projectDir: testProjectDir, userConfigDir: '/mock/user', projectConfigDir: '/mock/project-config' },
  })

  registerUnstageVerifyCompletion(ctxWithPath)
  const handler = handlers.getHandler('reminders:unstage-verify-completion')
  await handler?.handler(createHookEvent(), ctxWithPath as unknown as import('@sidekick/types').HandlerContext)

  // Wrapper should NOT be re-staged — nothing needs verification
  expect(staging.getRemindersForHook('Stop')).toHaveLength(0)
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts -t "does not re-stage wrapper when all tools are verified"`
Expected: FAIL — currently re-stages wrapper unconditionally when vc-unverified exists.

**Step 3: Add per-tool state check to `unstage-verify-completion.ts`**

In the re-staging path (lines 58-82), before re-staging the wrapper, check if any tools actually need verification:

```typescript
import { createRemindersState } from '../../state.js'
// Add to existing imports from types:
import { type VerificationToolsMap } from '../../types.js'

// Inside the handler, in the re-staging branch (after line 57):

if (maxCycles < 0 || unverifiedState.cycleCount < maxCycles) {
  // Check if any tools actually need verification
  const verificationToolsResult = await remindersState.verificationTools.read(sessionId)
  const toolsState = verificationToolsResult.data

  const verificationTools = config.verification_tools ?? {}
  const hasToolsNeedingVerification = Object.entries(verificationTools).some(([toolName, toolConfig]) => {
    if (!toolConfig.enabled) return false
    const state = toolsState[toolName]
    if (!state) return true // never tracked = needs verification
    if (state.status === 'staged') return true
    if (state.status === 'verified' || state.status === 'cooldown') {
      return state.editsSinceVerified >= toolConfig.clearing_threshold
    }
    return false
  })

  if (!hasToolsNeedingVerification) {
    daemonCtx.logger.info('VC unstage: all tools verified, skipping wrapper re-stage', {
      sessionId,
      cycleCount: unverifiedState.cycleCount,
    })
    await remindersState.vcUnverified.delete(sessionId)
    // Fall through to delete all VC reminders
  } else {
    // Re-stage verify-completion for next Stop
    const reminder = resolveReminder(ReminderIds.VERIFY_COMPLETION, { ... })
    // ... existing re-staging logic ...
  }
}
```

The key change: wrap the existing re-staging logic in `if (hasToolsNeedingVerification)` and fall through to the delete-all path when no tools need it.

**Step 4: Run test to verify pass**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts -t "registerUnstageVerifyCompletion"`
Expected: ALL PASS including new test.

**Step 5: Update Scenario B reproduction test**

In `orphaned-vc-wrapper.test.ts`, update Scenario B final assertion:

```typescript
// FIX: wrapper is NOT re-staged because all tools are verified
expect(hasWrapper(staging)).toBe(false)
expect(getPerToolNames(staging)).toHaveLength(0)
```

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/handlers/staging/orphaned-vc-wrapper.test.ts -t "Scenario B"`
Expected: PASS.

**Step 6: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/unstage-verify-completion.ts \
       packages/feature-reminders/src/__tests__/staging-handlers.test.ts \
       packages/feature-reminders/src/__tests__/handlers/staging/orphaned-vc-wrapper.test.ts
git commit -m "fix(reminders): unstage-verify-completion checks per-tool state before re-staging (sidekick-tw9t)"
```

---

### Task 4: Full regression + quality gates

**Step 1: Run all feature-reminders tests**

Run: `pnpm --filter @sidekick/feature-reminders test`
Expected: ALL PASS.

**Step 2: Run full build + typecheck + lint**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: ALL PASS.

**Step 3: Run full test suite (excluding IPC)**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: ALL PASS.

**Step 4: Commit any fixups if needed, then push**

```bash
git push -u origin fix/orphaned-vc-wrapper
```
