# Reminder Payload Enrichment Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enrich existing `reminder:staged`, `reminder:unstaged`, and `reminder:consumed` event payloads with forensic context fields so the UI can answer "why did this reminder fire?" with full detail.

**Architecture:** Add optional fields to 3 existing payload interfaces in `@sidekick/types`, update 2 factory functions to accept and pass through the new fields, then update emission call sites to provide the new data from local scope. All additions are optional — fully backward compatible.

**Tech Stack:** TypeScript, Vitest, Pino structured logging, `@sidekick/types`, `@sidekick/core`, `@sidekick/feature-reminders`

**Design doc:** `docs/plans/2026-03-13-reminder-event-enrichment-design.md`

**Bead:** `claude-code-sidekick-56w`

---

### Task 1: Enrich `ReminderStagedPayload` type and factory

**Files:**
- Modify: `packages/types/src/events.ts`
- Modify: `packages/sidekick-core/src/structured-logging.ts`
- Modify: `packages/sidekick-core/src/__tests__/structured-logging.test.ts`

**Step 1: Write the failing test**

In `packages/sidekick-core/src/__tests__/structured-logging.test.ts`, find the existing `reminderStaged` test block (search for `reminderStaged`). Add new test cases:

```typescript
    it('should include optional enrichment fields when provided', () => {
      const event = LogEvents.reminderStaged(
        { sessionId: 'sess-enrich' },
        {
          reminderName: 'vc-build',
          hookName: 'Stop',
          blocking: true,
          priority: 80,
          persistent: false,
          reason: 'threshold_reached',
          triggeredBy: 'file_edit',
          thresholdState: { current: 3, threshold: 3 },
        }
      )

      expect(event.payload.reason).toBe('threshold_reached')
      expect(event.payload.triggeredBy).toBe('file_edit')
      expect(event.payload.thresholdState).toEqual({ current: 3, threshold: 3 })
    })

    it('should omit enrichment fields when not provided', () => {
      const event = LogEvents.reminderStaged(
        { sessionId: 'sess-basic' },
        {
          reminderName: 'test',
          hookName: 'Stop',
          blocking: false,
          priority: 50,
          persistent: true,
        }
      )

      expect(event.payload.reason).toBeUndefined()
      expect(event.payload.triggeredBy).toBeUndefined()
      expect(event.payload.thresholdState).toBeUndefined()
    })
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/core test -- --run src/__tests__/structured-logging.test.ts`
Expected: FAIL — `reason` doesn't exist on `ReminderStagedPayload`

**Step 3: Implement**

**3a.** In `packages/types/src/events.ts`, extend `ReminderStagedPayload` (lines 832-838):

```typescript
/** Payload for `reminder:staged` — a reminder was staged for a hook. */
export interface ReminderStagedPayload {
  reminderName: string
  hookName: string
  blocking: boolean
  priority: number
  persistent: boolean
  /** Why this reminder was staged */
  reason?: string
  /** What action triggered the staging */
  triggeredBy?: string
  /** For threshold-gated reminders: state at time of staging */
  thresholdState?: {
    current: number
    threshold: number
  }
}
```

**3b.** In `packages/sidekick-core/src/structured-logging.ts`, update the `reminderStaged` factory (lines 913-943). The `state` parameter needs the new optional fields, and the payload must pass them through:

```typescript
  reminderStaged(
    context: EventLogContext,
    state: {
      reminderName: string
      hookName: string
      blocking: boolean
      priority: number
      persistent: boolean
      reason?: string
      triggeredBy?: string
      thresholdState?: { current: number; threshold: number }
    },
    _metadata?: { stagingPath?: string }
  ): ReminderStagedEvent {
    return {
      type: 'reminder:staged',
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
        blocking: state.blocking,
        priority: state.priority,
        persistent: state.persistent,
        ...(state.reason !== undefined && { reason: state.reason }),
        ...(state.triggeredBy !== undefined && { triggeredBy: state.triggeredBy }),
        ...(state.thresholdState !== undefined && { thresholdState: state.thresholdState }),
      },
    }
  },
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/core test -- --run src/__tests__/structured-logging.test.ts`
Expected: PASS

**Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — existing call sites pass fewer fields but all new fields are optional

**Step 6: Commit**

```bash
git add packages/types/src/events.ts packages/sidekick-core/src/structured-logging.ts packages/sidekick-core/src/__tests__/structured-logging.test.ts
git commit -m "feat(types): enrich ReminderStagedPayload with reason, triggeredBy, thresholdState"
```

---

### Task 2: Enrich `ReminderUnstagedPayload` type and factory

**Files:**
- Modify: `packages/types/src/events.ts`
- Modify: `packages/feature-reminders/src/events.ts`
- Modify: `packages/feature-reminders/src/__tests__/events.test.ts`

**Step 1: Write the failing test**

In `packages/feature-reminders/src/__tests__/events.test.ts`, add to the `reminderUnstaged` describe block:

```typescript
    it('should include optional enrichment fields when provided', () => {
      const event = ReminderEvents.reminderUnstaged(
        { sessionId: 'sess-123', hook: 'Stop' },
        {
          reminderName: 'verify-completion',
          hookName: 'Stop',
          reason: 'verification_passed',
          triggeredBy: 'cascade_from_pause_and_reflect',
          toolState: { status: 'verified', editsSinceVerified: 0 },
        }
      )

      expect(event.payload.triggeredBy).toBe('cascade_from_pause_and_reflect')
      expect(event.payload.toolState).toEqual({ status: 'verified', editsSinceVerified: 0 })
    })

    it('should omit enrichment fields when not provided', () => {
      const event = ReminderEvents.reminderUnstaged(
        { sessionId: 'sess-123' },
        { reminderName: 'test', hookName: 'Stop', reason: 'cascade' }
      )

      expect(event.payload.triggeredBy).toBeUndefined()
      expect(event.payload.toolState).toBeUndefined()
    })
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/events.test.ts`
Expected: FAIL — `triggeredBy` doesn't exist on `ReminderUnstagedPayload`

**Step 3: Implement**

**3a.** In `packages/types/src/events.ts`, extend `ReminderUnstagedPayload` (lines 841-845):

```typescript
/** Payload for `reminder:unstaged` — a reminder was removed from staging. */
export interface ReminderUnstagedPayload {
  reminderName: string
  hookName: string
  reason: string
  /** What caused this unstaging */
  triggeredBy?: string
  /** For VC tool unstaging: the tool's state machine snapshot */
  toolState?: {
    status: string
    editsSinceVerified: number
  }
}
```

**3b.** In `packages/feature-reminders/src/events.ts`, update the `reminderUnstaged` factory (lines 66-91). Add optional fields to `state` param and payload:

```typescript
  reminderUnstaged(
    context: EventLogContext,
    state: {
      reminderName: string
      hookName: string
      reason: string
      triggeredBy?: string
      toolState?: { status: string; editsSinceVerified: number }
    }
  ): ReminderUnstagedEvent {
    return {
      type: 'reminder:unstaged',
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
        ...(state.triggeredBy !== undefined && { triggeredBy: state.triggeredBy }),
        ...(state.toolState !== undefined && { toolState: state.toolState }),
      },
    }
  },
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/events.test.ts`
Expected: PASS

**Step 5: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS — existing call sites use fewer fields, all new fields optional

**Step 6: Commit**

```bash
git add packages/types/src/events.ts packages/feature-reminders/src/events.ts packages/feature-reminders/src/__tests__/events.test.ts
git commit -m "feat(types): enrich ReminderUnstagedPayload with triggeredBy, toolState"
```

---

### Task 3: Enrich `ReminderConsumedPayload` type and factory

**Files:**
- Modify: `packages/types/src/events.ts`
- Modify: `packages/feature-reminders/src/events.ts`
- Modify: `packages/feature-reminders/src/__tests__/events.test.ts`

**Step 1: Write the failing test**

In `packages/feature-reminders/src/__tests__/events.test.ts`, add to the `reminderConsumed` describe block:

