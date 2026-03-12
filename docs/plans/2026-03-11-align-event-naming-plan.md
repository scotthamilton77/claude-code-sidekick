# Align Event Naming with Canonical Contract — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rename all PascalCase logging event type discriminators to `category:action` format, flatten nested payloads, and split `SummaryUpdated` into discrete canonical events.

**Architecture:** The codebase has two event layers: (1) `LoggingEvent` interfaces + factory functions used by the daemon/CLI for structured logging, and (2) `UIEventType` canonical types for the monitoring UI. This plan aligns layer 1 to match layer 2's naming convention. Factory function signatures change to produce flat payloads matching canonical `PayloadFor<T>` interfaces.

**Tech Stack:** TypeScript, Vitest, pnpm monorepo

---

## Phase 0: Baseline Test Coverage (Before Any Changes)

Fill test coverage gaps so renames cause clear, attributable failures if anything breaks.

### Task 0A: Add missing `LogEvents` factory tests in `@sidekick/core`

**Files:**
- Modify: `packages/sidekick-core/src/__tests__/structured-logging.test.ts` (append to "Event Logging Helpers" describe block at ~line 1045)

**Context:** Currently only 6 of 17 `LogEvents` factories have tests. The 11 untested factories are: `reminderStaged`, `daemonStarting`, `daemonStarted`, `ipcServerStarted`, `configWatcherStarted`, `sessionEvictionStarted`, `statuslineRendered`, `statuslineError`, `resumeGenerating`, `resumeUpdated`, `resumeSkipped`.

**Step 1: Write tests for all 11 missing factories**

Follow the existing test pattern (dynamic import, verify type, source, context, and payload fields). Each test should verify:
- `type` discriminator string (the current PascalCase value — we rename later)
- `source` field ('cli', 'daemon', or 'transcript')
- `time` field is > 0
- `context.sessionId` is set
- All payload fields are present and correct

```typescript
it('should create ReminderStaged events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.reminderStaged(
    { sessionId: 'sess-123', hook: 'PreToolUse' },
    { reminderName: 'test-reminder', hookName: 'PreToolUse', blocking: true, priority: 80, persistent: false },
    { stagingPath: '/tmp/staging/test.json' }
  )
  expect(event.type).toBe('ReminderStaged')
  expect(event.source).toBe('daemon')
  expect(event.time).toBeGreaterThan(0)
  expect(event.context.sessionId).toBe('sess-123')
  expect(event.payload.state.reminderName).toBe('test-reminder')
  expect(event.payload.state.blocking).toBe(true)
  expect(event.payload.state.priority).toBe(80)
  expect(event.payload.metadata?.stagingPath).toBe('/tmp/staging/test.json')
})

it('should create DaemonStarting events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.daemonStarting({ projectDir: '/workspace', pid: 12345 })
  expect(event.type).toBe('DaemonStarting')
  expect(event.source).toBe('daemon')
  expect(event.time).toBeGreaterThan(0)
  expect(event.payload.metadata.projectDir).toBe('/workspace')
  expect(event.payload.metadata.pid).toBe(12345)
})

it('should create DaemonStarted events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.daemonStarted({ startupDurationMs: 250 })
  expect(event.type).toBe('DaemonStarted')
  expect(event.source).toBe('daemon')
  expect(event.payload.metadata.startupDurationMs).toBe(250)
})

it('should create IpcServerStarted events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.ipcServerStarted({ socketPath: '/tmp/sidekick.sock' })
  expect(event.type).toBe('IpcServerStarted')
  expect(event.source).toBe('daemon')
  expect(event.payload.metadata.socketPath).toBe('/tmp/sidekick.sock')
})

it('should create ConfigWatcherStarted events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.configWatcherStarted({
    projectDir: '/workspace',
    watchedFiles: ['config.yaml', 'sidekick.yaml'],
  })
  expect(event.type).toBe('ConfigWatcherStarted')
  expect(event.source).toBe('daemon')
  expect(event.payload.metadata.projectDir).toBe('/workspace')
  expect(event.payload.metadata.watchedFiles).toEqual(['config.yaml', 'sidekick.yaml'])
})

it('should create SessionEvictionStarted events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.sessionEvictionStarted({ intervalMs: 60000 })
  expect(event.type).toBe('SessionEvictionStarted')
  expect(event.source).toBe('daemon')
  expect(event.payload.metadata.intervalMs).toBe(60000)
})

it('should create StatuslineRendered events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.statuslineRendered(
    { sessionId: 'sess-123' },
    { displayMode: 'session_summary', staleData: false },
    { model: 'claude-opus-4-6', tokens: 5000, durationMs: 15 }
  )
  expect(event.type).toBe('StatuslineRendered')
  expect(event.source).toBe('cli')
  expect(event.payload.state.displayMode).toBe('session_summary')
  expect(event.payload.state.staleData).toBe(false)
  expect(event.payload.metadata.model).toBe('claude-opus-4-6')
  expect(event.payload.metadata.durationMs).toBe(15)
})

it('should create StatuslineError events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.statuslineError(
    { sessionId: 'sess-123' },
    'state_file_missing',
    { fallbackUsed: true, file: '/tmp/state.json' }
  )
  expect(event.type).toBe('StatuslineError')
  expect(event.source).toBe('cli')
  expect(event.payload.reason).toBe('state_file_missing')
  expect(event.payload.metadata.fallbackUsed).toBe(true)
})

it('should create ResumeGenerating events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.resumeGenerating(
    { sessionId: 'sess-123' },
    { title_confidence: 0.9, intent_confidence: 0.85 }
  )
  expect(event.type).toBe('ResumeGenerating')
  expect(event.source).toBe('daemon')
  expect(event.payload.metadata.title_confidence).toBe(0.9)
  expect(event.payload.reason).toBe('pivot_detected')
})

it('should create ResumeUpdated events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.resumeUpdated(
    { sessionId: 'sess-123' },
    { snarky_comment: 'Welcome back, champ', timestamp: '2026-03-11T10:00:00Z' }
  )
  expect(event.type).toBe('ResumeUpdated')
  expect(event.source).toBe('daemon')
  expect(event.payload.state.snarky_comment).toBe('Welcome back, champ')
  expect(event.payload.reason).toBe('generation_complete')
})

it('should create ResumeSkipped events', async () => {
  const { LogEvents } = await import('../structured-logging')
  const event = LogEvents.resumeSkipped(
    { sessionId: 'sess-123' },
    { title_confidence: 0.3, intent_confidence: 0.4, min_confidence: 0.6 },
    'confidence_below_threshold'
  )
  expect(event.type).toBe('ResumeSkipped')
  expect(event.source).toBe('daemon')
  expect(event.payload.metadata.title_confidence).toBe(0.3)
  expect(event.payload.metadata.min_confidence).toBe(0.6)
  expect(event.payload.reason).toBe('confidence_below_threshold')
})
```

