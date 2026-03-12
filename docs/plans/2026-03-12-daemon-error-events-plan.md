# Daemon Error Events Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Emit structured `error:occurred` events from the daemon via the HookableLogger so the UI timeline can display daemon errors.

**Architecture:** Leverage the existing `HookableLogger` hook in `daemon.ts` (which already intercepts `error`/`fatal` logs for counting) to additionally emit `error:occurred` structured events via `logEvent()`. This requires adding the event type to `@sidekick/types`, a factory to `LogEvents`, and wiring the hook. No individual call-site changes needed.

**Tech Stack:** TypeScript, Vitest, Pino (via HookableLogger wrapper)

---

### Task 1: Add `ErrorOccurredEvent` interface to `@sidekick/types`

**Files:**
- Modify: `packages/types/src/events.ts:609-655` (add interface + update unions)

**Step 1: Write the interface**

After line 612 (after `PreCompactCapturedEvent`), add:

```typescript
/**
 * Error occurred in daemon or CLI.
 * Emitted automatically by HookableLogger on error/fatal log calls.
 *
 * @see docs/plans/2026-03-12-daemon-error-events-design.md
 */
export interface ErrorOccurredEvent extends LoggingEventBase<ErrorOccurredPayload> {
  type: 'error:occurred'
  source: 'daemon' | 'cli'
}
```

**Step 2: Add to `DaemonLoggingEvent` union**

In the `DaemonLoggingEvent` type (~line 627-644), add `| ErrorOccurredEvent` after `RemindersClearedEvent`.

**Step 3: Verify typecheck passes**

Run: `pnpm --filter @sidekick/types typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/types/src/events.ts
git commit -m "feat(types): add ErrorOccurredEvent interface for error:occurred"
```

---

### Task 2: Add `LogEvents.errorOccurred()` factory to structured-logging

**Files:**
- Modify: `packages/sidekick-core/src/structured-logging.ts:757-779` (add import) and `~1264` (add factory before closing brace)

**Step 1: Add import**

In the import block at line 757-779, add `ErrorOccurredEvent` to the imports from `@sidekick/types`.

**Step 2: Add factory function**

Before the closing `}` of `LogEvents` (line 1265), add:

```typescript
  // --- Error Events ---

  /**
   * Create an ErrorOccurred event (logged when error/fatal level log is emitted).
   * Emitted automatically by HookableLogger hook — no manual call-site changes needed.
   *
   * @see docs/plans/2026-03-12-daemon-error-events-design.md
   */
  errorOccurred(
    context: EventLogContext,
    state: {
      errorMessage: string
      errorStack?: string
      source: 'daemon' | 'cli'
    }
  ): ErrorOccurredEvent {
    return {
      type: 'error:occurred',
      time: Date.now(),
      source: state.source,
      context: {
        sessionId: context.sessionId,
        correlationId: context.correlationId,
        traceId: context.traceId,
        hook: context.hook,
        taskId: context.taskId,
      },
      payload: {
        errorMessage: state.errorMessage,
        errorStack: state.errorStack,
        source: state.source,
      },
    }
  },
```

**Step 3: Verify typecheck passes**

Run: `pnpm --filter @sidekick/core typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/sidekick-core/src/structured-logging.ts
git commit -m "feat(core): add LogEvents.errorOccurred() factory function"
```

---

### Task 3: Write failing test for the factory function

**Files:**
- Create: `packages/sidekick-core/src/__tests__/log-events-error.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { LogEvents, logEvent } from '../structured-logging'
import type { Logger } from '@sidekick/types'

describe('LogEvents.errorOccurred', () => {
  const context = {
    sessionId: 'test-session-123',
    correlationId: 'corr-456',
    traceId: 'trace-789',
    hook: undefined,
    taskId: undefined,
  }

  it('creates event with required fields', () => {
    const event = LogEvents.errorOccurred(context, {
      errorMessage: 'Something broke',
      source: 'daemon',
    })

    expect(event.type).toBe('error:occurred')
    expect(event.source).toBe('daemon')
    expect(event.time).toBeGreaterThan(0)
    expect(event.context.sessionId).toBe('test-session-123')
    expect(event.payload.errorMessage).toBe('Something broke')
    expect(event.payload.errorStack).toBeUndefined()
    expect(event.payload.source).toBe('daemon')
  })

  it('includes optional errorStack', () => {
    const event = LogEvents.errorOccurred(context, {
      errorMessage: 'Kaboom',
      errorStack: 'Error: Kaboom\n    at foo.ts:42',
      source: 'daemon',
    })

    expect(event.payload.errorStack).toBe('Error: Kaboom\n    at foo.ts:42')
  })

  it('works with logEvent helper', () => {
    const mockLogger: Logger = {
      trace: vi.fn() as any,
      debug: vi.fn() as any,
      info: vi.fn() as any,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      child: vi.fn() as any,
      flush: vi.fn() as any,
    }

    const event = LogEvents.errorOccurred(context, {
      errorMessage: 'Test error',
      source: 'daemon',
    })
    logEvent(mockLogger, event)

    expect(mockLogger.info).toHaveBeenCalledWith(
      'error:occurred',
      expect.objectContaining({
        type: 'error:occurred',
        source: 'daemon',
        errorMessage: 'Test error',
      })
    )
  })
})
```

**Step 2: Run the test**

Run: `pnpm --filter @sidekick/core test -- --run src/__tests__/log-events-error.test.ts`
Expected: PASS (factory already implemented in Task 2)

