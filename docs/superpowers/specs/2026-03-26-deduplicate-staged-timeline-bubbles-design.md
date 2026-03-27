# Deduplicate Staged Timeline Bubbles

**Bead:** claude-code-sidekick-9g1
**Date:** 2026-03-26
**Status:** Approved

## Problem

Duplicate "Staged: ..." bubbles appear in the timeline UI. The `throttle-restage` handler in `stage-default-user-prompt.ts` calls `stageReminder()` directly (bypassing the `skipIfExists` idempotency check in `createStagingHandler`), which overwrites the existing file and emits a second `reminder:staged` log event. The timeline renders both events as separate bubbles.

## Root Cause

`StagingServiceCore.stageReminder()` unconditionally emits a `reminder:staged` log event on every call. It has no awareness of whether it is creating a new file or overwriting an existing one. The `createStagingHandler` utility provides idempotency via `skipIfExists`, but callers that bypass it (like the throttle handler) produce duplicate events.

## Solution

Add an `existsSync` check in `StagingServiceCore.stageReminder()` before the atomic write. Only emit the `reminder:staged` event when the file is new (not an overwrite).

### Behavior

| Scenario | File exists before write? | Write file? | Emit event? |
|---|---|---|---|
| First stage | No | Yes | Yes |
| Re-stage (throttle) | Yes | Yes | No |
| Re-stage after consume | No (file deleted) | Yes | Yes |

The file write always happens so that `stagedAt` metrics stay current for orchestrator decisions. Only the event emission becomes conditional.

### Change

**File:** `packages/sidekick-core/src/staging-service.ts`, `stageReminder()` method

```typescript
// Before the atomic write, check if this is a re-stage
const isRestage = existsSync(reminderPath)

// ... existing atomic write ...

// Only emit event for new staging (not overwrites)
if (!isRestage) {
  const event = LogEvents.reminderStaged(...)
  logEvent(...)
}
```

`existsSync` is already imported in this file.

### Tests

In `staging-service.test.ts`:
1. First stage emits `reminder:staged` event (existing behavior, verify not broken)
2. Re-stage (overwrite) does NOT emit a second event
3. Re-stage after file removal (simulating consumption) DOES emit event

## Files Changed

- `packages/sidekick-core/src/staging-service.ts` (1 file, ~5 lines changed)
- `packages/sidekick-core/src/__tests__/staging-service.test.ts` (test additions)

## Risks

- **TOCTOU race:** Between `existsSync` and `write`, the file could be deleted by a concurrent `consumeReminder`. This would cause a missed event for a legitimate re-stage. In practice, Node.js is single-threaded; async interleaving makes this window negligibly small, and the consequence (one missing bubble) is cosmetic.