**Step 2: Run tests**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern structured-logging`
Expected: ALL PASS (11 new tests pass against current PascalCase implementation)

**Step 3: Commit**

```
git commit -m "test(core): add baseline tests for 11 untested LogEvents factories"
```

---

### Task 0B: Add `isLoggingEvent` type guard tests

**Files:**
- Modify: `packages/sidekick-core/src/__tests__/structured-logging.test.ts` (or `packages/sidekick-core/src/__tests__/events.test.ts` if it already has type guard tests)

**Step 1: Write runtime type guard tests**

Test `isLoggingEvent`, `isCLILoggingEvent`, `isDaemonLoggingEvent`, `isTranscriptLoggingEvent` with real event objects from factories.

```typescript
import { isLoggingEvent, isCLILoggingEvent, isDaemonLoggingEvent, isTranscriptLoggingEvent } from '@sidekick/types'

describe('Logging Event Type Guards', () => {
  it('isLoggingEvent returns true for factory-created events', async () => {
    const { LogEvents } = await import('../structured-logging')
    const event = LogEvents.hookReceived(
      { sessionId: 's', hook: 'SessionStart' },
      { mode: 'hook' }
    )
    expect(isLoggingEvent(event)).toBe(true)
  })

  it('isLoggingEvent returns false for non-event objects', () => {
    expect(isLoggingEvent({})).toBe(false)
    expect(isLoggingEvent(null)).toBe(false)
    expect(isLoggingEvent({ type: 'foo' })).toBe(false) // missing time, source, context, payload
  })

  it('isCLILoggingEvent identifies CLI events', async () => {
    const { LogEvents } = await import('../structured-logging')
    const cliEvent = LogEvents.hookReceived({ sessionId: 's', hook: 'SessionStart' }, {})
    const daemonEvent = LogEvents.daemonStarting({ projectDir: '/', pid: 1 })
    expect(isCLILoggingEvent(cliEvent)).toBe(true)
    expect(isCLILoggingEvent(daemonEvent)).toBe(false)
  })

  it('isDaemonLoggingEvent identifies daemon events', async () => {
    const { LogEvents } = await import('../structured-logging')
    const daemonEvent = LogEvents.eventReceived({ sessionId: 's' }, { eventKind: 'hook' })
    const cliEvent = LogEvents.hookReceived({ sessionId: 's', hook: 'SessionStart' }, {})
    expect(isDaemonLoggingEvent(daemonEvent)).toBe(true)
    expect(isDaemonLoggingEvent(cliEvent)).toBe(false)
  })

  it('isTranscriptLoggingEvent identifies transcript events', async () => {
    const { LogEvents } = await import('../structured-logging')
    const { createDefaultMetrics } = await import('../transcript-service')
    const metrics = { ...createDefaultMetrics(), turnCount: 1, lastProcessedLine: 1 }
    const transcriptEvent = LogEvents.transcriptEventEmitted(
      { sessionId: 's' },
      { eventType: 'UserPrompt', lineNumber: 1 },
      { transcriptPath: '/tmp/t.jsonl', metrics }
    )
    const cliEvent = LogEvents.hookReceived({ sessionId: 's', hook: 'SessionStart' }, {})
    expect(isTranscriptLoggingEvent(transcriptEvent)).toBe(true)
    expect(isTranscriptLoggingEvent(cliEvent)).toBe(false)
  })
})
```

**Step 2: Run tests**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern structured-logging`
Expected: PASS

