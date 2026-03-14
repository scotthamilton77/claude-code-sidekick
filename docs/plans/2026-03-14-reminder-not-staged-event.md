# reminder:not-staged Event Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a new `reminder:not-staged` canonical event type (#32) that fires when the daemon evaluates a reminder and decides NOT to stage it, enabling forensic debugging of "why wasn't I reminded?"

**Architecture:** Define the event type, payload interface, and factory in the existing event system. Wire `logEvent()` calls at 11 high-value negative decision points across 5 staging handler files. All additions are additive — no existing behavior changes.

**Tech Stack:** TypeScript, Vitest, Pino structured logging, `@sidekick/types`, `@sidekick/feature-reminders`

**Design doc:** `docs/plans/2026-03-13-reminder-event-enrichment-design.md`

**Bead:** `claude-code-sidekick-n2m`

---

### Task 1: Define `ReminderNotStagedPayload` and register the event type

**Files:**
- Modify: `packages/types/src/events.ts`

**Step 1: Write the failing test**

Create a test that imports the new type and event registration:

Create file: `packages/types/src/__tests__/reminder-not-staged-event.test.ts`

```typescript
import { describe, it, expect } from 'vitest'
import {
  UI_EVENT_TYPES,
  UI_EVENT_VISIBILITY,
  type UIEventPayloadMap,
  type ReminderNotStagedPayload,
  type CanonicalEvent,
} from '../events.js'

describe('reminder:not-staged event type', () => {
  it('should be in UI_EVENT_TYPES array', () => {
    expect(UI_EVENT_TYPES).toContain('reminder:not-staged')
  })

  it('should have log visibility', () => {
    expect(UI_EVENT_VISIBILITY['reminder:not-staged']).toBe('log')
  })

  it('should be in UIEventPayloadMap', () => {
    // Type-level test: if this compiles, the mapping exists
    const _check: UIEventPayloadMap['reminder:not-staged'] = {
      reminderName: 'vc-build',
      hookName: 'Stop',
      reason: 'below_threshold',
    }
    expect(_check.reminderName).toBe('vc-build')
  })

  it('should support optional threshold fields', () => {
    const payload: ReminderNotStagedPayload = {
      reminderName: 'vc-build',
      hookName: 'Stop',
      reason: 'below_threshold',
      threshold: 3,
      currentValue: 1,
      triggeredBy: 'file_edit',
    }
    expect(payload.threshold).toBe(3)
    expect(payload.currentValue).toBe(1)
    expect(payload.triggeredBy).toBe('file_edit')
  })

  it('should be usable in CanonicalEvent generic', () => {
    // Type-level test: CanonicalEvent<'reminder:not-staged'> should compile
    const event: CanonicalEvent<'reminder:not-staged'> = {
      type: 'reminder:not-staged',
      visibility: 'log',
      source: 'daemon',
      time: Date.now(),
      context: { sessionId: 'test' },
      payload: {
        reminderName: 'vc-build',
        hookName: 'Stop',
        reason: 'below_threshold',
      },
    }
    expect(event.type).toBe('reminder:not-staged')
  })
})
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/types test -- --run packages/types/src/__tests__/reminder-not-staged-event.test.ts`
Expected: FAIL — `ReminderNotStagedPayload` not exported, `'reminder:not-staged'` not in array

**Step 3: Implement the type registration**

In `packages/types/src/events.ts`, make these changes:

**3a.** Add `'reminder:not-staged'` to `UI_EVENT_TYPES` array (after `'reminder:cleared'`, line ~777):
```typescript
  'reminder:cleared',
  'reminder:not-staged',
```

**3b.** Add the payload interface (after `ReminderClearedPayload`, line ~861):
```typescript
/** Payload for `reminder:not-staged` — a reminder was evaluated but not staged. */
export interface ReminderNotStagedPayload {
  /** Which reminder was evaluated. e.g., 'vc-build', 'pause-and-reflect' */
  reminderName: string
  /** Which hook triggered the evaluation */
  hookName: string
  /** Why staging was skipped */
  reason: string
  /** For threshold-gated decisions: the threshold value */
  threshold?: number
  /** For threshold-gated decisions: the current counter value */
  currentValue?: number
  /** What action triggered the evaluation */
  triggeredBy?: string
}
```

