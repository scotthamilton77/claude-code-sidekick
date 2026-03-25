# Bulk Processing Fix & Lifecycle Events Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix spurious BulkProcessingComplete after /clear (re0) and add bulk-processing:start/finish lifecycle log events (7ri).

**Architecture:** One-shot guard (`hasFiredBulkComplete`) on TranscriptService prevents re-firing after truncation reset. New `bulk-processing:start`/`bulk-processing:finish` log events follow the existing `session-summary:start`/`finish` pattern — emitted via `logEvent()` for observability, not as transcript events.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo

**Spec:** `docs/superpowers/specs/2026-03-24-bulk-processing-fix-and-lifecycle-design.md`

---

### Task 1: Add event types to `@sidekick/types`

**Files:**
- Modify: `packages/types/src/events.ts`

- [ ] **Step 1: Add payload interfaces**

After the existing `TranscriptPreCompactPayload` interface (search for `export interface TranscriptPreCompactPayload`), add:

```typescript
/** Payload for `bulk-processing:start` — transcript bulk replay starting. */
export interface BulkProcessingStartPayload {
  fileSize: number
}

/** Payload for `bulk-processing:finish` — transcript bulk replay completed. */
export interface BulkProcessingFinishPayload {
  totalLinesProcessed: number
  durationMs: number
}
```

- [ ] **Step 2: Add event interfaces**

After the `PreCompactCapturedEvent` interface (search for `export interface PreCompactCapturedEvent`), add:

```typescript
/** Emitted when bulk transcript replay begins. */
export interface BulkProcessingStartEvent extends LoggingEventBase<BulkProcessingStartPayload> {
  type: 'bulk-processing:start'
  source: 'transcript'
}

/** Emitted when bulk transcript replay completes. */
export interface BulkProcessingFinishEvent extends LoggingEventBase<BulkProcessingFinishPayload> {
  type: 'bulk-processing:finish'
  source: 'transcript'
}
```

- [ ] **Step 3: Add to `TranscriptLoggingEvent` union**

Change line 724:
```typescript
// Before:
export type TranscriptLoggingEvent = TranscriptEventEmittedEvent | PreCompactCapturedEvent

// After:
export type TranscriptLoggingEvent =
  | TranscriptEventEmittedEvent
  | PreCompactCapturedEvent
  | BulkProcessingStartEvent
  | BulkProcessingFinishEvent
```

- [ ] **Step 4: Add to `UI_EVENT_TYPES` tuple**

After `'transcript:pre-compact',` (line 823), add:
```typescript
  // Bulk processing lifecycle events
  'bulk-processing:start',
  'bulk-processing:finish',
```

- [ ] **Step 5: Add to `UIEventPayloadMap`**

After `'transcript:pre-compact': TranscriptPreCompactPayload` (line 1133), add:
```typescript
  'bulk-processing:start': BulkProcessingStartPayload
  'bulk-processing:finish': BulkProcessingFinishPayload
```

- [ ] **Step 6: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS (no errors from the new types)

- [ ] **Step 7: Commit**

```bash
git add packages/types/src/events.ts
git commit -m "feat(types): add bulk-processing:start/finish event types (7ri)"
```

---

### Task 2: Add factory functions to `LogEvents`

**Files:**
- Modify: `packages/sidekick-core/src/structured-logging.ts`
- Modify: `packages/sidekick-core/src/__tests__/structured-logging.test.ts`

- [ ] **Step 1: Add imports**

In the import block at line 757, add `BulkProcessingStartEvent` and `BulkProcessingFinishEvent` to the import list from `'@sidekick/types'`.

- [ ] **Step 2: Write failing tests**

In `packages/sidekick-core/src/__tests__/structured-logging.test.ts`, find the last `it(...)` block inside the `describe('Event Logging Helpers', ...)` suite (line 1045). After it, add:

```typescript
    it('should create BulkProcessingStart events with correct structure', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.bulkProcessingStart(
        { sessionId: 'sess-123' },
        { fileSize: 102400 }
      )

      expect(event.type).toBe('bulk-processing:start')
      expect(event.source).toBe('transcript')
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.fileSize).toBe(102400)
      expect(event.time).toBeGreaterThan(0)
    })

    it('should create BulkProcessingFinish events with correct structure', async () => {
      const { LogEvents } = await import('../structured-logging')

      const event = LogEvents.bulkProcessingFinish(
        { sessionId: 'sess-123' },
        { totalLinesProcessed: 500, durationMs: 1234 }
      )

      expect(event.type).toBe('bulk-processing:finish')
      expect(event.source).toBe('transcript')
      expect(event.context.sessionId).toBe('sess-123')
      expect(event.payload.totalLinesProcessed).toBe(500)
      expect(event.payload.durationMs).toBe(1234)
      expect(event.time).toBeGreaterThan(0)
    })
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --run structured-logging`
Expected: FAIL — `LogEvents.bulkProcessingStart is not a function`