**Step 3: Commit**

```
git commit -m "test(core): add runtime tests for logging event type guards"
```

---

### Task 0C: Add `logEvent` helper integration test with full payload

**Files:**
- Modify: `packages/sidekick-core/src/__tests__/structured-logging.test.ts`

**Context:** The existing `logEvent` test only verifies type and source. Add a test that verifies the full flattened output structure (all payload fields appear at the top level of the logged object).

**Step 1: Write integration test**

```typescript
it('logEvent should flatten payload fields into log output', async () => {
  const { createContextLogger, LogEvents, logEvent } = await import('../structured-logging')
  const { stream, lines } = createTestStream()

  const logger = createContextLogger({
    source: 'daemon',
    context: { sessionId: 'sess-123' },
    testStream: stream,
  })

  const event = LogEvents.eventProcessed(
    { sessionId: 'sess-123' },
    { handlerId: 'test:handler', success: true },
    { durationMs: 42 }
  )

  logEvent(logger, event)
  await logger.flush()

  expect(lines.length).toBe(1)
  const log = parseLogLine(lines[0])
  expect(log.type).toBe('EventProcessed')
  expect(log.source).toBe('daemon')
  // Verify payload fields are spread into the log
  expect(log.state.handlerId).toBe('test:handler')
  expect(log.metadata.durationMs).toBe(42)
})

it('logEvent should use payload.reason as message when present', async () => {
  const { createContextLogger, logEvent } = await import('../structured-logging')
  const { SessionSummaryEvents } = await import(
    '@sidekick/feature-session-summary/events'
  )
  const { stream, lines } = createTestStream()

  const logger = createContextLogger({
    source: 'daemon',
    context: { sessionId: 'sess-123' },
    testStream: stream,
  })

  const event = SessionSummaryEvents.summarySkipped(
    { sessionId: 'sess-123' },
    { countdown: 5, countdown_threshold: 0 }
  )

  logEvent(logger, event)
  await logger.flush()

  expect(lines.length).toBe(1)
  const log = parseLogLine(lines[0])
  // logEvent uses reason as message when available
  expect(log.msg).toBe('countdown_active')
})
```

**Step 2: Run tests**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern structured-logging`
Expected: PASS

**Step 3: Commit**

```
git commit -m "test(core): add logEvent integration tests verifying payload flattening"
```

---

### Task 0D: Add `SIDEKICK_EVENT_TO_FILTER` mapping test in UI package

**Files:**
- Create: `packages/sidekick-ui/src/__tests__/types.test.ts`

**Step 1: Write mapping completeness and correctness tests**

```typescript
import { describe, it, expect } from 'vitest'
import { SIDEKICK_EVENT_TO_FILTER, type SidekickEventType, type TimelineFilter } from '../types'

