# Refine `decision:recorded` Usage — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove non-decision `decision:recorded` emissions, centralize the factory, and add decision events at 5 new threshold-based sites in `feature-reminders`.

**Architecture:** Move `DecisionEvents` factory from `feature-session-summary` to `@sidekick/types` (co-locating with the type it constructs). Remove 2 noisy/unconditional emission sites. Add 5 positive-only decision events in `feature-reminders` staging handlers.

**Tech Stack:** TypeScript, Vitest, pino structured logging

**Spec:** `docs/superpowers/specs/2026-03-28-refine-decision-recorded-usage-design.md`

---

### Task 1: Move `DecisionEvents` factory to `@sidekick/types`

**Files:**
- Modify: `packages/types/src/events.ts` (add factory after `DecisionRecordedPayload` at ~line 933)
- Modify: `packages/feature-session-summary/src/events.ts` (remove `DecisionEvents`, lines 171-193)
- Modify: `packages/feature-session-summary/src/index.ts` (update re-export at line 33)
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts` (update import)
- Modify: `packages/feature-session-summary/src/__tests__/events.test.ts` (update import)

- [ ] **Step 1: Add factory to `@sidekick/types`**

In `packages/types/src/events.ts`, add after the `DecisionRecordedPayload` interface (after line 933):

```typescript
/**
 * Factory functions for creating decision:recorded logging events.
 * Centralized here so any feature package can emit decisions.
 */
export const DecisionEvents = {
  /** Emitted when an architecture-level decision is recorded. */
  decisionRecorded(context: EventLogContext, payload: DecisionRecordedPayload): DecisionRecordedEvent {
    return {
      type: 'decision:recorded',
      time: Date.now(),
      source: 'daemon',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload,
    }
  },
}
```

Note: `EventLogContext` and `DecisionRecordedEvent` are already defined in this file — no new imports needed.

- [ ] **Step 2: Remove factory from `feature-session-summary/src/events.ts`**

Delete lines 175-193 (the `DecisionEvents` object and the `/* v8 ignore stop */` comment on line 193). Move `/* v8 ignore stop */` to line 170, immediately after the closing of `SessionSummaryEvents` (the `}` on line 169). The ignore block must still cover `SessionSummaryEvents`.

Remove `DecisionRecordedEvent` and `DecisionRecordedPayload` from the type imports at top of file (lines 19, 27) since the factory no longer needs them here. Keep `EventLogContext` — it is still re-exported on line 31 for consumers.

- [ ] **Step 3: Update `feature-session-summary/src/index.ts` re-export**

Change line 33 from:
```typescript
export { SessionSummaryEvents, DecisionEvents, type EventLogContext as SummaryEventLogContext } from './events.js'
```
to:
```typescript
export { SessionSummaryEvents, type EventLogContext as SummaryEventLogContext } from './events.js'
```

- [ ] **Step 4: Update import in `update-summary.ts`**

In `packages/feature-session-summary/src/handlers/update-summary.ts`, change the `DecisionEvents` import from `'../../events.js'` (or wherever it currently imports from) to `'@sidekick/types'`.

Find the existing import line and update it. The file already imports from `@sidekick/types` for other types, so add `DecisionEvents` to that import.

- [ ] **Step 5: Update import in `events.test.ts`**

In `packages/feature-session-summary/src/__tests__/events.test.ts`, line 6:
```typescript
// FROM:
import { SessionSummaryEvents, DecisionEvents } from '../events.js'
// TO:
import { SessionSummaryEvents } from '../events.js'
import { DecisionEvents } from '@sidekick/types'
```

Note: The spec mentions "consider relocating the factory tests to `packages/types/src/__tests__/`." Leave them in `feature-session-summary` for now — the tests validate factory behavior regardless of where they live, and moving them would add churn without value. The import update is sufficient.

- [ ] **Step 6: Verify build and tests**

Run:
```bash
pnpm build && pnpm typecheck
```
Expected: Clean build, no type errors.

```bash
pnpm --filter @sidekick/types test
pnpm --filter feature-session-summary test
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/events.ts packages/feature-session-summary/src/events.ts packages/feature-session-summary/src/index.ts packages/feature-session-summary/src/handlers/update-summary.ts packages/feature-session-summary/src/__tests__/events.test.ts
git commit -m "refactor(types): move DecisionEvents factory to @sidekick/types"
```

---

### Task 2: Remove non-decision emissions (sites #3 and #4)

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts` (lines 151-163, 166-178)
- Modify: `packages/feature-session-summary/src/__tests__/event-emission.test.ts` (lines 225-282)

