# Bulk Processing: Fix Spurious Firing & Add Lifecycle Events

**Beads:** re0 (bug), 7ri (feature)
**Date:** 2026-03-24
**Status:** Draft

## Problem

Two related issues in the BulkProcessingComplete system:

1. **re0 (bug):** After `/clear`, the transcript file gets truncated. `resetStreamingState()` resets byte offset and line number to 0. On the next watcher tick, `isBulkStart` evaluates to true and `BulkProcessingComplete` fires again — producing a spurious "Decision: calling BulkProcessingComplete" in the timeline.

2. **7ri (feature):** `BulkProcessingComplete` is a single transcript event. The UI needs a start/finish lifecycle pair for rendering bulk processing duration in the timeline.

## Design

### re0 Fix: One-shot guard

Add `hasFiredBulkComplete = false` to `TranscriptService`. After the first `BulkProcessingComplete` emission, set it to `true`. Guard the emission:

```typescript
// transcript-service.ts, ~line 1281
if (isBulkStart && this.isBulkProcessing && !this.hasFiredBulkComplete) {
  this.isBulkProcessing = false
  this.hasFiredBulkComplete = true
  // ... emit event and log events
}
```

**Why one-shot:** BulkProcessingComplete is semantically a "first-time catch-up completed" event. A single TranscriptService instance watches one session. Bulk replay happens exactly once — when the service first processes an existing transcript. Post-`/clear` truncation resets are not bulk replay; they're the same session continuing.

**`resetStreamingState()` does NOT reset the flag.** The truncation handler already resets byte offset and line number. The one-shot flag is orthogonal — it tracks "has bulk ever completed" not "what's our file position."

### 7ri Feature: Lifecycle log events

Add `bulk-processing:start` and `bulk-processing:finish` as **log events** (not transcript events). These follow the existing `session-summary:start`/`session-summary:finish` pattern — emitted via `logEvent()` for observability, rendered in the UI timeline for duration tracking.

The existing `BulkProcessingComplete` transcript event remains unchanged as the handler trigger.

#### New types in `packages/types/src/events.ts`

```typescript
// Payloads
export interface BulkProcessingStartPayload {
  fileSize: number
}

export interface BulkProcessingFinishPayload {
  totalLinesProcessed: number
  durationMs: number
}

// Event interfaces
export interface BulkProcessingStartEvent extends LoggingEventBase<BulkProcessingStartPayload> {
  type: 'bulk-processing:start'
  source: 'transcript'
}

export interface BulkProcessingFinishEvent extends LoggingEventBase<BulkProcessingFinishPayload> {
  type: 'bulk-processing:finish'
  source: 'transcript'
}
```

- Source is `'transcript'` (not `'daemon'`) since these are emitted by TranscriptService, matching `transcript:emitted` and `transcript:pre-compact`.
- Add both to `TranscriptLoggingEvent` union (consistent with source `'transcript'`).
- Add `'bulk-processing:start'` and `'bulk-processing:finish'` to the `UI_EVENT_TYPES` const tuple so the monitoring UI renders them in the timeline.
- Add entries to `UIEventPayloadMap` for type-safe payload resolution.

#### Factory functions in `packages/sidekick-core/src/structured-logging.ts`

Add to `LogEvents`:

```typescript
bulkProcessingStart(
  context: EventLogContext,
  metadata: { fileSize: number }
): BulkProcessingStartEvent

bulkProcessingFinish(
  context: EventLogContext,
  metadata: { totalLinesProcessed: number; durationMs: number }
): BulkProcessingFinishEvent
```

#### Emission in `packages/sidekick-core/src/transcript-service.ts`

```typescript
// When entering bulk mode (~line 1199):
if (isBulkStart) {
  this.isBulkProcessing = true
  this.bulkStartTime = Date.now()  // new field for duration tracking
  logEvent(this.options.logger, LogEvents.bulkProcessingStart(
    { sessionId: this.sessionId! },
    { fileSize: currentFileSize }
  ))
  // ... existing info log
}

// When completing bulk mode (~line 1281):
if (isBulkStart && this.isBulkProcessing && !this.hasFiredBulkComplete) {
  this.isBulkProcessing = false
  this.hasFiredBulkComplete = true
  const durationMs = Date.now() - this.bulkStartTime
  logEvent(this.options.logger, LogEvents.bulkProcessingFinish(
    { sessionId: this.sessionId! },
    { totalLinesProcessed: lineNumber, durationMs }
  ))
  await this.emitEvent('BulkProcessingComplete', {} as TranscriptEntry, lineNumber)
  // ... existing info log
}
```

### New fields on TranscriptService

| Field | Type | Default | Purpose |
|-------|------|---------|---------|
| `hasFiredBulkComplete` | `boolean` | `false` | One-shot guard — prevents re-firing after truncation reset |
| `bulkStartTime` | `number` | `0` | Timestamp for duration calculation in finish event |

Neither field is persisted or reset by `resetStreamingState()`.

**Note on ordering:** `this.isBulkProcessing = false` is set before `emitEvent()` — this is intentional and matches existing behavior. `emitTranscriptEvent()` reads `this.isBulkProcessing` for event metadata; the handler in `update-summary.ts` skips events with `isBulkProcessing = true`, so `BulkProcessingComplete` must have it `false`.

## Files Changed

| File | Change |
|------|--------|
| `packages/types/src/events.ts` | Add payload interfaces, event interfaces, union members, map entries |
| `packages/sidekick-core/src/structured-logging.ts` | Add factory functions to `LogEvents` |
| `packages/sidekick-core/src/transcript-service.ts` | Add fields, one-shot guard, emit lifecycle events |

## Testing

- **Unit (transcript-service):** Verify `BulkProcessingComplete` fires exactly once. After `resetStreamingState()` + re-process, confirm no second emission. Verify `bulk-processing:start` and `bulk-processing:finish` log events emit with correct payloads.
- **Unit (structured-logging):** Verify factory functions produce correctly-typed events.

## What's NOT Changing

- `BulkProcessingComplete` transcript event type — stays in `TranscriptEventType` union
- Handler registration in `feature-session-summary` — still subscribes to `BulkProcessingComplete`
- `update-summary.ts` handler logic — no changes needed
- UI timeline rendering — new log events will be rendered by existing log event infrastructure (no UI changes in this scope)