describe('SIDEKICK_EVENT_TO_FILTER', () => {
  it('should map all 16 SidekickEventType values', () => {
    const expectedTypes: SidekickEventType[] = [
      'reminder-staged', 'reminder-unstaged', 'reminder-consumed',
      'decision',
      'session-summary-start', 'session-summary-finish',
      'session-title-changed', 'intent-changed',
      'snarky-message-start', 'snarky-message-finish',
      'resume-message-start', 'resume-message-finish',
      'persona-selected', 'persona-changed',
      'statusline-rendered',
      'log-error',
    ]
    expect(Object.keys(SIDEKICK_EVENT_TO_FILTER).sort()).toEqual(expectedTypes.sort())
  })

  it('should map reminder events to reminders filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['reminder-staged']).toBe('reminders')
    expect(SIDEKICK_EVENT_TO_FILTER['reminder-unstaged']).toBe('reminders')
    expect(SIDEKICK_EVENT_TO_FILTER['reminder-consumed']).toBe('reminders')
  })

  it('should map analysis events to session-analysis filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['session-summary-start']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['session-summary-finish']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['session-title-changed']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['intent-changed']).toBe('session-analysis')
    expect(SIDEKICK_EVENT_TO_FILTER['persona-selected']).toBe('session-analysis')
  })

  it('should map decision to decisions filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['decision']).toBe('decisions')
  })

  it('should map statusline to statusline filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['statusline-rendered']).toBe('statusline')
  })

  it('should map log-error to errors filter', () => {
    expect(SIDEKICK_EVENT_TO_FILTER['log-error']).toBe('errors')
  })

  it('every mapped value should be a valid TimelineFilter', () => {
    const validFilters: TimelineFilter[] = ['reminders', 'decisions', 'session-analysis', 'statusline', 'errors']
    for (const filter of Object.values(SIDEKICK_EVENT_TO_FILTER)) {
      expect(validFilters).toContain(filter)
    }
  })
})
```

**Step 2: Run tests**

Run: `pnpm --filter sidekick-ui test -- --testPathPattern types`
Expected: PASS

**Step 3: Commit**

```
git commit -m "test(ui): add baseline tests for SIDEKICK_EVENT_TO_FILTER mapping"
```

---

### Task 0E: Add handler-level event emission test for `update-summary.ts`

**Files:**
- Modify: `packages/feature-session-summary/src/__tests__/side-effects.test.ts` (or create a new `event-emission.test.ts` if side-effects.test.ts is not the right home)

**Context:** The `performAnalysis` function in `update-summary.ts` calls `logEvent(ctx.logger, SessionSummaryEvents.summaryUpdated(...))` at line ~404, but no test verifies this emission. We need a test that exercises `updateSessionSummary()` with a mocked LLM and verifies the `SummaryUpdated` event is logged with correct payload.

**Step 1: Research existing test infrastructure**

Read `packages/feature-session-summary/src/__tests__/handlers.test.ts` and any test helper files to understand how `DaemonContext` is mocked for session-summary tests.

**Step 2: Write event emission test**

The test should:
1. Mock LLM to return a valid session summary response
2. Call `updateSessionSummary()` with a UserPrompt transcript event
3. Verify `ctx.logger.info` was called with an object containing `type: 'SummaryUpdated'`
4. Verify the payload includes `state.session_title`, `metadata.pivot_detected`, and `reason`

**Step 3: Run tests**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --testPathPattern event-emission`
Expected: PASS

**Step 4: Commit**

```
git commit -m "test(session-summary): add handler-level event emission verification"
```

---

### Task 0F: Verify all baseline tests pass

**Step 1: Run all tests**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Run: `pnpm --filter @sidekick/types test`
Run: `pnpm --filter @sidekick/feature-reminders test`
Run: `pnpm --filter @sidekick/feature-session-summary test`
Run: `pnpm --filter sidekick-ui test`
Expected: ALL PASS

**Step 2: Commit tag**

```
git commit --allow-empty -m "test: baseline event test coverage complete — ready for rename"
```

---

## Phase 1: Rename PascalCase Type Discriminators (Mechanical)

### Task 1: Update LoggingEvent interfaces in `@sidekick/types`

**Files:**
- Modify: `packages/types/src/events.ts:404-823`

Change every `type: 'PascalCase'` string literal to `type: 'category:action'` in the LoggingEvent interface definitions. Also flatten nested `payload.state` / `payload.metadata` into flat `payload` where the canonical payload interface differs.

**Step 1: Update interface type discriminators and flatten payloads**

Apply these renames to the interface definitions (lines 404-823):

