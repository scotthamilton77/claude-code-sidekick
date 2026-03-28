# Refine `decision:recorded` Usage

**Date**: 2026-03-28
**Bead**: claude-code-sidekick-fzk
**Status**: Draft

## Problem

The `decision:recorded` event is used inconsistently:

1. **Non-decisions logged**: Site #3 (UserPrompt forces immediate analysis) has no else branch — the action is unconditional, not a decision. Site #4 (countdown > 0, defer) is a timer tick at a 5:1 noise ratio.
2. **Real decisions missing**: Threshold-based staging/unstaging of reminders in `feature-reminders` involves genuine branching logic but emits no `decision:recorded` events.
3. **Factory location**: `DecisionEvents` lives in `feature-session-summary`, but `feature-reminders` now needs it too.

## Design Principles

Two rules govern whether a site emits `decision:recorded`:

1. **No else = no decision.** If the code path always takes the same action with no alternative branch, it is unconditional — not a decision.
2. **Positive-only for high-frequency triggers.** When the "else" branch fires orders of magnitude more often than the "if" branch (e.g., 59 tool results below threshold per 1 staging), only log the action branch. The no-op side is noise, not signal. Exception: balanced 1:1 pairs (e.g., BulkProcessingComplete skip vs. call) log both branches.

## Changes

### Part 1: Centralize `DecisionEvents` factory

Move `DecisionEvents` from `feature-session-summary/src/events.ts` to `packages/types/src/events.ts`, co-located with the `DecisionRecordedPayload` type it constructs. Both `feature-session-summary` and `feature-reminders` import from `@sidekick/types`.

The factory is a pure data-stamping function with no business logic — it belongs with its type definition.

Update these downstream references:
- `feature-session-summary/src/events.ts`: Remove `DecisionEvents` definition.
- `feature-session-summary/src/index.ts`: Remove `DecisionEvents` re-export (or re-export from `@sidekick/types` if external consumers exist — but per project constraints, no backward compat needed).
- `feature-session-summary/src/__tests__/events.test.ts`: Update `DecisionEvents` import to `@sidekick/types`. Consider relocating the factory tests to `packages/types/src/__tests__/` since the factory now lives there.

### Part 2: Remove non-decisions

**Site #3 — UserPrompt always forces analysis** (`update-summary.ts` ~line 151):
Remove the `decision:recorded` emission. The `isUserPrompt` check has no else branch; UserPrompt unconditionally triggers analysis.

**Site #4 — ToolResult countdown > 0, defer** (`update-summary.ts` ~line 166):
Remove the `decision:recorded` emission. Countdown values range from 5 (low confidence) to 10 (medium) to 10000 (high), producing noise ratios from 5:1 up to 10000:1. These are timer ticks, not decisions. The countdown decrement and state save remain unchanged.

### Part 3: Existing sites retained

**Sites #1 and #2 — BulkProcessingComplete** (`update-summary.ts` ~lines 120-141):
Keep both. These are a mutually exclusive 1:1 pair that fires once per session start. Both outcomes carry meaning: "no user turns, skip" vs. "has turns, analyze."

**Site #5 — ToolResult countdown reaches zero** (`update-summary.ts` ~line 182):
Keep, now as positive-only. This is the meaningful outcome of the countdown — analysis is triggered.

### Part 4: Add 5 new decision sites in `feature-reminders`

All new sites are **positive-only** — they fire when the system takes an active action as a result of a branching condition.

#### Site A: VC tool re-staging (threshold reached)

**File**: `handlers/staging/track-verification-tools.ts`
**Trigger**: File edit tool call when tool is in `verified` or `cooldown` state and `editsSinceVerified >= clearing_threshold`.
**Payload**:
```typescript
{
  decision: 'staged',
  reason: `edits reached clearing threshold (${edits}/${threshold})`,
  subsystem: 'vc-reminders',
  title: 'Re-stage VC reminder (threshold reached)',
}
```

#### Site B: VC tool unstaging (verification passed)

**File**: `handlers/staging/track-verification-tools.ts`
**Trigger**: Bash command matches a verification tool pattern.
**Payload**:
```typescript
{
  decision: 'unstaged',
  reason: `verification passed for ${toolName} (matched ${pattern})`,
  subsystem: 'vc-reminders',
  title: 'Unstage VC reminder (verified)',
}
```

#### Site C: Pause-and-reflect staging (threshold reached)

**File**: `handlers/staging/stage-pause-and-reflect.ts`
**Trigger**: Tool count since baseline exceeds `pause_and_reflect_threshold`.
**Payload**:
```typescript
{
  decision: 'staged',
  reason: `tools since baseline reached threshold (${count}/${threshold})`,
  subsystem: 'pause-reflect',
  title: 'Stage pause-and-reflect reminder',
}
```

#### Site D: User prompt throttle staging (threshold reached)

**File**: `handlers/staging/stage-default-user-prompt.ts`
**Trigger**: Message count (UserPrompt or AssistantMessage) reaches `reminder_thresholds[reminderId]`.
**Payload**:
```typescript
{
  decision: 'staged',
  reason: `message count reached threshold (${count}/${threshold})`,
  subsystem: 'user-prompt-reminders',
  title: 'Stage user-prompt reminder',
}
```

#### Site E: VC cycle limit reached (unstage all)

**File**: `handlers/staging/unstage-verify-completion.ts`
**Trigger**: `cycleCount >= max_verification_cycles` on UserPromptSubmit.
**Payload**:
```typescript
{
  decision: 'unstaged-all',
  reason: `verification cycle limit reached (${cycles}/${maxCycles})`,
  subsystem: 'vc-reminders',
  title: 'Unstage all VC reminders (cycle limit)',
}
```

## Complete Inventory

| Site | Subsystem | Trigger | decision | Branches logged |
|------|-----------|---------|----------|-----------------|
| 1 | `session-summary` | BulkProcessingComplete, 0 turns | `skipped` | Both (1:1 pair) |
| 2 | `session-summary` | BulkProcessingComplete, >0 turns | `calling` | Both (1:1 pair) |
| 5 | `session-summary` | ToolResult, countdown = 0 | `calling` | Positive only |
| A | `vc-reminders` | File edit, edits >= threshold | `staged` | Positive only |
| B | `vc-reminders` | Bash matches verification | `unstaged` | Positive only |
| C | `pause-reflect` | Tools >= P&R threshold | `staged` | Positive only |
| D | `user-prompt-reminders` | Prompts >= throttle | `staged` | Positive only |
| E | `vc-reminders` | Cycle limit reached | `unstaged-all` | Positive only |

**Removed**: Site #3 (unconditional), Site #4 (noise)

## Testing Strategy

Add decision event assertions to each handler's existing test file. No dedicated decision-events test file — the events are emitted inline within handler logic, so tests belong with the handlers.

- `feature-session-summary/src/__tests__/event-emission.test.ts`: Verify sites 1, 2, 5 emit correctly; verify sites 3, 4 no longer emit.
- `feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`: Verify sites A, B emit on threshold/match.
- `feature-reminders/src/__tests__/staging-handlers.test.ts`: Verify sites C, D, E emit on their respective thresholds/limits.

## Acceptance Criteria

- Build passes (`pnpm build`)
- Typecheck passes (`pnpm typecheck`)
- Lint passes (`pnpm lint`)
- All affected tests pass
- `DecisionEvents` factory importable from `@sidekick/types`
- No `decision:recorded` emissions without a branching condition
- No high-frequency noise from negative branches