**3c.** Add to `UIEventPayloadMap` (after `'reminder:cleared'` line ~1061):
```typescript
  'reminder:not-staged': ReminderNotStagedPayload
```

**3d.** Add to `UI_EVENT_VISIBILITY` (after `'reminder:cleared'` line ~1139):
```typescript
  'reminder:not-staged': 'log',
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/types test -- --run packages/types/src/__tests__/reminder-not-staged-event.test.ts`
Expected: PASS

**Step 5: Run typecheck to verify no regressions**

Run: `pnpm typecheck`
Expected: PASS — the `satisfies Record<UIEventType, EventVisibility>` constraint on `UI_EVENT_VISIBILITY` ensures the map is complete

**Step 6: Commit**

```bash
git add packages/types/src/events.ts packages/types/src/__tests__/reminder-not-staged-event.test.ts
git commit -m "feat(types): add reminder:not-staged event type (#32)"
```

---

### Task 2: Add `reminderNotStaged` factory function

**Files:**
- Modify: `packages/feature-reminders/src/events.ts`
- Modify: `packages/feature-reminders/src/__tests__/events.test.ts`

**Step 1: Write the failing test**

Add to `packages/feature-reminders/src/__tests__/events.test.ts`, after the `remindersCleared` describe block:

```typescript
  describe('reminderNotStaged', () => {
    it('should create ReminderNotStaged events with required fields', () => {
      const event = ReminderEvents.reminderNotStaged(
        { sessionId: 'sess-123', hook: 'Stop' },
        {
          reminderName: 'vc-build',
          hookName: 'Stop',
          reason: 'below_threshold',
        }
      )

      expect(event.type).toBe('reminder:not-staged')
      expect(event.source).toBe('daemon')
      expect(event.payload.reminderName).toBe('vc-build')
      expect(event.payload.hookName).toBe('Stop')
      expect(event.payload.reason).toBe('below_threshold')
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.context.hook).toBe('Stop')
      expect(event.time).toBeGreaterThan(0)
    })

    it('should include optional threshold fields when provided', () => {
      const event = ReminderEvents.reminderNotStaged(
        { sessionId: 'sess-456' },
        {
          reminderName: 'pause-and-reflect',
          hookName: 'PreToolUse',
          reason: 'below_threshold',
          threshold: 5,
          currentValue: 2,
          triggeredBy: 'tool_result',
        }
      )

      expect(event.payload.threshold).toBe(5)
      expect(event.payload.currentValue).toBe(2)
      expect(event.payload.triggeredBy).toBe('tool_result')
    })

    it('should omit optional fields when not provided', () => {
      const event = ReminderEvents.reminderNotStaged(
        { sessionId: 'sess-789' },
        {
          reminderName: 'vc-build',
          hookName: 'Stop',
          reason: 'feature_disabled',
        }
      )

      expect(event.payload.threshold).toBeUndefined()
      expect(event.payload.currentValue).toBeUndefined()
      expect(event.payload.triggeredBy).toBeUndefined()
    })
  })
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/events.test.ts`
Expected: FAIL — `reminderNotStaged` is not a function

**Step 3: Implement the factory**

In `packages/feature-reminders/src/events.ts`:

**3a.** Add import for the new type (line ~12, add to existing import):
```typescript
import type {
  ReminderConsumedEvent,
  ReminderUnstagedEvent,
  RemindersClearedEvent,
  ReminderNotStagedEvent,
  EventLogContext,
} from '@sidekick/types'
```

**3b.** Add the factory method inside `ReminderEvents` (before the closing `}` of the object, line ~118):

```typescript

  /**
   * Create a ReminderNotStaged event (logged when daemon evaluates but decides not to stage).
   */
  reminderNotStaged(
    context: EventLogContext,
    state: {
      reminderName: string
      hookName: string
      reason: string
      threshold?: number
      currentValue?: number
      triggeredBy?: string
    }
  ): ReminderNotStagedEvent {
    return {
      type: 'reminder:not-staged',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        reminderName: state.reminderName,
        hookName: state.hookName,
        reason: state.reason,
        ...(state.threshold !== undefined && { threshold: state.threshold }),
        ...(state.currentValue !== undefined && { currentValue: state.currentValue }),
        ...(state.triggeredBy !== undefined && { triggeredBy: state.triggeredBy }),
      },
    }
  },
```