```typescript
    it('should include classificationResult when provided', () => {
      const event = ReminderEvents.reminderConsumed(
        { sessionId: 'sess-123', hook: 'Stop' },
        {
          reminderName: 'verify-completion',
          reminderReturned: true,
          blocking: true,
          classificationResult: {
            category: 'CLAIMING_COMPLETION',
            confidence: 0.92,
            shouldBlock: true,
          },
        }
      )

      expect(event.payload.classificationResult).toEqual({
        category: 'CLAIMING_COMPLETION',
        confidence: 0.92,
        shouldBlock: true,
      })
    })

    it('should omit classificationResult when not provided', () => {
      const event = ReminderEvents.reminderConsumed(
        { sessionId: 'sess-123' },
        { reminderName: 'test', reminderReturned: true }
      )

      expect(event.payload.classificationResult).toBeUndefined()
    })
```

**Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/events.test.ts`
Expected: FAIL

**Step 3: Implement**

**3a.** In `packages/types/src/events.ts`, extend `ReminderConsumedPayload` (lines 848-854):

```typescript
/** Payload for `reminder:consumed` — a reminder was consumed by a hook. */
export interface ReminderConsumedPayload {
  reminderName: string
  reminderReturned: boolean
  blocking?: boolean
  priority?: number
  persistent?: boolean
  /** For verify-completion: the LLM classification result */
  classificationResult?: {
    category: string
    confidence: number
    shouldBlock: boolean
  }
}
```

**3b.** In `packages/feature-reminders/src/events.ts`, update the `reminderConsumed` factory. Add `classificationResult` to `state` param:

```typescript
  reminderConsumed(
    context: EventLogContext,
    state: {
      reminderName: string
      reminderReturned: boolean
      blocking?: boolean
      priority?: number
      persistent?: boolean
      classificationResult?: {
        category: string
        confidence: number
        shouldBlock: boolean
      }
    },
    _metadata?: { stagingPath?: string }
  ): ReminderConsumedEvent {
    return {
      type: 'reminder:consumed',
      time: Date.now(),
      source: 'cli',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        reminderName: state.reminderName,
        reminderReturned: state.reminderReturned,
        blocking: state.blocking,
        priority: state.priority,
        persistent: state.persistent,
        ...(state.classificationResult !== undefined && {
          classificationResult: state.classificationResult,
        }),
      },
    }
  },
```

**Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/feature-reminders test -- --run src/__tests__/events.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add packages/types/src/events.ts packages/feature-reminders/src/events.ts packages/feature-reminders/src/__tests__/events.test.ts
git commit -m "feat(types): enrich ReminderConsumedPayload with classificationResult"
```

---

### Task 4: Wire enriched fields at `reminder:staged` emission points