- [ ] **Step 4: Add factory functions**

In `packages/sidekick-core/src/structured-logging.ts`, before the closing `}` of `LogEvents` (line 1382), add after the `cliErrorOccurred` method:

```typescript

  // --- Bulk Processing Lifecycle Events ---

  /**
   * Create a BulkProcessingStart event (logged when transcript bulk replay begins).
   */
  bulkProcessingStart(
    context: EventLogContext,
    metadata: { fileSize: number }
  ): BulkProcessingStartEvent {
    return {
      type: 'bulk-processing:start',
      time: Date.now(),
      source: 'transcript',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        fileSize: metadata.fileSize,
      },
    }
  },

  /**
   * Create a BulkProcessingFinish event (logged when transcript bulk replay completes).
   */
  bulkProcessingFinish(
    context: EventLogContext,
    metadata: { totalLinesProcessed: number; durationMs: number }
  ): BulkProcessingFinishEvent {
    return {
      type: 'bulk-processing:finish',
      time: Date.now(),
      source: 'transcript',
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        totalLinesProcessed: metadata.totalLinesProcessed,
        durationMs: metadata.durationMs,
      },
    }
  },
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --run structured-logging`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-core/src/structured-logging.ts packages/sidekick-core/src/__tests__/structured-logging.test.ts
git commit -m "feat(core): add bulk-processing:start/finish factory functions (7ri)"
```

---

### Task 3: Write failing tests for one-shot guard and lifecycle events

**Files:**
- Modify: `packages/sidekick-core/src/__tests__/transcript-service.test.ts`

- [ ] **Step 1: Add `hasFiredBulkComplete` and `isBulkProcessing` to test internals type**

Find the `TranscriptServiceTestInternals` interface (line 38). Add:
```typescript
  hasFiredBulkComplete: boolean
  isBulkProcessing: boolean
```

- [ ] **Step 2: Add helper to extract logEvent calls from the mock logger**

After the `cleanupTestDir` helper (around line 97), add:

```typescript
/**
 * Extract logEvent calls from logger.info mock by filtering for a specific event type.
 * logEvent() calls logger.info(msg, { type, source, ...payload }).
 */
function findLogEventCalls(
  mockLogger: Logger,
  eventType: string
): Array<Record<string, unknown>> {
  return (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls
    .filter((call: unknown[]) => {
      const meta = call[1] as Record<string, unknown> | undefined
      return meta?.type === eventType
    })
    .map((call: unknown[]) => call[1] as Record<string, unknown>)
}
```

- [ ] **Step 3: Write test — BulkProcessingComplete fires exactly once on initial processing**

In the `event emission` describe block (line 891), add:

```typescript
    it('emits BulkProcessingComplete on first processing of existing transcript', async () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ text: 'Hi' }] } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const bulkEvents = handlers.emittedEvents.filter(e => e.eventType === 'BulkProcessingComplete')
      expect(bulkEvents).toHaveLength(1)
    })
```

- [ ] **Step 4: Write test — no second BulkProcessingComplete after truncation reset**

```typescript
    it('does not emit BulkProcessingComplete a second time after truncation reset (re0)', async () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ text: 'Hi' }] } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      // First bulk processing should have fired
      expect(handlers.emittedEvents.filter(e => e.eventType === 'BulkProcessingComplete')).toHaveLength(1)

      // Simulate /clear truncation: write shorter content
      const newTranscript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'After clear' } }),
      ].join('\n')
      writeFileSync(transcriptPath, newTranscript)

      // Process again (simulates watcher tick after truncation)
      const internals = getTestHelpers(service)
      await internals.processTranscriptFile()

      // Should NOT have emitted a second BulkProcessingComplete
      const bulkEvents = handlers.emittedEvents.filter(e => e.eventType === 'BulkProcessingComplete')
      expect(bulkEvents).toHaveLength(1)
    })
```

- [ ] **Step 5: Write test — hasFiredBulkComplete flag is set after emission**

```typescript
    it('sets hasFiredBulkComplete flag after first emission', async () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      const internals = getTestHelpers(service)
      expect(internals.hasFiredBulkComplete).toBe(false)

      await service.start()
      expect(internals.hasFiredBulkComplete).toBe(true)
    })