**Note:** The `ReminderNotStagedEvent` type alias must exist. It will be auto-derived as `CanonicalEvent<'reminder:not-staged'>`. Check that `packages/types/src/events.ts` exports a type alias:

```typescript
export type ReminderNotStagedEvent = CanonicalEvent<'reminder:not-staged'>
```

Add this near the other event type aliases (search for `ReminderStagedEvent` to find the location). If a block of per-event type aliases exists, add there. If they're generated from `CanonicalEvent<T>` generically, the import in 3a should use `CanonicalEvent<'reminder:not-staged'>` directly instead.

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/events.test.ts`
Expected: PASS

**Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 6: Commit**

```bash
git add packages/feature-reminders/src/events.ts packages/feature-reminders/src/__tests__/events.test.ts packages/types/src/events.ts
git commit -m "feat(reminders): add reminderNotStaged event factory"
```

---

### Task 3: Wire `reminder:not-staged` in `track-verification-tools.ts`

This file has 3 negative decision points.

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts`
- Modify or create: `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`

**Step 1: Write the failing tests**

The existing test file is at `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`. Add new test cases that verify `logEvent` is called with `reminder:not-staged` events. First read the existing test file to understand the test harness setup, then add:

```typescript
describe('reminder:not-staged events', () => {
  it('should emit not-staged event when tool is disabled', async () => {
    // Setup: configure a tool with enabled: false
    // Act: call trackVerificationToolEdits with a file matching the tool
    // Assert: logEvent called with reminder:not-staged, reason: 'feature_disabled'
    // The exact setup depends on the existing test harness — follow its patterns
  })

  it('should emit not-staged event when file does not match clearing patterns', async () => {
    // Setup: configure a tool with specific clearing_patterns
    // Act: call with a file that doesn't match
    // Assert: logEvent called with reminder:not-staged, reason: 'pattern_mismatch'
  })

  it('should emit not-staged event when below clearing threshold', async () => {
    // Setup: tool in cooldown, editsSinceVerified below threshold
    // Act: call with a matching file
    // Assert: logEvent called with reminder:not-staged, reason: 'below_threshold',
    //         threshold: toolConfig.clearing_threshold, currentValue: newEdits
  })
})
```

**Important:** Read the existing test file first to match the test harness setup (mock DaemonContext, mock staging, etc.). The tests above are skeletal — fill in the setup from existing patterns.

**Step 2: Run test to verify they fail**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/handlers/staging/track-verification-tools.test.ts`
Expected: FAIL — no `logEvent` calls at the negative decision points yet

**Step 3: Implement the event emissions**

In `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts`:

**3a.** Add import for `ReminderEvents`:
```typescript
import { ReminderEvents } from '../../events.js'
```
(Check if already imported — if not, add it)

**3b.** At line 108 (tool disabled), add before `continue`:
```typescript
      if (!toolConfig.enabled) {
        logEvent(
          daemonCtx.logger,
          ReminderEvents.reminderNotStaged(
            { sessionId },
            {
              reminderName: toolName,
              hookName: 'Stop',
              reason: 'feature_disabled',
              triggeredBy: 'file_edit',
            }
          )
        )
        continue
      }
```

**3c.** At line 112 (pattern mismatch), add before `continue`:
```typescript
      if (!picomatch.isMatch(filePath, toolConfig.clearing_patterns)) {
        logEvent(
          daemonCtx.logger,
          ReminderEvents.reminderNotStaged(
            { sessionId },
            {
              reminderName: toolName,
              hookName: 'Stop',
              reason: 'pattern_mismatch',
              triggeredBy: 'file_edit',
            }
          )
        )
        continue
      }
```

**3d.** At lines 145-150 (below threshold, in the `else` block), add after updating `toolsState`:
```typescript
          toolsState[toolName] = {
            ...current,
            status: 'cooldown',
            editsSinceVerified: newEdits,
          }
          logEvent(
            daemonCtx.logger,
            ReminderEvents.reminderNotStaged(
              { sessionId },
              {
                reminderName: toolName,
                hookName: 'Stop',
                reason: 'below_threshold',
                threshold: toolConfig.clearing_threshold,
                currentValue: newEdits,
                triggeredBy: 'file_edit',
              }
            )
          )