**Files:**
- Modify: `packages/sidekick-core/src/staging-service.ts` (the single `reminderStaged` call site)
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts` (for threshold state)

**Step 1: Write the failing test**

The `reminderStaged` event is emitted in `staging-service.ts:143-157`. This is a generic service — it doesn't know the "reason" for staging. The enrichment fields must be passed through from the caller.

Read `packages/sidekick-core/src/staging-service.ts` to understand the `stageReminder()` method signature. The caller passes reminder data — we need to add optional enrichment fields that pass through to `LogEvents.reminderStaged()`.

Write a test that verifies: when `stageReminder` is called with enrichment metadata, the emitted event includes those fields.

**Step 2-3: Implement**

**Approach:** The `StagingService.stageReminder()` method currently receives `data: StagedReminder` and calls `LogEvents.reminderStaged()`. Add an optional `enrichment` parameter:

```typescript
async stageReminder(
  sessionId: string,
  hookName: HookName,
  data: StagedReminder,
  enrichment?: {
    reason?: string
    triggeredBy?: string
    thresholdState?: { current: number; threshold: number }
  }
): Promise<void> {
```

Then pass enrichment fields through to `LogEvents.reminderStaged()`:

```typescript
    const event = LogEvents.reminderStaged(
      { sessionId, hook: hookName },
      {
        reminderName: data.name,
        hookName,
        blocking: data.blocking,
        priority: data.priority,
        persistent: data.persistent,
        ...enrichment,
      },
      { stagingPath: reminderPath }
    )
```

**Important:** Don't modify callers yet — enrichment is optional. Existing callers work unchanged.

Then update `track-verification-tools.ts` to pass enrichment when staging (threshold_reached case):

```typescript
// At the re-staging point (line ~134-143):
await ensureToolReminderStaged(daemonCtx, reminderId, stagedNames)
// If ensureToolReminderStaged calls stageReminder internally, the enrichment
// needs to be threaded through. Read ensureToolReminderStaged to determine
// the right approach — it may be simpler to emit a separate enriched event
// alongside the existing staged event, or to add enrichment params to
// ensureToolReminderStaged.
```

**Note:** Read `ensureToolReminderStaged` to understand the call chain before implementing. The approach depends on whether it directly calls `staging.stageReminder()` or goes through another abstraction.

**Step 4-6: Run tests, typecheck, commit**

```bash
git commit -m "feat(events): wire enriched fields to reminder:staged emission points"
```

---

### Task 5: Wire enriched fields at `reminder:unstaged` emission points

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/unstage-verify-completion.ts`
- Modify: `packages/feature-reminders/src/orchestrator.ts` (cascade unstaging)
- Modify: appropriate test files

**Step 1: Write the failing test**

Tests should verify that `triggeredBy` and `toolState` appear in emitted `reminder:unstaged` events.

**Step 2-3: Implement**

In `unstage-verify-completion.ts`, there are existing `ReminderEvents.reminderUnstaged()` calls at lines 141-143. Update them to include the new fields:

```typescript
// At line 141-143 (unstaging VC reminders):
logEvent(
  daemonCtx.logger,
  ReminderEvents.reminderUnstaged(eventContext, {
    reminderName: vcId,
    hookName: 'Stop',
    reason,
    triggeredBy: unverifiedState?.hasUnverifiedChanges ? 'cycle_limit' : 'no_unverified_changes',
  })
)
```

In `orchestrator.ts`, find cascade unstaging (line ~76 where P&R stages and VC unstages). Add `triggeredBy: 'cascade_from_pause_and_reflect'` to those events.

**Step 4-6: Run tests, typecheck, commit**

```bash
git commit -m "feat(events): wire enriched fields to reminder:unstaged emission points"
```

---

### Task 6: Wire `classificationResult` at `reminder:consumed` emission point

**Files:**
- Modify: `packages/feature-reminders/src/handlers/consumption/inject-stop.ts`
- Modify: appropriate test file (likely `consumption-handlers.test.ts`)

**Step 1: Write the failing test**

Test that when `inject-stop.ts` processes a classification and the reminder is consumed, the `reminder:consumed` event includes `classificationResult`.

**Step 2-3: Implement**

The `reminder:consumed` event is emitted by the consumption pipeline, not directly in `inject-stop.ts`. Read the consumption flow to find where `ReminderEvents.reminderConsumed()` is called.

The classification result is available in `inject-stop.ts` at lines 67-72 as `classification`. This needs to be threaded to wherever `reminderConsumed()` is called. Read the `onConsume` callback (line 137+) and the consumption pipeline to find the right injection point.

**Approach options:**
1. If `reminderConsumed()` is called in the same handler file, pass `classificationResult` directly
2. If it's called in a shared pipeline, add a metadata/enrichment bag that gets passed through

```typescript
// When calling reminderConsumed, add:
classificationResult: {
  category: classification.category,
  confidence: classification.confidence,
  shouldBlock: classification.shouldBlock,
}
```

**Step 4-6: Run tests, typecheck, commit**

```bash
git commit -m "feat(events): wire classificationResult to reminder:consumed emission"
```

---

### Task 7: Final verification

**Step 1: Run full build**

Run: `pnpm build`
Expected: PASS

**Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS

**Step 4: Run all affected package tests**

Run: `pnpm --filter @sidekick/types test && pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts' && pnpm --filter @sidekick/feature-reminders test`
Expected: All PASS

**Step 5: Verify backward compatibility**

Existing tests must pass without modification (new fields are all optional). If any existing test needs changes, something went wrong — all additions should be backward compatible.

**Step 6: Commit any lint fixes**

```bash
git commit -m "chore: lint fixes for reminder payload enrichment"
```