| Interface | Old `type` | New `type` |
|-----------|-----------|-----------|
| `HookReceivedEvent` | `'HookReceived'` | `'hook:received'` |
| `ReminderConsumedEvent` | `'ReminderConsumed'` | `'reminder:consumed'` |
| `HookCompletedEvent` | `'HookCompleted'` | `'hook:completed'` |
| `EventReceivedEvent` | `'EventReceived'` | `'event:received'` |
| `EventProcessedEvent` | `'EventProcessed'` | `'event:processed'` |
| `ReminderStagedEvent` | `'ReminderStaged'` | `'reminder:staged'` |
| `DaemonStartingEvent` | `'DaemonStarting'` | `'daemon:starting'` |
| `DaemonStartedEvent` | `'DaemonStarted'` | `'daemon:started'` |
| `IpcServerStartedEvent` | `'IpcServerStarted'` | `'ipc:started'` |
| `ConfigWatcherStartedEvent` | `'ConfigWatcherStarted'` | `'config:watcher-started'` |
| `SessionEvictionStartedEvent` | `'SessionEvictionStarted'` | `'session:eviction-started'` |
| `SummarySkippedEvent` | `'SummarySkipped'` | `'session-summary:skipped'` |
| `ResumeGeneratingEvent` | `'ResumeGenerating'` | `'resume-message:start'` |
| `ResumeUpdatedEvent` | `'ResumeUpdated'` | `'resume-message:finish'` |
| `ResumeSkippedEvent` | `'ResumeSkipped'` | `'resume-message:skipped'` |
| `RemindersClearedEvent` | `'RemindersCleared'` | `'reminder:cleared'` |
| `StatuslineRenderedEvent` | `'StatuslineRendered'` | `'statusline:rendered'` |
| `StatuslineErrorEvent` | `'StatuslineError'` | `'statusline:error'` |
| `TranscriptEventEmittedEvent` | `'TranscriptEventEmitted'` | `'transcript:emitted'` |
| `PreCompactCapturedEvent` | `'PreCompactCaptured'` | `'transcript:pre-compact'` |

Additionally flatten `ReminderStagedEvent` payload — remove `state`/`metadata` nesting:
```typescript
// Before:
payload: { state: { reminderName, hookName, ... }, metadata?: { stagingPath? } }
// After:
payload: { reminderName: string, hookName: string, blocking: boolean, priority: number, persistent: boolean }
```

Apply same flattening pattern to ALL LoggingEvent interfaces to match their canonical `PayloadFor<T>` counterparts defined at lines 931-1144.

**Do NOT change:** `SummaryUpdatedEvent` — this gets replaced in Task 6.

**Step 2: Run typecheck to find cascading errors**

Run: `pnpm --filter @sidekick/types typecheck`
Expected: Type errors in downstream packages (factory functions, tests) — this is expected and will be fixed in subsequent tasks.

**Step 3: Commit**

```
git commit -m "refactor(types): rename LoggingEvent type discriminators to category:action format"
```

---

### Task 2: Update `LogEvents` factory in `@sidekick/core`

**Files:**
- Modify: `packages/sidekick-core/src/structured-logging.ts:792-1244`

**Step 1: Update all factory method return values**

Change every `type: 'PascalCase'` to `type: 'category:action'` in the `LogEvents` object.
Also flatten the return object payloads to match the updated interfaces from Task 1.

Example for `hookReceived`:
```typescript
// Before:
return { type: 'HookReceived', ..., payload: { metadata } }
// After:
return { type: 'hook:received', ..., payload: { hook: context.hook, ...metadata } }
```

Apply to all 17 factory methods (hookReceived, hookCompleted, eventReceived, eventProcessed, reminderStaged, daemonStarting, daemonStarted, ipcServerStarted, configWatcherStarted, sessionEvictionStarted, statuslineRendered, statuslineError, resumeGenerating, resumeUpdated, resumeSkipped, transcriptEventEmitted, preCompactCaptured).

**Step 2: Run typecheck**

Run: `pnpm --filter @sidekick/core typecheck`
Expected: PASS (factories now match updated interfaces)

**Step 3: Commit**

```
git commit -m "refactor(core): update LogEvents factories to emit category:action types with flat payloads"
```

---

### Task 3: Update `ReminderEvents` factory in `feature-reminders`

**Files:**
- Modify: `packages/feature-reminders/src/events.ts`

**Step 1: Update factory methods**

- `reminderConsumed`: `type: 'ReminderConsumed'` → `type: 'reminder:consumed'`, flatten payload
- `remindersCleared`: `type: 'RemindersCleared'` → `type: 'reminder:cleared'`, flatten payload

**Step 2: Update tests**

- Modify: `packages/feature-reminders/src/__tests__/events.test.ts`
- Change `expect(event.type).toBe('ReminderConsumed')` → `expect(event.type).toBe('reminder:consumed')`
- Change `expect(event.type).toBe('RemindersCleared')` → `expect(event.type).toBe('reminder:cleared')`
- Update payload access paths (e.g., `event.payload.state.reminderName` → `event.payload.reminderName`)

**Step 3: Run tests**

Run: `pnpm --filter @sidekick/feature-reminders test`
Expected: PASS

**Step 4: Commit**

```
git commit -m "refactor(reminders): rename event factories to category:action format"
```

---

### Task 4: Update `SessionSummaryEvents.summarySkipped` factory

**Files:**
- Modify: `packages/feature-session-summary/src/events.ts`

**Step 1: Update `summarySkipped` factory**