```

- [ ] **Step 6: Write test — bulk-processing:start/finish log events are emitted**

```typescript
    it('emits bulk-processing:start and bulk-processing:finish log events', async () => {
      const transcript = [
        JSON.stringify({ type: 'user', message: { role: 'user', content: 'Hello' } }),
        JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ text: 'Hi' }] } }),
      ].join('\n')
      writeFileSync(transcriptPath, transcript)

      await service.prepare('test-session', transcriptPath)
      await service.start()

      const startEvents = findLogEventCalls(logger, 'bulk-processing:start')
      expect(startEvents).toHaveLength(1)
      expect(startEvents[0]).toMatchObject({
        type: 'bulk-processing:start',
        source: 'transcript',
      })

      const finishEvents = findLogEventCalls(logger, 'bulk-processing:finish')
      expect(finishEvents).toHaveLength(1)
      expect(finishEvents[0]).toMatchObject({
        type: 'bulk-processing:finish',
        source: 'transcript',
      })
      // Check payload includes duration and line count
      expect((finishEvents[0] as any).totalLinesProcessed).toBe(2)
      expect((finishEvents[0] as any).durationMs).toBeGreaterThanOrEqual(0)
    })
```

- [ ] **Step 7: Run tests to verify they fail**

Run: `pnpm --filter @sidekick/core test -- --run transcript-service.test`
Expected: FAIL — one-shot guard doesn't exist yet, lifecycle events not emitted

- [ ] **Step 8: Commit failing tests**

```bash
git add packages/sidekick-core/src/__tests__/transcript-service.test.ts
git commit -m "test(core): add failing tests for bulk processing one-shot guard and lifecycle events"
```

---

### Task 4: Implement one-shot guard and lifecycle events in TranscriptService

**Files:**
- Modify: `packages/sidekick-core/src/transcript-service.ts`

- [ ] **Step 1: Add new fields**

After `private isBulkProcessing = false` (line 249), add:

```typescript
  /** One-shot guard — prevents BulkProcessingComplete from firing more than once per instance */
  private hasFiredBulkComplete = false

  /** Timestamp when bulk processing started (for duration calculation in finish event) */
  private bulkStartTime = 0
```

- [ ] **Step 2: Add lifecycle event imports**

Add `LogEvents` and `logEvent` to the existing import from `'./structured-logging.js'` (line 22). These should already be imported — verify and add if missing.

- [ ] **Step 3: Add bulk-processing:start emission**

Replace the `isBulkStart` block (~line 1199-1205):

```typescript
// Before:
    if (isBulkStart) {
      this.isBulkProcessing = true
      this.options.logger.info('Bulk processing started (streaming)', {
        sessionId: this.sessionId,
        fileSize: currentFileSize,
      })
    }

// After:
    if (isBulkStart) {
      this.isBulkProcessing = true
      this.bulkStartTime = Date.now()
      logEvent(
        this.options.logger,
        LogEvents.bulkProcessingStart(
          { sessionId: this.sessionId! },
          { fileSize: currentFileSize }
        )
      )
    }
```

- [ ] **Step 4: Add one-shot guard and bulk-processing:finish emission**

Replace the bulk completion block (~line 1280-1288):

```typescript
// Before:
    if (isBulkStart && this.isBulkProcessing) {
      this.isBulkProcessing = false
      await this.emitEvent('BulkProcessingComplete', {} as TranscriptEntry, lineNumber)
      this.options.logger.info('Bulk processing complete', {
        sessionId: this.sessionId,
        totalLinesProcessed: lineNumber,
      })
    }

// After:
    if (isBulkStart && this.isBulkProcessing && !this.hasFiredBulkComplete) {
      this.isBulkProcessing = false
      this.hasFiredBulkComplete = true
      const durationMs = Date.now() - this.bulkStartTime
      logEvent(
        this.options.logger,
        LogEvents.bulkProcessingFinish(
          { sessionId: this.sessionId! },
          { totalLinesProcessed: lineNumber, durationMs }
        )
      )
      await this.emitEvent('BulkProcessingComplete', {} as TranscriptEntry, lineNumber)
    }
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --run transcript-service.test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-core/src/transcript-service.ts
git commit -m "fix(core): prevent spurious BulkProcessingComplete after /clear (re0)

Add one-shot guard (hasFiredBulkComplete) so BulkProcessingComplete fires
exactly once per TranscriptService instance. Also emit bulk-processing:start
and bulk-processing:finish log events for UI timeline rendering (7ri)."
```

---

### Task 5: Verify build, typecheck, and lint

**Files:** None (verification only)

- [ ] **Step 1: Run full typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 2: Run full build**

Run: `pnpm build`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (or fix any lint issues)

- [ ] **Step 4: Run full test suite (excluding IPC)**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: PASS

- [ ] **Step 5: Final commit if any lint fixes were needed**

Only if lint required fixes:
```bash
git add -u
git commit -m "fix(core): lint fixes for bulk processing changes"
```
