# Design: Move P&R Stage/Unstage Triggers to Post-Execution

**Bead**: claude-code-sidekick-uot
**Date**: 2026-04-04

## 1. Context

When Claude calls a tool, the execution sequence is:

1. Claude generates `tool_use` → transcript JSONL updated → **ToolCall** event fires (daemon)
2. **PreToolUse** hook fires (CLI) → may block the tool
3. If not blocked → tool executes → transcript updated → **ToolResult** event fires (daemon)

Staging handlers (`stage-pause-and-reflect`, `track-verification-tools`) currently fire on **ToolCall** (step 1), before the blocking decision (step 2). If PreToolUse blocks, the tool never executes but staging/unstaging cascades already happened:

- VC reminders unstaged (P&R cascade) for edits that never happened
- Per-tool VC staged for blocked file edits
- P&R baseline state updated for non-executed tools

## 2. Design

### Part 1: P&R staging — ToolCall → ToolResult

**File**: `packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts`

Change the `createStagingHandler` filter from `ToolCall` to `ToolResult`:

```typescript
// Before:
filter: { kind: 'transcript', eventTypes: ['ToolCall'] },

// After:
filter: { kind: 'transcript', eventTypes: ['ToolResult'] },
```

This is safe because P&R only reads `metrics.toolsThisTurn` (already incremented on ToolCall) and `metrics.turnCount`. No tool input needed. P&R now stages after the threshold tool executes, blocking the *next* tool at PreToolUse.

**Cascade impact**: P&R (priority 80) fires before track-verification-tools (priority 60) on the same ToolResult. The cascade (`onReminderStaged` → unstage VC) runs before VC is staged → no-op. Both end up coexisting correctly on their respective hooks (P&R on PreToolUse, VC on Stop).

### Part 2: track-verification-tools — Two-Phase Staging

**File**: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts`

Replace the single ToolCall handler with a two-handler pattern (following `stage-stop-bash-changes.ts` precedent):

**Handler A** (existing, modified) — ToolCall + ToolResult transcript handler:

```typescript
// Closure-scoped state
const pendingToolCalls = new Map<string, { toolName: string; input: Record<string, unknown> }>()