```

**Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/handlers/staging/track-verification-tools.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/track-verification-tools.ts packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts
git commit -m "feat(reminders): emit reminder:not-staged in track-verification-tools"
```

---

### Task 4: Wire `reminder:not-staged` in `stage-pause-and-reflect.ts`

2 negative decision points.

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts`
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts` (or appropriate test file)

**Step 1: Write the failing tests**

Read the existing staging-handlers test file to find P&R test cases. Add:

```typescript
describe('pause-and-reflect not-staged events', () => {
  it('should emit not-staged when reactivation skipped (same turn)', async () => {
    // Setup: lastConsumed exists with same turnCount
    // Act: trigger P&R evaluation
    // Assert: logEvent called with reason: 'same_turn'
  })

  it('should emit not-staged when tools below threshold', async () => {
    // Setup: toolsSinceBaseline < threshold
    // Act: trigger P&R evaluation
    // Assert: logEvent called with reason: 'below_threshold',
    //         threshold: config.pause_and_reflect_threshold, currentValue: toolsSinceBaseline
  })
})
```

**Step 2: Run test to verify they fail**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts`
Expected: FAIL

**Step 3: Implement the event emissions**

In `packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts`:

**3a.** Add imports:
```typescript
import { logEvent } from '@sidekick/core'
import { ReminderEvents } from '../../events.js'
```

**3b.** At line 62 (reactivation skipped), replace `return undefined` with:
```typescript
        if (!shouldReactivate) {
          logEvent(
            ctx.logger,
            ReminderEvents.reminderNotStaged(
              { sessionId: event.context?.sessionId ?? '' },
              {
                reminderName: 'pause-and-reflect',
                hookName: 'PreToolUse',
                reason: 'same_turn',
                triggeredBy: 'tool_result',
              }
            )
          )
          return undefined
        }
```

**3c.** At line 67 (below threshold), replace `return undefined` with:
```typescript
      if (toolsSinceBaseline < config.pause_and_reflect_threshold) {
        logEvent(
          ctx.logger,
          ReminderEvents.reminderNotStaged(
            { sessionId: event.context?.sessionId ?? '' },
            {
              reminderName: 'pause-and-reflect',
              hookName: 'PreToolUse',
              reason: 'below_threshold',
              threshold: config.pause_and_reflect_threshold,
              currentValue: toolsSinceBaseline,
              triggeredBy: 'tool_result',
            }
          )
        )
        return undefined
      }
```

**Step 4: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/staging-handlers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts packages/feature-reminders/src/__tests__/staging-handlers.test.ts
git commit -m "feat(reminders): emit reminder:not-staged in stage-pause-and-reflect"
```

---

### Task 5: Wire `reminder:not-staged` in `stage-stop-bash-changes.ts`

3 negative decision points.

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-stop-bash-changes.ts`
- Modify: appropriate test file (find by grepping for `stage-stop-bash-changes` or `Bash VC` in test files)

**Step 1: Write the failing tests**

```typescript
describe('stage-stop-bash-changes not-staged events', () => {
  it('should emit not-staged when reactivation skipped (same turn)', async () => {
    // Assert: reason: 'same_turn', triggeredBy: 'bash_command'
  })

  it('should emit not-staged when no new files detected', async () => {
    // Assert: reason: 'no_changes_detected', triggeredBy: 'bash_command'
  })

  it('should emit not-staged when new files dont match source patterns', async () => {
    // Assert: reason: 'pattern_mismatch', triggeredBy: 'bash_command'
  })
})
```

**Step 2: Run test to verify they fail**

**Step 3: Implement the event emissions**

In `packages/feature-reminders/src/handlers/staging/stage-stop-bash-changes.ts`:

**3a.** Add imports (check what's already imported):
```typescript
import { ReminderEvents } from '../../events.js'
```

**3b.** At line 89-94 (reactivation skipped), before `return`:
```typescript
        if (!shouldReactivate) {
          logEvent(
            daemonCtx.logger,
            ReminderEvents.reminderNotStaged(
              { sessionId },
              {
                reminderName: 'verify-completion',
                hookName: 'Stop',
                reason: 'same_turn',
                triggeredBy: 'bash_command',
              }
            )
          )
          return
        }