- [ ] **Step 1: Update existing tests to expect removal**

In `packages/feature-session-summary/src/__tests__/event-emission.test.ts`:

The test at line 225 (`emits decision:recorded event with decision=calling on UserPrompt`) should be changed to verify **no** decision:recorded is emitted for UserPrompt. Rename and update:

```typescript
it('does not emit decision:recorded on UserPrompt (unconditional action)', async () => {
  const sessionId = 'test-decision-no-emit'

  llm.queueResponses([
    JSON.stringify({
      session_title: 'Decision Test',
      session_title_confidence: 0.9,
      latest_intent: 'Testing decisions',
      latest_intent_confidence: 0.85,
      pivot_detected: false,
    }),
    'Snark!',
    'Welcome!',
  ])

  await updateSessionSummary(createUserPromptEvent(sessionId), ctx)
  await flushPromises()

  const decisionLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'decision:recorded')
  expect(decisionLogs).toHaveLength(0)
})
```

The test at line 251 (`emits decision:recorded event with decision=skipped on countdown active`) should also be changed to verify **no** decision:recorded for countdown-active:

```typescript
it('does not emit decision:recorded on countdown active (noise suppressed)', async () => {
  const sessionId = 'test-decision-no-skip-emit'

  stateService.setStored(stateService.sessionStatePath(sessionId, 'summary-countdown.json'), {
    countdown: 5,
    bookmark_line: 0,
  })

  const toolResultEvent: TranscriptEvent = {
    kind: 'transcript',
    eventType: 'ToolResult',
    context: {
      sessionId,
      timestamp: Date.now(),
    },
    payload: {
      lineNumber: 50,
      entry: {},
      toolName: 'Read',
    },
    metadata: {},
  } as TranscriptEvent

  await updateSessionSummary(toolResultEvent, ctx)

  const decisionLogs = logger.getLogsByLevel('info').filter((log) => log.meta?.type === 'decision:recorded')
  expect(decisionLogs).toHaveLength(0)
})
```

- [ ] **Step 2: Run tests to see them fail**

Run:
```bash
pnpm --filter feature-session-summary test -- --testPathPattern event-emission
```
Expected: 2 test failures (tests expect no emissions but code still emits).

- [ ] **Step 3: Remove site #3 emission (UserPrompt unconditional)**

In `packages/feature-session-summary/src/handlers/update-summary.ts`, at the `isUserPrompt` block (~line 151), remove the `logEvent(...)` call and its `DecisionEvents.decisionRecorded(...)` arguments. Keep the `performAnalysis` call and `return`.

Before:
```typescript
if (isUserPrompt) {
  logEvent(
    ctx.logger,
    DecisionEvents.decisionRecorded(event.context, {
      decision: 'calling',
      reason: 'UserPrompt event forces immediate analysis',
      subsystem: 'session-summary',
      title: DECISION_TITLE_RUN,
    })
  )
  void performAnalysis(event, ctx, summaryState, countdown, 'user_prompt_forced')
  return
}
```

After:
```typescript
if (isUserPrompt) {
  void performAnalysis(event, ctx, summaryState, countdown, 'user_prompt_forced')
  return
}
```

- [ ] **Step 4: Remove site #4 emission (countdown active defer)**

At the `countdown.countdown > 0` block (~line 166), remove the `logEvent(...)` call. Keep the countdown decrement and state save.

Before:
```typescript
if (countdown.countdown > 0) {
  logEvent(
    ctx.logger,
    DecisionEvents.decisionRecorded(event.context, {
      decision: 'skipped',
      reason: `countdown not reached (${countdown.countdown} tool results remaining)`,
      subsystem: 'session-summary',
      title: DECISION_TITLE_DEFER,
    })
  )
  countdown.countdown--
  await saveCountdownState(summaryState, sessionId, countdown)
  return
}
```

After:
```typescript
if (countdown.countdown > 0) {
  countdown.countdown--
  await saveCountdownState(summaryState, sessionId, countdown)
  return
}
```

- [ ] **Step 5: Clean up unused constants**

