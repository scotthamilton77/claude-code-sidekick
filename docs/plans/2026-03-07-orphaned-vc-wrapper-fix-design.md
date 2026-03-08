# Fix Orphaned verify-completion Wrapper Reminder

**Date:** 2026-03-07
**Issue:** sidekick-tw9t
**Status:** Approved

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