**Step 3: Commit**

```bash
git add packages/sidekick-core/src/__tests__/log-events-error.test.ts
git commit -m "test(core): add tests for LogEvents.errorOccurred factory"
```

---

### Task 4: Wire HookableLogger hook to emit error events

**Files:**
- Modify: `packages/sidekick-daemon/src/daemon.ts:1-10` (add imports) and `~196-212` (extend hook)

**Step 1: Add imports**

Add to existing imports from `@sidekick/core`:

```typescript
import { LogEvents, logEvent } from '@sidekick/core'
```

**Step 2: Extend the existing hook**

The current hook at lines 196-212 counts errors. Extend it to also emit structured events. The hook receives `(level, msg, meta)`. For `error` and `fatal` levels, additionally call `logEvent()`.

Replace the hook body (lines 196-212) with:

```typescript
      hook: (level, msg, meta) => {
        // Extract sessionId from log metadata context
        const sessionId =
          (meta?.context as { sessionId?: string })?.sessionId ?? (meta as { sessionId?: string })?.sessionId

        if (sessionId) {
          // Session-specific counter
          const counters = this.logCounters.get(sessionId)
          if (counters) {
            if (level === 'warn') counters.warnings++
            else counters.errors++ // error and fatal
          }
        } else {
          // Global counter for daemon-level logs without session context
          if (level === 'warn') this.globalLogCounters.warnings++
          else this.globalLogCounters.errors++ // error and fatal
        }

        // Emit structured error event for UI timeline (error and fatal only, not warn)
        if (level === 'error' || level === 'fatal') {
          const errorObj = (meta?.error ?? meta?.err) as { message?: string; stack?: string } | undefined
          const errorMessage = errorObj?.message ?? msg
          const errorStack = errorObj?.stack

          logEvent(this.logManager.getLogger(), LogEvents.errorOccurred(
            {
              sessionId: sessionId ?? 'daemon',
              correlationId: (meta?.context as { correlationId?: string })?.correlationId,
              traceId: (meta?.context as { traceId?: string })?.traceId,
              hook: undefined,
              taskId: undefined,
            },
            {
              errorMessage,
              errorStack,
              source: 'daemon',
            }
          ))
        }
      },
```

**Important:** We call `logEvent()` on `this.logManager.getLogger()` (the *base* logger, NOT `this.logger`) to avoid infinite recursion — `this.logger` is the hookable wrapper that would re-trigger the hook.

**Step 3: Verify typecheck passes**

Run: `pnpm --filter @sidekick/daemon typecheck`
Expected: PASS

**Step 4: Commit**

```bash
git add packages/sidekick-daemon/src/daemon.ts
git commit -m "feat(daemon): emit error:occurred events via HookableLogger hook"
```

---

### Task 5: Write integration test for hook-based error emission

**Files:**
- Create: `packages/sidekick-daemon/src/__tests__/error-event-emission.test.ts`

**Step 1: Write the test**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHookableLogger } from '@sidekick/core'
import type { Logger } from '@sidekick/types'

describe('HookableLogger error event emission', () => {
  let baseLogger: Logger
  let hookCalls: Array<{ level: string; msg: string; meta?: Record<string, unknown> }>

  beforeEach(() => {
    hookCalls = []
    baseLogger = {
      trace: vi.fn() as any,
      debug: vi.fn() as any,
      info: vi.fn() as any,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      child: vi.fn(() => baseLogger) as any,
      flush: vi.fn() as any,
    }
  })

  it('hook fires for error level logs', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.error('Something failed', { error: new Error('boom') })

    expect(hookCalls).toHaveLength(1)
    expect(hookCalls[0].level).toBe('error')
    expect(hookCalls[0].msg).toBe('Something failed')
  })

  it('hook fires for fatal level logs', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.fatal('Critical failure', { error: new Error('catastrophe') })

    expect(hookCalls).toHaveLength(1)
    expect(hookCalls[0].level).toBe('fatal')
  })

  it('hook does not fire for warn level when only error/fatal configured', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error', 'fatal'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    logger.warn('Just a warning')

    expect(hookCalls).toHaveLength(0)
  })

  it('meta includes error object for stack extraction', () => {
    const logger = createHookableLogger(baseLogger, {
      levels: ['error'],
      hook: (level, msg, meta) => {
        hookCalls.push({ level, msg, meta })
      },
    })

    const err = new Error('test error')
    logger.error('Operation failed', { error: err, context: { sessionId: 'sess-1' } })

    expect(hookCalls[0].meta).toEqual(
      expect.objectContaining({
        error: err,
        context: expect.objectContaining({ sessionId: 'sess-1' }),
      })
    )
  })
})
```

**Step 2: Run the test**

Run: `pnpm --filter @sidekick/daemon test -- --run src/__tests__/error-event-emission.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add packages/sidekick-daemon/src/__tests__/error-event-emission.test.ts
git commit -m "test(daemon): add integration tests for error event emission via hook"
```

---

### Task 6: Build, typecheck, lint verification

**Step 1: Full build**

Run: `pnpm build && pnpm typecheck && pnpm lint`
Expected: PASS

**Step 2: Run affected tests**

Run: `pnpm --filter @sidekick/core test -- --run && pnpm --filter @sidekick/daemon test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Expected: PASS

**Step 3: Final commit if any fixes needed**

If lint/typecheck required changes, commit them:
```bash
git add -A
git commit -m "fix: address lint/typecheck issues from error event implementation"
```