```

**3c.** At line 109 (no new files), before `return`:
```typescript
      if (newFiles.length === 0) {
        logEvent(
          daemonCtx.logger,
          ReminderEvents.reminderNotStaged(
            { sessionId },
            {
              reminderName: 'verify-completion',
              hookName: 'Stop',
              reason: 'no_changes_detected',
              triggeredBy: 'bash_command',
            }
          )
        )
        return
      }
```

**3d.** At line 116-118 (no source matches), before `return`:
```typescript
      if (sourceMatches.length === 0) {
        logEvent(
          daemonCtx.logger,
          ReminderEvents.reminderNotStaged(
            { sessionId },
            {
              reminderName: 'verify-completion',
              hookName: 'Stop',
              reason: 'pattern_mismatch',
              triggeredBy: 'bash_command',
            }
          )
        )
        return
      }
```

**Step 4: Run tests**
**Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/stage-stop-bash-changes.ts <test-file>
git commit -m "feat(reminders): emit reminder:not-staged in stage-stop-bash-changes"
```

---

### Task 6: Wire `reminder:not-staged` in `stage-persona-reminders.ts`

2 negative decision points.

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-persona-reminders.ts`
- Modify: appropriate test file

**Step 1-2:** Write failing tests for:
- `reason: 'feature_disabled'` when `isPersonaInjectionEnabled()` returns false
- `reason: 'no_persona'` when `loadPersonaForSession()` returns null

**Step 3: Implement**

At line 175-178 (persona injection disabled):
```typescript
  if (!isPersonaInjectionEnabled(ctx)) {
    logEvent(
      ctx.logger,
      ReminderEvents.reminderNotStaged(
        { sessionId },
        {
          reminderName: 'remember-your-persona',
          hookName: 'PreToolUse',
          reason: 'feature_disabled',
        }
      )
    )
    await clearPersonaReminders(ctx, sessionId)
    return
  }
```

At line 183-186 (no persona loaded):
```typescript
  if (!persona) {
    logEvent(
      ctx.logger,
      ReminderEvents.reminderNotStaged(
        { sessionId },
        {
          reminderName: 'remember-your-persona',
          hookName: 'PreToolUse',
          reason: 'no_persona',
        }
      )
    )
    await clearPersonaReminders(ctx, sessionId)
    return
  }
```

**Note:** Import `ReminderEvents` from `../../events.js`. `logEvent` is already imported (line 13).

**Step 4-5: Run tests, commit**

```bash
git commit -m "feat(reminders): emit reminder:not-staged in stage-persona-reminders"
```

---

### Task 7: Wire `reminder:not-staged` in `unstage-verify-completion.ts`

1 negative decision point.

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/unstage-verify-completion.ts`
- Modify: appropriate test file

**Step 1-2:** Write failing test for `reason: 'no_unverified_changes'` when `!unverifiedState?.hasUnverifiedChanges`.

**Step 3: Implement**

At line 129 (no unverified changes — the `else` branch):
```typescript
      } else {
        logEvent(
          daemonCtx.logger,
          ReminderEvents.reminderNotStaged(
            { sessionId },
            {
              reminderName: 'verify-completion',
              hookName: 'Stop',
              reason: 'no_unverified_changes',
            }
          )
        )
      }
```

**Note:** `logEvent` is already imported (line 11). Add import for `ReminderEvents` from `../../events.js`.

**Step 4-5: Run tests, commit**

```bash
git commit -m "feat(reminders): emit reminder:not-staged in unstage-verify-completion"
```

---

### Task 8: Final verification

**Step 1: Run full build**

Run: `pnpm build`
Expected: PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (fix any lint issues)

**Step 4: Run all feature-reminders tests**

Run: `pnpm --filter @sidekick/feature-reminders test`
Expected: All PASS including existing tests (backward compatibility)

**Step 5: Run types tests**

Run: `pnpm --filter @sidekick/types test`
Expected: All PASS

**Step 6: Commit any lint fixes**

```bash
git commit -m "chore: lint fixes for reminder:not-staged"
```