- `type: 'SummarySkipped'` → `type: 'session-summary:skipped'`
- Flatten payload to match `SessionSummarySkippedPayload`

**Step 2: Update tests**

- Modify: `packages/feature-session-summary/src/__tests__/events.test.ts`
- Update `summarySkipped` test assertions

**Step 3: Run tests**

Run: `pnpm --filter @sidekick/feature-session-summary test -- --exclude '**/handlers.test.ts' --exclude '**/side-effects.test.ts' --exclude '**/create-first-summary.test.ts' --exclude '**/countdown-logic.test.ts' --exclude '**/persona*.test.ts' --exclude '**/error-handling.test.ts' --exclude '**/on-demand-generation.test.ts' --exclude '**/word-count-config.test.ts'`
Expected: events.test.ts PASS

**Step 4: Commit**

```
git commit -m "refactor(session-summary): rename summarySkipped to session-summary:skipped"
```

---

### Task 5: Update structured-logging tests in `@sidekick/core`

**Files:**
- Modify: `packages/sidekick-core/src/__tests__/structured-logging.test.ts`

**Step 1: Update all PascalCase type assertions**

Change all `expect(event.type).toBe('PascalCase')` to the new `category:action` format.
Also update payload access paths to match flattened structure.

**Step 2: Run tests**

Run: `pnpm --filter @sidekick/core test -- --testPathPattern structured-logging`
Expected: PASS

**Step 3: Commit**

```
git commit -m "test(core): update structured-logging tests for category:action event names"
```

---

## Phase 2: Split `SummaryUpdated` into Discrete Events

### Task 6: Replace `SummaryUpdatedEvent` interface with discrete event types

**Files:**
- Modify: `packages/types/src/events.ts`

**Step 1: Remove `SummaryUpdatedEvent` interface**

Delete the `SummaryUpdatedEvent` interface (lines ~584-604). Replace references in the `DaemonLoggingEvent` union.

**Step 2: Add new interfaces for the split events**

Add these new LoggingEvent interfaces (reusing the canonical payload types):

```typescript
/** Emitted when session summary LLM generation begins. */
export interface SessionSummaryStartEvent extends LoggingEventBase {
  type: 'session-summary:start'
  source: 'daemon'
  payload: SessionSummaryStartPayload
}

/** Emitted when session summary LLM generation completes. */
export interface SessionSummaryFinishEvent extends LoggingEventBase {
  type: 'session-summary:finish'
  source: 'daemon'
  payload: SessionSummaryFinishPayload
}

/** Emitted when session title changes (conditional on diff). */
export interface SessionTitleChangedEvent extends LoggingEventBase {
  type: 'session-title:changed'
  source: 'daemon'
  payload: SessionTitleChangedPayload
}

/** Emitted when latest intent changes (conditional on diff). */
export interface IntentChangedEvent extends LoggingEventBase {
  type: 'intent:changed'
  source: 'daemon'
  payload: IntentChangedPayload
}
```

Import the canonical payload types (already defined in the same file).

**Step 3: Update `DaemonLoggingEvent` union**

Replace `SummaryUpdatedEvent` with `SessionSummaryStartEvent | SessionSummaryFinishEvent | SessionTitleChangedEvent | IntentChangedEvent`.

**Step 4: Update exports**

Remove `SummaryUpdatedEvent` from any exports. Add new event types.

**Step 5: Commit**

```
git commit -m "refactor(types): replace SummaryUpdatedEvent with discrete session-summary/title/intent events"
```

---

### Task 7: Replace `SessionSummaryEvents` factory with discrete event factories

**Files:**
- Modify: `packages/feature-session-summary/src/events.ts`

**Step 1: Replace `summaryUpdated` factory with three factories**