Check if `DECISION_TITLE_DEFER` is still used anywhere in the file. If not, remove the constant. Similarly check `DECISION_TITLE_RUN` — it's still used in sites #2 and #5, so it stays. Check if `DecisionEvents` import is still needed (sites #1, #2, #5 still use it).

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
pnpm --filter feature-session-summary test -- --testPathPattern event-emission
```
Expected: All tests pass.

- [ ] **Step 7: Commit**

```bash
git add packages/feature-session-summary/src/handlers/update-summary.ts packages/feature-session-summary/src/__tests__/event-emission.test.ts
git commit -m "fix(session-summary): remove non-decision decision:recorded emissions"
```

---

### Task 3: Add decision event at site A (VC tool re-staging on threshold)

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts` (~line 176)
- Modify: `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`

- [ ] **Step 1: Write the failing test**

In `track-verification-tools.test.ts`, add a test in the re-staging threshold describe block:

```typescript
it('emits decision:recorded when re-staging after threshold reached', async () => {
  // Setup: tool in verified state with edits at threshold
  // Trigger: file edit that pushes edits to clearing_threshold
  // Assert: logger contains decision:recorded with decision='staged', subsystem='vc-reminders'

  const decisionLogs = logger.getLogsByLevel('info').filter(
    (log) => log.meta?.type === 'decision:recorded'
  )
  expect(decisionLogs).toHaveLength(1)
  expect(decisionLogs[0].meta?.decision).toBe('staged')
  expect(decisionLogs[0].meta?.subsystem).toBe('vc-reminders')
  expect(decisionLogs[0].meta?.title).toBe('Re-stage VC reminder (threshold reached)')
})
```