filter: { kind: 'transcript', eventTypes: ['ToolCall', 'ToolResult'] },
handler: async (event) => {
  if (event.eventType === 'ToolCall') {
    // Phase 1: Capture intent, no staging
    const toolUseId = (entry as { id?: string }).id
    if (toolUseId && toolName) {
      pendingToolCalls.set(`${sessionId}:${toolUseId}`, { toolName, input })
    }
    return
  }

  if (event.eventType === 'ToolResult') {
    // Phase 2: Confirm execution, run staging/unstaging
    const toolUseId = (entry as { tool_use_id?: string }).tool_use_id
    const key = `${sessionId}:${toolUseId}`
    const pending = pendingToolCalls.get(key)
    if (!pending) return
    pendingToolCalls.delete(key)

    // Execute existing handleFileEdit / handleBashCommand with pending data
  }
}
```

**Correlation**: ToolCall entries have `entry.id` (from `tool_use` block). ToolResult entries have `entry.tool_use_id`. Both are the same Claude-assigned correlation ID, mapped by `processNestedToolUses`/`processNestedToolResults` in transcript-metrics-engine.ts.

**Handler B** (new) — Pending map cleanup on UserPromptSubmit:

```typescript
filter: { kind: 'hook', hooks: ['UserPromptSubmit'] },
handler: async (event) => {
  // Clear all pending entries for this session (new turn = stale)
  clearPendingForSession(sessionId)
}
```

Map entries are also scoped by sessionId prefix, so cross-session contamination is impossible.

### Part 3: Pending Map Cleanup

Handled by Part 2's **Handler B** — a single cleanup handler within the `registerTrackVerificationTools` function:

```typescript
filter: { kind: 'hook', hooks: ['UserPromptSubmit', 'Stop'] },
handler: async (event) => {
  clearPendingForSession(sessionId)
}
```

Self-contained in the same closure as the pending map. No cross-file coordination needed.

### Part 4: P&R Cleanup on Stop

**Files**:
- `packages/types/src/services/reminder-coordinator.ts` — add `onStop()` to interface
- `packages/feature-reminders/src/orchestrator.ts` — implement `onStop()`
- New handler registration (in staging index or dedicated file)

Add `onStop()` to `ReminderCoordinator`:

```typescript
export interface ReminderCoordinator {
  onReminderStaged(...): Promise<void>
  onReminderConsumed(...): Promise<void>
  onUserPromptSubmit(...): Promise<void>
  /** Called when Stop hook fires. Cleans up reminders that are moot when agent stops. */
  onStop(sessionId: string): Promise<void>
}
```

Implement in `ReminderOrchestrator`:

```typescript
async onStop(sessionId: string): Promise<void> {
  // Agent stopping = P&R is moot (designed to interrupt runaway execution)
  try {
    const staging = this.deps.getStagingService(sessionId)
    const deleted = await staging.deleteReminder('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)
    if (deleted) {
      logEvent(/* reminderUnstaged: reason='agent_stopping' */)
    }
  } catch (err) {
    this.deps.logger.warn('Failed to unstage P&R on Stop', { ... })
  }
}
```

Register a daemon-side Stop handler that calls `orchestrator.onStop(sessionId)`. This is defensive: Rule 4 (VC consumed → unstage P&R) already covers the VC case, but this handles the no-VC case where P&R would otherwise linger.

## 3. Handler Priority and Ordering

On the same ToolResult event, handlers fire by priority (highest first):

| Priority | Handler | Action |
|----------|---------|--------|
| 80 | stage-pause-and-reflect | Stages P&R → cascade tries to unstage VC → **no-op** (VC not yet staged) |
| 60 | track-verification-tools | Stages VC → succeeds (cascade already ran) |
| 55 | stage-stop-bash-changes | Stages VC for bash changes (independent) |

Result: P&R on PreToolUse and VC on Stop coexist safely. No cascading block problem because they target different hooks.

## 4. Edge Case Matrix

| Scenario | Before Fix | After Fix |
|----------|-----------|-----------|
| Tool blocked at PreToolUse | VC unstaged incorrectly, per-tool VC staged for non-edit | No staging occurs (no ToolResult) ✓ |
| Last tool, then agent stops | P&R cascade unstages VC prematurely | P&R cascade is no-op; VC stages; Stop consumes VC ✓ |
| VC consumed on Stop, agent verifies | Rule 4 unstages P&R (existing) | Same + Part 4 as defensive backup ✓ |
| Agent stops, no VC staged | P&R lingers on PreToolUse | Part 4 cleans up P&R on Stop ✓ |
| Orphaned pending map entry | N/A | Cleaned on UserPromptSubmit/Stop ✓ |
| P&R reactivation after consumption | Works via baseline + turnCount | Same — ToolResult has same metrics ✓ |
| Bash verification command | Unstages VC immediately | Same, but only after Bash actually executes ✓ |

## 5. Test Plan

### New Tests

**`track-verification-tools.test.ts`** (or new `track-verification-tools-two-phase.test.ts`):
- ToolCall without ToolResult → no staging occurs
- ToolCall + ToolResult → staging occurs with correct input
- Orphaned entries cleaned on UserPromptSubmit
- Orphaned entries cleaned on Stop
- ToolResult without preceding ToolCall → no staging (graceful)
- Multiple pending entries across sessions don't contaminate

**`staging-handlers.test.ts`** (P&R section):
- P&R stages on ToolResult (not ToolCall)
- P&R cascade on ToolResult is no-op when VC not yet staged
- P&R + VC coexistence after same ToolResult event

**`orchestrator.test.ts`**:
- `onStop()` unstages P&R from PreToolUse
- `onStop()` no-op when P&R not staged
- `onStop()` error handling (logs warning, doesn't throw)

### Updated Tests

- Existing P&R staging tests: update event type from ToolCall to ToolResult
- Existing orchestrator cascade tests: verify behavior unchanged

## 6. Files to Modify

| File | Change |
|------|--------|
| `packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts` | Filter: ToolCall → ToolResult |
| `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts` | Two-phase: pending map, ToolCall capture + ToolResult execute, cleanup handlers |
| `packages/types/src/services/reminder-coordinator.ts` | Add `onStop(sessionId)` to interface |
| `packages/feature-reminders/src/orchestrator.ts` | Implement `onStop()` — delete P&R on Stop |
| `packages/feature-reminders/src/handlers/staging/index.ts` | Register Stop handler calling `orchestrator.onStop()` |
| `packages/feature-reminders/src/__tests__/staging-handlers.test.ts` | Update P&R tests for ToolResult |
| `packages/feature-reminders/src/__tests__/orchestrator.test.ts` | Add `onStop()` tests |
| New: `packages/feature-reminders/src/__tests__/track-verification-tools-two-phase.test.ts` | Two-phase staging tests |

## 7. Verification

```bash
# Unit tests
pnpm --filter @sidekick/feature-reminders test

# Build + typecheck
pnpm build && pnpm typecheck

# Lint
pnpm lint

# Integration (user must run outside sandbox)
INTEGRATION_TESTS=1 pnpm test
```