```typescript
import type {
  SessionSummaryStartEvent,
  SessionSummaryFinishEvent,
  SessionTitleChangedEvent,
  IntentChangedEvent,
  SummarySkippedEvent,
  EventLogContext,
  SessionSummaryStartPayload,
  SessionSummaryFinishPayload,
  SessionTitleChangedPayload,
  IntentChangedPayload,
  SessionSummarySkippedPayload,
} from '@sidekick/types'

export const SessionSummaryEvents = {
  /** Emitted when summary generation begins */
  summaryStart(
    context: EventLogContext,
    payload: SessionSummaryStartPayload
  ): SessionSummaryStartEvent {
    return {
      type: 'session-summary:start',
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

  /** Emitted when summary generation completes */
  summaryFinish(
    context: EventLogContext,
    payload: SessionSummaryFinishPayload
  ): SessionSummaryFinishEvent {
    return {
      type: 'session-summary:finish',
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

  /** Emitted when session title changes */
  titleChanged(
    context: EventLogContext,
    payload: SessionTitleChangedPayload
  ): SessionTitleChangedEvent {
    return {
      type: 'session-title:changed',
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

  /** Emitted when latest intent changes */
  intentChanged(
    context: EventLogContext,
    payload: IntentChangedPayload
  ): IntentChangedEvent {
    return {
      type: 'intent:changed',
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

  /** summary generation skipped (unchanged from Task 4, included for completeness) */
  summarySkipped(
    context: EventLogContext,
    payload: SessionSummarySkippedPayload
  ): SummarySkippedEvent {
    return {
      type: 'session-summary:skipped',
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

**Step 2: Update events test**

- Modify: `packages/feature-session-summary/src/__tests__/events.test.ts`
- Replace `summaryUpdated` tests with `summaryStart`, `summaryFinish`, `titleChanged`, `intentChanged` tests.
- Each test verifies correct `type` discriminator and flat payload.

**Step 3: Commit**

```
git commit -m "refactor(session-summary): replace summaryUpdated factory with discrete event factories"
```

---

### Task 8: Update `update-summary.ts` handler to emit discrete events

**Files:**
- Modify: `packages/feature-session-summary/src/handlers/update-summary.ts`

**Step 1: Emit `session-summary:start` at the beginning of `performAnalysis`**

At the top of `performAnalysis()`, after `const startTime = Date.now()`:
```typescript
logEvent(ctx.logger, SessionSummaryEvents.summaryStart(event.context, {
  reason,
  countdown: countdown.countdown,
}))
```

**Step 2: Replace the single `summaryUpdated` call at the bottom with discrete events**

Replace lines ~404-424 with:

```typescript
// Log summary completion
logEvent(ctx.logger, SessionSummaryEvents.summaryFinish(event.context, {
  session_title: updatedSummary.session_title,
  session_title_confidence: updatedSummary.session_title_confidence,
  latest_intent: updatedSummary.latest_intent,
  latest_intent_confidence: updatedSummary.latest_intent_confidence,
  processing_time_ms: updatedSummary.stats?.processing_time_ms ?? 0,
  pivot_detected: updatedSummary.pivot_detected ?? false,
}))

// Emit title-changed if title differs
if (currentSummary && updatedSummary.session_title !== currentSummary.session_title) {
  logEvent(ctx.logger, SessionSummaryEvents.titleChanged(event.context, {
    previousValue: currentSummary.session_title,
    newValue: updatedSummary.session_title,
    confidence: updatedSummary.session_title_confidence,
  }))
}

// Emit intent-changed if intent differs
if (currentSummary && updatedSummary.latest_intent !== currentSummary.latest_intent) {
  logEvent(ctx.logger, SessionSummaryEvents.intentChanged(event.context, {
    previousValue: currentSummary.latest_intent,
    newValue: updatedSummary.latest_intent,
    confidence: updatedSummary.latest_intent_confidence,
  }))
}
```

**Step 3: Update import**

Remove `SummaryUpdatedEvent` import (if any). The `SessionSummaryEvents` import stays.

**Step 4: Run feature tests**

Run: `pnpm --filter @sidekick/feature-session-summary test`
Expected: PASS

**Step 5: Commit**

```
git commit -m "refactor(session-summary): emit discrete start/finish/title-changed/intent-changed events"
```

---

## Phase 3: Update UI Package

### Task 9: Replace `SidekickEventType` with canonical `UIEventType` references

**Files:**
- Modify: `packages/sidekick-ui/src/types.ts`

**Step 1: Update `SidekickEventType` to use colon-separated names**

```typescript
export type SidekickEventType =
  | 'reminder:staged'
  | 'reminder:unstaged'
  | 'reminder:consumed'
  | 'decision:recorded'
  | 'session-summary:start'
  | 'session-summary:finish'
  | 'session-title:changed'
  | 'intent:changed'
  | 'snarky-message:start'
  | 'snarky-message:finish'
  | 'resume-message:start'
  | 'resume-message:finish'
  | 'persona:selected'
  | 'persona:changed'
  | 'statusline:rendered'
  | 'error:occurred'