Adapt setup to match existing test patterns in this file — use the same fixtures and helpers already established. Find an existing test for the threshold path and model the new test after it.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern track-verification-tools
```
Expected: FAIL — no `decision:recorded` event emitted yet.

- [ ] **Step 3: Add decision event emission**

In `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts`, add import:
```typescript
import { DecisionEvents } from '@sidekick/types'
```

At ~line 176 (after `if (staged) {`), add before updating `toolsState`:

```typescript
if (staged) {
  logEvent(
    daemonCtx.logger,
    DecisionEvents.decisionRecorded(
      { sessionId },
      {
        decision: 'staged',
        reason: `edits reached clearing threshold (${newEdits}/${toolConfig.clearing_threshold})`,
        subsystem: 'vc-reminders',
        title: 'Re-stage VC reminder (threshold reached)',
      }
    )
  )
  toolsState[toolName] = {
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern track-verification-tools
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/track-verification-tools.ts packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts
git commit -m "feat(reminders): emit decision:recorded on VC tool re-staging threshold"
```

---

### Task 4: Add decision event at site B (VC tool unstaging on verification)

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/track-verification-tools.ts` (~line 271)
- Modify: `packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
it('emits decision:recorded when unstaging after verification passed', async () => {
  // Setup: tool in staged state with matching bash command
  // Trigger: bash command that matches verification pattern
  // Assert: decision:recorded with decision='unstaged', subsystem='vc-reminders'

  const decisionLogs = logger.getLogsByLevel('info').filter(
    (log) => log.meta?.type === 'decision:recorded'
  )
  expect(decisionLogs).toHaveLength(1)
  expect(decisionLogs[0].meta?.decision).toBe('unstaged')
  expect(decisionLogs[0].meta?.subsystem).toBe('vc-reminders')
  expect(decisionLogs[0].meta?.title).toBe('Unstage VC reminder (verified)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern track-verification-tools
```
Expected: FAIL.

- [ ] **Step 3: Add decision event emission**

In `track-verification-tools.ts`, at ~line 271 (after `await daemonCtx.staging.deleteReminder(...)` and before the existing `logEvent` for `reminderUnstaged`), add:

```typescript
logEvent(
  daemonCtx.logger,
  DecisionEvents.decisionRecorded(
    { sessionId },
    {
      decision: 'unstaged',
      reason: `verification passed for ${toolName} (matched ${match.tool_id})`,
      subsystem: 'vc-reminders',
      title: 'Unstage VC reminder (verified)',
    }
  )
)
```

`DecisionEvents` import was already added in Task 3.

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern track-verification-tools
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/track-verification-tools.ts packages/feature-reminders/src/__tests__/handlers/staging/track-verification-tools.test.ts
git commit -m "feat(reminders): emit decision:recorded on VC tool verification unstaging"
```

---

### Task 5: Add decision event at site C (pause-and-reflect threshold)

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts` (~line 106)
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts` (in `registerStagePauseAndReflect` describe block)

- [ ] **Step 1: Write the failing test**

In `staging-handlers.test.ts`, find the `registerStagePauseAndReflect` describe block (line 283). Add a test:

```typescript
it('emits decision:recorded when tools exceed P&R threshold', async () => {
  // Setup: metrics with toolsThisTurn above threshold
  // Trigger: handler execution
  // Assert: decision:recorded with decision='staged', subsystem='pause-reflect'

  const decisionLogs = logger.getLogsByLevel('info').filter(
    (log) => log.meta?.type === 'decision:recorded'
  )
  expect(decisionLogs).toHaveLength(1)
  expect(decisionLogs[0].meta?.decision).toBe('staged')
  expect(decisionLogs[0].meta?.subsystem).toBe('pause-reflect')
  expect(decisionLogs[0].meta?.title).toBe('Stage pause-and-reflect reminder')
})
```

Match existing test patterns in this describe block for setup/fixtures.

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern staging-handlers
```
Expected: FAIL.

- [ ] **Step 3: Add decision event emission**

In `stage-pause-and-reflect.ts`, add import:
```typescript
import { DecisionEvents } from '@sidekick/types'
```

At ~line 106, just before the `return` that produces the staging action, add:

```typescript
logEvent(
  ctx.logger,
  DecisionEvents.decisionRecorded(
    { sessionId },
    {
      decision: 'staged',
      reason: `tools since baseline reached threshold (${toolsSinceBaseline}/${config.pause_and_reflect_threshold})`,
      subsystem: 'pause-reflect',
      title: 'Stage pause-and-reflect reminder',
    }
  )
)

return {
  reminderId: ReminderIds.PAUSE_AND_REFLECT,
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern staging-handlers
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/stage-pause-and-reflect.ts packages/feature-reminders/src/__tests__/staging-handlers.test.ts
git commit -m "feat(reminders): emit decision:recorded on pause-and-reflect threshold"
```

---

### Task 6: Add decision event at site D (user prompt throttle threshold)

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/stage-default-user-prompt.ts` (~line 177)
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts` (in `registerStageDefaultUserPrompt` describe block)

- [ ] **Step 1: Write the failing test**

In `staging-handlers.test.ts`, find the `registerStageDefaultUserPrompt` describe block (line 735), look for the throttle re-staging sub-describe (line 825). Add:

```typescript
it('emits decision:recorded when message count reaches throttle threshold', async () => {
  // Setup: throttle state with messagesSinceLastStaging at threshold - 1
  // Trigger: one more transcript event to cross threshold
  // Assert: decision:recorded with decision='staged', subsystem='user-prompt-reminders'

  const decisionLogs = logger.getLogsByLevel('info').filter(
    (log) => log.meta?.type === 'decision:recorded'
  )
  expect(decisionLogs).toHaveLength(1)
  expect(decisionLogs[0].meta?.decision).toBe('staged')
  expect(decisionLogs[0].meta?.subsystem).toBe('user-prompt-reminders')
  expect(decisionLogs[0].meta?.title).toBe('Stage user-prompt reminder')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern staging-handlers
```
Expected: FAIL.

- [ ] **Step 3: Add decision event emission**

In `stage-default-user-prompt.ts`, add two new imports (the file currently only has `import type` from `@sidekick/core` on line 17 — this adds a runtime import):
```typescript
import { logEvent } from '@sidekick/core'
import { DecisionEvents } from '@sidekick/types'
```

At ~line 177, inside the `if (newCount >= threshold)` block, after the `stageReminder` call and before the debug log:

```typescript
await stageReminder(handlerCtx, typedEntry.targetHook, {
  ...(typedEntry.cachedReminder as StagedReminder),
  stagedAt,
})
logEvent(
  handlerCtx.logger,
  DecisionEvents.decisionRecorded(
    { sessionId },
    {
      decision: 'staged',
      reason: `message count reached threshold (${newCount}/${threshold})`,
      subsystem: 'user-prompt-reminders',
      title: 'Stage user-prompt reminder',
    }
  )
)
state[reminderId] = { ...typedEntry, messagesSinceLastStaging: 0 }
```

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern staging-handlers
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/stage-default-user-prompt.ts packages/feature-reminders/src/__tests__/staging-handlers.test.ts
git commit -m "feat(reminders): emit decision:recorded on user-prompt throttle threshold"
```

---

### Task 7: Add decision event at site E (VC cycle limit reached)

**Files:**
- Modify: `packages/feature-reminders/src/handlers/staging/unstage-verify-completion.ts` (~line 167)
- Modify: `packages/feature-reminders/src/__tests__/staging-handlers.test.ts` (in `registerUnstageVerifyCompletion` describe block)

- [ ] **Step 1: Write the failing test**

In `staging-handlers.test.ts`, find the `registerUnstageVerifyCompletion` describe block (line 1268). Add:

```typescript
it('emits decision:recorded when VC cycle limit reached', async () => {
  // Setup: unverified state with cycleCount >= max_verification_cycles
  // Trigger: UserPromptSubmit event
  // Assert: decision:recorded with decision='unstaged-all', subsystem='vc-reminders'

  const decisionLogs = logger.getLogsByLevel('info').filter(
    (log) => log.meta?.type === 'decision:recorded'
  )
  expect(decisionLogs).toHaveLength(1)
  expect(decisionLogs[0].meta?.decision).toBe('unstaged-all')
  expect(decisionLogs[0].meta?.subsystem).toBe('vc-reminders')
  expect(decisionLogs[0].meta?.title).toBe('Unstage all VC reminders (cycle limit)')
})
```

- [ ] **Step 2: Run test to verify it fails**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern staging-handlers
```
Expected: FAIL.

- [ ] **Step 3: Add decision event emission**

In `unstage-verify-completion.ts`, add import:
```typescript
import { DecisionEvents } from '@sidekick/types'
```

At ~line 167, inside the cycle-limit-reached block (after `await remindersState.vcUnverified.delete(sessionId)`), add:

```typescript
await remindersState.vcUnverified.delete(sessionId)
logEvent(
  daemonCtx.logger,
  DecisionEvents.decisionRecorded(
    { sessionId },
    {
      decision: 'unstaged-all',
      reason: `verification cycle limit reached (${unverifiedState.cycleCount}/${maxCycles})`,
      subsystem: 'vc-reminders',
      title: 'Unstage all VC reminders (cycle limit)',
    }
  )
)
```

Note: `logEvent` is already imported in this file (line 11).

- [ ] **Step 4: Run test to verify it passes**

Run:
```bash
pnpm --filter feature-reminders test -- --testPathPattern staging-handlers
```
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/feature-reminders/src/handlers/staging/unstage-verify-completion.ts packages/feature-reminders/src/__tests__/staging-handlers.test.ts
git commit -m "feat(reminders): emit decision:recorded on VC cycle limit reached"
```

---

### Task 8: Final verification

**Files:** None (verification only)

- [ ] **Step 1: Full build and typecheck**

Run:
```bash
pnpm build && pnpm typecheck && pnpm lint
```
Expected: Clean build, no errors.

- [ ] **Step 2: Run all affected package tests**

Run:
```bash
pnpm --filter @sidekick/types test
pnpm --filter feature-session-summary test
pnpm --filter feature-reminders test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```
Expected: All tests pass.

- [ ] **Step 3: Grep audit — verify no stale decision:recorded emissions**

Run:
```bash
grep -rn "DecisionEvents.decisionRecorded" packages/feature-session-summary/src/handlers/ packages/feature-reminders/src/handlers/
```

Expected exactly 8 emission sites:
1. `update-summary.ts` — BulkProcessingComplete, 0 turns (skipped)
2. `update-summary.ts` — BulkProcessingComplete, >0 turns (calling)
3. `update-summary.ts` — ToolResult, countdown = 0 (calling)
4. `track-verification-tools.ts` — VC re-staging (staged)
5. `track-verification-tools.ts` — VC unstaging (unstaged)
6. `stage-pause-and-reflect.ts` — P&R threshold (staged)
7. `stage-default-user-prompt.ts` — user prompt throttle (staged)
8. `unstage-verify-completion.ts` — cycle limit (unstaged-all)

- [ ] **Step 4: Verify no unconditional emissions**

Confirm removed sites #3 and #4 are gone:
```bash
grep -n "UserPrompt event forces immediate" packages/feature-session-summary/src/handlers/update-summary.ts
grep -n "countdown not reached" packages/feature-session-summary/src/handlers/update-summary.ts
```
Expected: No matches.