```

**Step 2: Update `SIDEKICK_EVENT_TO_FILTER` keys**

```typescript
export const SIDEKICK_EVENT_TO_FILTER: Record<SidekickEventType, TimelineFilter> = {
  'reminder:staged': 'reminders',
  'reminder:unstaged': 'reminders',
  'reminder:consumed': 'reminders',
  'decision:recorded': 'decisions',
  'session-summary:start': 'session-analysis',
  'session-summary:finish': 'session-analysis',
  'session-title:changed': 'session-analysis',
  'intent:changed': 'session-analysis',
  'snarky-message:start': 'session-analysis',
  'snarky-message:finish': 'session-analysis',
  'resume-message:start': 'session-analysis',
  'resume-message:finish': 'session-analysis',
  'persona:selected': 'session-analysis',
  'persona:changed': 'session-analysis',
  'statusline:rendered': 'statusline',
  'error:occurred': 'errors',
}
```

**Step 3: Update `TranscriptLine` comments**

Update the comment references (e.g., `// reminder-staged` → `// reminder:staged`).

**Step 4: Commit**

```
git commit -m "refactor(ui): update SidekickEventType to colon-separated canonical names"
```

---

### Task 10: Update UI components for new event type strings

**Files:**
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx`
- Modify: `packages/sidekick-ui/src/components/timeline/Timeline.tsx`
- Modify: `packages/sidekick-ui/src/components/detail/DetailHeader.tsx`
- Modify: `packages/sidekick-ui/src/components/detail/DetailPanel.tsx`
- Modify: `packages/sidekick-ui/src/components/detail/StateTab.tsx`
- Modify: `packages/sidekick-ui/src/data/mock-data.ts`

**Step 1: Search and replace all kebab-case event strings**

In each file, replace old strings with new:
- `'reminder-staged'` → `'reminder:staged'`
- `'reminder-unstaged'` → `'reminder:unstaged'`
- `'reminder-consumed'` → `'reminder:consumed'`
- `'decision'` → `'decision:recorded'`
- `'session-summary-start'` → `'session-summary:start'`
- `'session-summary-finish'` → `'session-summary:finish'`
- `'session-title-changed'` → `'session-title:changed'`
- `'intent-changed'` → `'intent:changed'`
- `'snarky-message-start'` → `'snarky-message:start'`
- `'snarky-message-finish'` → `'snarky-message:finish'`
- `'resume-message-start'` → `'resume-message:start'`
- `'resume-message-finish'` → `'resume-message:finish'`
- `'persona-selected'` → `'persona:selected'`
- `'persona-changed'` → `'persona:changed'`
- `'statusline-rendered'` → `'statusline:rendered'`
- `'log-error'` → `'error:occurred'`

**Step 2: Run typecheck**

Run: `pnpm --filter sidekick-ui typecheck`
Expected: PASS

**Step 3: Commit**

```
git commit -m "refactor(ui): update component event type strings to canonical format"
```

---

## Phase 4: Verification

### Task 11: Full build + typecheck + test

**Step 1: Build all packages**

Run: `pnpm build`
Expected: PASS

**Step 2: Typecheck all packages**

Run: `pnpm typecheck`
Expected: PASS

**Step 3: Run all tests (excluding IPC)**

Run: `pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Run: `pnpm --filter @sidekick/types test`
Run: `pnpm --filter @sidekick/feature-reminders test`
Run: `pnpm --filter @sidekick/feature-session-summary test`
Expected: ALL PASS

**Step 4: Run lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

**Step 5: Commit any fixups**

If any fixes were needed, commit them:
```
git commit -m "fix: address build/test issues from event naming alignment"
```

---

## Summary of Changes

| Phase | Package | Files Changed | Nature |
|-------|---------|--------------|--------|
| **0 (Tests)** | `@sidekick/core` | `structured-logging.test.ts` | Add 11 missing factory tests, type guard tests, logEvent integration |
| **0 (Tests)** | `sidekick-ui` | `types.test.ts` (new) | Baseline SIDEKICK_EVENT_TO_FILTER coverage |
| **0 (Tests)** | `feature-session-summary` | `event-emission.test.ts` (new) | Handler-level event emission verification |
| **1 (Rename)** | `@sidekick/types` | `events.ts` | Rename 20 type discriminators, flatten payloads |
| **1 (Rename)** | `@sidekick/core` | `structured-logging.ts`, test | Update 17 factory methods + test assertions |
| **1 (Rename)** | `feature-reminders` | `events.ts`, test | Update 2 factory methods + test assertions |
| **1 (Rename)** | `feature-session-summary` | `events.ts`, test | Update summarySkipped factory + test |
| **2 (Split)** | `@sidekick/types` | `events.ts` | Replace `SummaryUpdatedEvent` with 4 discrete interfaces |
| **2 (Split)** | `feature-session-summary` | `events.ts`, `update-summary.ts`, test | Replace `summaryUpdated` with 4 factories, update handler emission |
| **3 (UI)** | `sidekick-ui` | `types.ts` + 6 components | Replace 16 kebab-case strings with colon format |
| **4 (Verify)** | all | — | Full build + typecheck + test + lint |
