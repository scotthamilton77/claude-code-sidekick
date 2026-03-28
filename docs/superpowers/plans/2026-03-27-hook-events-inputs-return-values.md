# Hook Events: Capture Inputs on Start, Return Value on Finish

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show hook-specific input fields and return values in the Sidekick UI detail panel when clicking on `hook:received` and `hook:completed` timeline events.

**Architecture:** Extend the event payload types to carry `input` and `returnValue`, add truncation at the CLI layer before writing to disk, thread the new fields through the server mapper and UI types, then render them in a new dedicated `HookDetail` component.

**Tech Stack:** TypeScript monorepo, Vitest, React/Tailwind (UI), Pino (logging)

**Spec:** `docs/superpowers/specs/2026-03-26-hook-events-inputs-return-values-design.md`

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `packages/types/src/events.ts` | Modify | Add `input` to `HookReceivedPayload`, `returnValue` to `HookCompletedPayload` |
| `packages/sidekick-core/src/structured-logging.ts` | Modify | Update `hookReceived`/`hookCompleted` factory signatures |
| `packages/sidekick-core/src/__tests__/structured-logging.test.ts` | Modify | Add tests for new payload fields |
| `packages/sidekick-cli/src/commands/hook.ts` | Modify | Add `truncateForLog`, `STRIP_FIELDS`, `buildHookInput`; pass new fields |
| `packages/sidekick-cli/src/commands/__tests__/hook.test.ts` | Modify | Add `truncateForLog` unit tests + integration assertions |
| `packages/sidekick-ui/server/transcript-api.ts` | Modify | Add `hookInput`/`hookReturnValue` to `ApiTranscriptLine` and mapper |
| `packages/sidekick-ui/server/__tests__/transcript-api.test.ts` | Modify | Add tests for new hook field extraction |
| `packages/sidekick-ui/src/types.ts` | Modify | Add `hookInput`/`hookReturnValue` to `TranscriptLine` |
| `packages/sidekick-ui/src/components/detail/HookDetail.tsx` | **Create** | Dedicated hook detail component |
| `packages/sidekick-ui/src/components/detail/DetailPanel.tsx` | Modify | Add `hook:received`/`hook:completed` cases delegating to `HookDetail` |

---

## Task 1: Extend Payload Types in `packages/types/src/events.ts`

**Files:**
- Modify: `packages/types/src/events.ts:1011-1023`

No TDD cycle needed — these are TypeScript type declarations only.

- [ ] **Step 1: Add `input` field to `HookReceivedPayload`**

In `packages/types/src/events.ts`, find `HookReceivedPayload` (around line 1011) and update it:

```typescript
/** Payload for `hook:received` — a hook event was received by the CLI. */
export interface HookReceivedPayload {
  hook: string
  cwd?: string
  mode?: string
  /** Hook-specific input fields (system fields stripped, values truncated). */
  input?: Record<string, unknown>
}
```

- [ ] **Step 2: Add `returnValue` field to `HookCompletedPayload`**

Find `HookCompletedPayload` (around line 1018) and update it:

```typescript
/** Payload for `hook:completed` — a hook event was processed by the CLI. */
export interface HookCompletedPayload {
  hook: string
  durationMs: number
  reminderReturned?: boolean
  responseType?: string
  /** Response returned to Claude Code (omitted if empty). Values truncated. */
  returnValue?: Record<string, unknown>
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/types/src/events.ts
git commit -m "feat(types): extend hook event payloads with input and returnValue fields"
```

---

## Task 2: TDD `truncateForLog` in `packages/sidekick-cli/src/commands/hook.ts`

**Files:**
- Modify: `packages/sidekick-cli/src/commands/__tests__/hook.test.ts`
- Modify: `packages/sidekick-cli/src/commands/hook.ts`

- [ ] **Step 1: Write failing tests for `truncateForLog`**

In `packages/sidekick-cli/src/commands/__tests__/hook.test.ts`, add after existing imports:

```typescript
import { truncateForLog } from '../hook.js'
```

Then add a new `describe` block (after the existing `describe('hook command utilities')` block):

```typescript
describe('truncateForLog', () => {
  test('passes through short string values unchanged', () => {
    const result = truncateForLog({ key: 'short' })
    expect(result).toEqual({ key: 'short' })
  })

  test('truncates string values longer than 500 chars', () => {
    const longStr = 'a'.repeat(600)
    const result = truncateForLog({ key: longStr })
    expect(typeof result['key']).toBe('string')
    expect((result['key'] as string).length).toBeLessThanOrEqual(501) // 500 + '…'
    expect((result['key'] as string).endsWith('…')).toBe(true)
  })

  test('passes through string values exactly 500 chars unchanged', () => {
    const exactly500 = 'a'.repeat(500)
    const result = truncateForLog({ key: exactly500 })
    expect(result['key']).toBe(exactly500)
  })

  test('passes through non-string values unchanged', () => {
    const result = truncateForLog({ num: 42, bool: true, nil: null, undef: undefined })
    expect(result['num']).toBe(42)
    expect(result['bool']).toBe(true)
    expect(result['nil']).toBeNull()
    expect(result['undef']).toBeUndefined()
  })

  test('passes through objects with 20 or fewer keys unchanged', () => {
    const input: Record<string, unknown> = {}
    for (let i = 0; i < 20; i++) input[`k${i}`] = i
    const result = truncateForLog(input)
    expect(Object.keys(result)).toHaveLength(20)
    expect(result['_truncated']).toBeUndefined()
  })

  test('truncates objects with more than 20 keys and sets _truncated flag', () => {
    const input: Record<string, unknown> = {}
    for (let i = 0; i < 25; i++) input[`k${i}`] = i
    const result = truncateForLog(input)
    // 20 data keys + 1 _truncated flag
    expect(Object.keys(result)).toHaveLength(21)
    expect(result['_truncated']).toBe(true)
  })

  test('returns empty object unchanged', () => {
    expect(truncateForLog({})).toEqual({})
  })
})
```

Also add to the import line at the top of the test file (alongside `truncateForLog`):

```typescript
import { truncateForLog, buildHookInput } from '../hook.js'
```

And add a `describe('buildHookInput')` block immediately after:

```typescript
describe('buildHookInput', () => {
  test('strips session_id, transcript_path, and hook_event_name from raw input', () => {
    const result = buildHookInput({
      session_id: 'sess-1',
      transcript_path: '/path/file.jsonl',
      hook_event_name: 'UserPromptSubmit',
      cwd: '/project',
      prompt: 'fix the bug',
    })
    expect(result['session_id']).toBeUndefined()
    expect(result['transcript_path']).toBeUndefined()
    expect(result['hook_event_name']).toBeUndefined()
  })

  test('preserves all non-system fields', () => {
    const result = buildHookInput({
      session_id: 'sess-1',
      cwd: '/project',
      permission_mode: 'default',
      prompt: 'fix the bug',
    })
    expect(result['cwd']).toBe('/project')
    expect(result['permission_mode']).toBe('default')
    expect(result['prompt']).toBe('fix the bug')
  })

  test('returns empty object when only system fields are present', () => {
    const result = buildHookInput({
      session_id: 'sess-1',
      transcript_path: '/path/file.jsonl',
      hook_event_name: 'SessionStart',
    })
    expect(Object.keys(result)).toHaveLength(0)
  })

  test('delegates truncation to truncateForLog (long strings are truncated)', () => {
    const result = buildHookInput({
      prompt: 'a'.repeat(600),
    })
    expect((result['prompt'] as string).length).toBeLessThanOrEqual(501)
    expect((result['prompt'] as string).endsWith('…')).toBe(true)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @sidekick/sidekick-cli test -- --reporter=verbose 2>&1 | grep -A5 "truncateForLog"
```

Expected: FAIL — `truncateForLog` is not exported from hook.ts.

- [ ] **Step 3: Implement and export `truncateForLog` and `buildHookInput` in `hook.ts`**

In `packages/sidekick-cli/src/commands/hook.ts`, find the top-level constants near the start of the file (after imports, before the main functions) and add:

```typescript
/**
 * Truncate a flat record for log file storage.
 * - Strings longer than 500 chars are sliced with an ellipsis.
 * - Objects with more than 20 keys are trimmed to 20 keys with _truncated: true.
 * Only top-level values are processed; nested objects are not inspected.
 */
export function truncateForLog(raw: Record<string, unknown>): Record<string, unknown> {
  const entries = Object.entries(raw)
  const needsKeyTruncation = entries.length > 20
  const result: Record<string, unknown> = {}

  const toProcess = needsKeyTruncation ? entries.slice(0, 20) : entries
  for (const [key, value] of toProcess) {
    if (typeof value === 'string' && value.length > 500) {
      result[key] = value.slice(0, 500) + '…'
    } else {
      result[key] = value
    }
  }

  if (needsKeyTruncation) {
    result['_truncated'] = true
  }

  return result
}

/** Base hook input fields to strip before logging (internal/redundant with context). */
const STRIP_FIELDS = new Set(['session_id', 'transcript_path', 'hook_event_name'])

/**
 * Build the hook-specific input record for logging:
 * strips system base fields, then truncates large values.
 * Exported for testing.
 */
export function buildHookInput(raw: Record<string, unknown>): Record<string, unknown> {
  const filtered: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(raw)) {
    if (!STRIP_FIELDS.has(key)) {
      filtered[key] = value
    }
  }
  return truncateForLog(filtered)
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
pnpm --filter @sidekick/sidekick-cli test -- --reporter=verbose 2>&1 | grep -E "truncateForLog|PASS|FAIL"
```

Expected: all `truncateForLog` tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/hook.ts packages/sidekick-cli/src/commands/__tests__/hook.test.ts
git commit -m "feat(cli): add truncateForLog helper for hook event payloads"
```

---

## Task 3: Update `LogEvents` Factories in `structured-logging.ts`

**Files:**
- Modify: `packages/sidekick-core/src/structured-logging.ts:806-853`
- Modify: `packages/sidekick-core/src/__tests__/structured-logging.test.ts`

- [ ] **Step 1: Write failing tests for new factory fields**

In `packages/sidekick-core/src/__tests__/structured-logging.test.ts`, find the `describe('Event Logging Helpers')` block and add two new `it` blocks after the existing `hookCompleted` test (after line ~1084):

```typescript
it('should include input in HookReceived payload when provided', async () => {
  const { LogEvents } = await import('../structured-logging')

  const event = LogEvents.hookReceived(
    { sessionId: 'sess-1', hook: 'UserPromptSubmit' },
    { mode: 'hook', input: { prompt: 'fix the bug' } }
  )

  expect(event.payload.input).toEqual({ prompt: 'fix the bug' })
})

it('should include returnValue in HookCompleted payload when provided', async () => {
  const { LogEvents } = await import('../structured-logging')

  const event = LogEvents.hookCompleted(
    { sessionId: 'sess-1', hook: 'UserPromptSubmit' },
    { durationMs: 10 },
    { returnValue: { additionalContext: 'remember X' } }
  )

  expect(event.payload.returnValue).toEqual({ additionalContext: 'remember X' })
})
```

- [ ] **Step 2: Run test to verify it fails**

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts' --reporter=verbose 2>&1 | grep -E "input in HookReceived|returnValue in HookCompleted|FAIL"
```

Expected: TypeScript will error (or tests fail) because `input` and `returnValue` are not accepted yet.

- [ ] **Step 3: Update `hookReceived` factory signature and payload**

In `packages/sidekick-core/src/structured-logging.ts`, update the `hookReceived` method (lines 806-826):

```typescript
hookReceived(
  context: EventLogContext & { hook: string },
  metadata: { cwd?: string; mode?: 'hook' | 'interactive'; input?: Record<string, unknown> }
): HookReceivedEvent {
  return {
    type: 'hook:received',
    time: Date.now(),
    source: 'cli',
    context: {
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      traceId: context.traceId,
      hook: context.hook,
    },
    payload: {
      hook: context.hook,
      cwd: metadata.cwd,
      mode: metadata.mode,
      input: metadata.input,
    },
  }
},
```

- [ ] **Step 4: Update `hookCompleted` factory signature and payload**

Update the `hookCompleted` method (lines 831-853):

```typescript
hookCompleted(
  context: EventLogContext & { hook: string },
  metadata: { durationMs: number },
  state?: { reminderReturned?: boolean; responseType?: string; returnValue?: Record<string, unknown> }
): HookCompletedEvent {
  return {
    type: 'hook:completed',
    time: Date.now(),
    source: 'cli',
    context: {
      sessionId: context.sessionId,
      correlationId: context.correlationId,
      traceId: context.traceId,
      hook: context.hook,
    },
    payload: {
      hook: context.hook,
      durationMs: metadata.durationMs,
      reminderReturned: state?.reminderReturned,
      responseType: state?.responseType,
      returnValue: state?.returnValue,
    },
  }
},
```

- [ ] **Step 5: Run test to verify it passes**

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts' --reporter=verbose 2>&1 | grep -E "input in HookReceived|returnValue in HookCompleted|PASS|FAIL"
```

Expected: both new tests pass; all existing tests still pass.

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-core/src/structured-logging.ts packages/sidekick-core/src/__tests__/structured-logging.test.ts
git commit -m "feat(core): extend hookReceived/hookCompleted factories with input and returnValue"
```

---

## Task 4: Update `hook.ts` Handler to Pass Input and Return Value

**Files:**
- Modify: `packages/sidekick-cli/src/commands/hook.ts:322-419`
- Modify: `packages/sidekick-cli/src/commands/__tests__/hook.test.ts`

- [ ] **Step 1: Write failing integration tests**

In `packages/sidekick-cli/src/commands/__tests__/hook.test.ts`, find the `describe('handleHookCommand')` block and add new tests. First, add to the imports at the top:

```typescript
import { beforeEach, describe, expect, test, vi } from 'vitest'
// (already present — just verifying)
```

Then in the `describe('handleHookCommand')` block, add a new `describe` for input/returnValue.
Note: the outer `describe('handleHookCommand')` already has a `beforeEach(() => { vi.clearAllMocks() })` — no need to add another one.

```typescript
describe('hook event payload enrichment', () => {
  test('passes hook-specific input fields (excluding base fields) to hookReceived event', async () => {
    const input: ParsedHookInput = {
      sessionId: 'test-session',
      transcriptPath: '/path/transcript.jsonl',
      cwd: '/project',
      hookEventName: 'UserPromptSubmit',
      permissionMode: 'default',
      raw: {
        session_id: 'test-session',
        transcript_path: '/path/transcript.jsonl',
        hook_event_name: 'UserPromptSubmit',
        cwd: '/project',
        permission_mode: 'default',
        prompt: 'fix the bug',
      },
    }
    mockSend.mockResolvedValue({})

    const stdout = new CollectingWritable()
    await handleHookCommand('UserPromptSubmit', { ...baseOptions, hookInput: input }, mockLogger, stdout)

    // logEvent calls logger.info — find the hook:received call
    const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls
    const receivedCall = infoCalls.find((args) => args[1]?.type === 'hook:received')
    expect(receivedCall).toBeDefined()
    expect(receivedCall![1].input).toBeDefined()
    // session_id, transcript_path, hook_event_name should be stripped
    expect(receivedCall![1].input.session_id).toBeUndefined()
    expect(receivedCall![1].input.transcript_path).toBeUndefined()
    expect(receivedCall![1].input.hook_event_name).toBeUndefined()
    // hook-specific fields should remain
    expect(receivedCall![1].input.prompt).toBe('fix the bug')
    expect(receivedCall![1].input.cwd).toBe('/project')
  })

  test('passes mergedResponse as returnValue on successful hook:completed', async () => {
    mockSend.mockResolvedValue({ additionalContext: 'remember to do X' })

    const stdout = new CollectingWritable()
    await handleHookCommand('UserPromptSubmit', baseOptions, mockLogger, stdout)

    const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls
    const completedCall = infoCalls.find((args) => args[1]?.type === 'hook:completed')
    expect(completedCall).toBeDefined()
    expect(completedCall![1].returnValue).toBeDefined()
    expect(completedCall![1].returnValue.additionalContext).toBe('remember to do X')
  })

  test('omits returnValue on hook:completed when response is empty', async () => {
    mockSend.mockResolvedValue({})

    const stdout = new CollectingWritable()
    await handleHookCommand('UserPromptSubmit', baseOptions, mockLogger, stdout)

    const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls
    const completedCall = infoCalls.find((args) => args[1]?.type === 'hook:completed')
    expect(completedCall).toBeDefined()
    expect(completedCall![1].returnValue).toBeUndefined()
  })

  test('does not pass returnValue on the failure path (IPC error)', async () => {
    mockSend.mockRejectedValue(new Error('IPC timeout'))

    const stdout = new CollectingWritable()
    await handleHookCommand('UserPromptSubmit', baseOptions, mockLogger, stdout)

    const infoCalls = (mockLogger.info as ReturnType<typeof vi.fn>).mock.calls
    const completedCall = infoCalls.find((args) => args[1]?.type === 'hook:completed')
    expect(completedCall).toBeDefined()
    expect(completedCall![1].returnValue).toBeUndefined()
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @sidekick/sidekick-cli test -- --reporter=verbose 2>&1 | grep -E "hook event payload|FAIL|passes hook-specific"
```

Expected: tests fail because `input` and `returnValue` are not yet passed.

- [ ] **Step 3: Update the `hookReceived` call (line ~337) to pass `input`**

Find:
```typescript
logEvent(logger, LogEvents.hookReceived(logContext, { cwd: hookInput.cwd, mode: 'hook' }))
```

Replace with:
```typescript
logEvent(logger, LogEvents.hookReceived(logContext, {
  cwd: hookInput.cwd,
  mode: 'hook',
  input: buildHookInput(hookInput.raw),
}))
```

- [ ] **Step 4: Update the success-path `hookCompleted` call (lines ~409-416) to pass `returnValue`**

Find:
```typescript
logEvent(
  logger,
  LogEvents.hookCompleted(
    logContext,
    { durationMs: Date.now() - startTime },
    { reminderReturned: !!mergedResponse.additionalContext }
  )
)
```

Replace with:
```typescript
const returnValue = Object.keys(mergedResponse).length > 0
  ? truncateForLog(mergedResponse as Record<string, unknown>)
  : undefined

logEvent(
  logger,
  LogEvents.hookCompleted(
    logContext,
    { durationMs: Date.now() - startTime },
    { reminderReturned: !!mergedResponse.additionalContext, returnValue }
  )
)
```

- [ ] **Step 5: Run tests to verify they pass**

```bash
pnpm --filter @sidekick/sidekick-cli test -- --reporter=verbose 2>&1 | grep -E "hook event payload|truncateForLog|buildHookInput|PASS|FAIL" | head -30
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-cli/src/commands/hook.ts packages/sidekick-cli/src/commands/__tests__/hook.test.ts
git commit -m "feat(cli): capture hook input and return value in hook events"
```

---

## Task 5: Update `transcript-api.ts` Mapper and Tests

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts:65-68, 419-421`
- Modify: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts`

- [ ] **Step 0: Add `hookInput`/`hookReturnValue` to `ApiTranscriptLine` interface**

In `packages/sidekick-ui/server/transcript-api.ts`, find the `ApiTranscriptLine` interface (around line 65) and add after `hookDurationMs`:

```typescript
  // Hook event fields
  hookName?: string
  hookDurationMs?: number
  hookInput?: Record<string, unknown>
  hookReturnValue?: Record<string, unknown>
```

- [ ] **Step 1: Write failing tests**

In `packages/sidekick-ui/server/__tests__/transcript-api.test.ts`, find the section with `describe` blocks for interleaving/mapping tests (around line 714, near the `decision:recorded` tests). Add new tests:

```typescript
it('maps hook:received with input to hookInput', async () => {
  setupTranscript(makeUserEntry('Hello'))

  mockFindLogFiles.mockImplementation((dir: string, prefix: string) => {
    if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
    return Promise.resolve([])
  })
  mockReadLogFile.mockResolvedValue([
    {
      time: new Date('2025-01-15T10:30:01.000Z').getTime(),
      type: 'hook:received',
      context: { sessionId: 'session-1', hook: 'UserPromptSubmit' },
      payload: {
        hook: 'UserPromptSubmit',
        cwd: '/project',
        mode: 'hook',
        input: { prompt: 'fix the bug', cwd: '/project' },
      },
    },
  ])

  const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
  const hookLine = lines.find((l) => l.type === 'hook:received')
  expect(hookLine).toBeDefined()
  expect(hookLine!.hookName).toBe('UserPromptSubmit')
  expect(hookLine!.hookInput).toEqual({ prompt: 'fix the bug', cwd: '/project' })
  expect(hookLine!.hookReturnValue).toBeUndefined()
})

it('maps hook:completed with returnValue to hookReturnValue', async () => {
  setupTranscript(makeUserEntry('Hello'))

  mockFindLogFiles.mockImplementation((dir: string, prefix: string) => {
    if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
    return Promise.resolve([])
  })
  mockReadLogFile.mockResolvedValue([
    {
      time: new Date('2025-01-15T10:30:01.000Z').getTime(),
      type: 'hook:completed',
      context: { sessionId: 'session-1', hook: 'UserPromptSubmit' },
      payload: {
        hook: 'UserPromptSubmit',
        durationMs: 42,
        returnValue: { additionalContext: 'remember X' },
      },
    },
  ])

  const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
  const hookLine = lines.find((l) => l.type === 'hook:completed')
  expect(hookLine).toBeDefined()
  expect(hookLine!.hookDurationMs).toBe(42)
  expect(hookLine!.hookReturnValue).toEqual({ additionalContext: 'remember X' })
  expect(hookLine!.hookInput).toBeUndefined()
})

it('maps hook:completed without returnValue to undefined hookReturnValue', async () => {
  setupTranscript(makeUserEntry('Hello'))

  mockFindLogFiles.mockImplementation((dir: string, prefix: string) => {
    if (prefix === 'sidekick.') return Promise.resolve(['/fake/logs/sidekick.1.log'])
    return Promise.resolve([])
  })
  mockReadLogFile.mockResolvedValue([
    {
      time: new Date('2025-01-15T10:30:01.000Z').getTime(),
      type: 'hook:completed',
      context: { sessionId: 'session-1', hook: 'Stop' },
      payload: { hook: 'Stop', durationMs: 5 },
    },
  ])

  const lines = await parseTranscriptLines('myproject', 'session-1', '/fake/project')
  const hookLine = lines.find((l) => l.type === 'hook:completed')
  expect(hookLine).toBeDefined()
  expect(hookLine!.hookReturnValue).toBeUndefined()
})
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
pnpm --filter @sidekick/sidekick-ui test -- --reporter=verbose 2>&1 | grep -E "maps hook:|hookInput|hookReturnValue|FAIL"
```

Expected: tests fail — `hookInput` and `hookReturnValue` are not yet extracted.

- [ ] **Step 3: Update the mapper in `transcript-api.ts`**

Find the hook events block (around line 419-421):

```typescript
  // Hook events
  if (payload.hook) line.hookName = payload.hook as string
  if (payload.durationMs != null && entry.type === 'hook:completed') line.hookDurationMs = payload.durationMs as number
```

Replace with:

```typescript
  // Hook events
  if (payload.hook) line.hookName = payload.hook as string
  if (payload.durationMs != null && entry.type === 'hook:completed') line.hookDurationMs = payload.durationMs as number
  if (payload.input) line.hookInput = payload.input as Record<string, unknown>
  if (payload.returnValue) line.hookReturnValue = payload.returnValue as Record<string, unknown>
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
pnpm --filter @sidekick/sidekick-ui test -- --reporter=verbose 2>&1 | grep -E "maps hook:|PASS|FAIL"
```

Expected: all three new tests pass; all existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-ui/server/transcript-api.ts packages/sidekick-ui/server/__tests__/transcript-api.test.ts
git commit -m "feat(ui-server): extract hookInput and hookReturnValue from hook event payloads"
```

---

## Task 6: Create `HookDetail` Component and Update `DetailPanel`

**Files:**
- Modify: `packages/sidekick-ui/src/types.ts:109-111`
- Create: `packages/sidekick-ui/src/components/detail/HookDetail.tsx`
- Modify: `packages/sidekick-ui/src/components/detail/DetailPanel.tsx:1-9, 63-80`

No tests needed — consistent with other detail components in the codebase.

- [ ] **Step 0: Add `hookInput`/`hookReturnValue` to `TranscriptLine` in `packages/sidekick-ui/src/types.ts`**

Find the hook fields block (around line 109) and add after `hookDurationMs`:

```typescript
  // hook:received / hook:completed
  hookName?: string
  hookDurationMs?: number
  hookInput?: Record<string, unknown>
  hookReturnValue?: Record<string, unknown>
```

- [ ] **Step 1: Create `HookDetail.tsx`**

Create `packages/sidekick-ui/src/components/detail/HookDetail.tsx`:

```tsx
import type { TranscriptLine } from '../../types'

interface HookDetailProps {
  line: TranscriptLine
}

function KeyValueRows({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex gap-2 min-w-0">
          <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 shrink-0">{key}</span>
          <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 break-all">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function HookDetail({ line }: HookDetailProps) {
  return (
    <div className="p-3 space-y-3">
      <div>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
          {line.hookName ?? 'unknown'}
        </span>
      </div>

      {line.hookInput != null ? (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Input</h3>
          <KeyValueRows data={line.hookInput} />
        </div>
      ) : line.type === 'hook:received' ? (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Input</h3>
          <p className="text-[10px] text-slate-400 italic">No input captured</p>
        </div>
      ) : null}

      {line.hookReturnValue != null ? (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Return Value</h3>
          <KeyValueRows data={line.hookReturnValue} />
        </div>
      ) : line.type === 'hook:completed' ? (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Return Value</h3>
          <p className="text-[10px] text-slate-400 italic">No response</p>
        </div>
      ) : null}

      {line.hookDurationMs != null && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Duration</h3>
          <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">{line.hookDurationMs}ms</span>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update `DetailPanel.tsx` — add import**

In `packages/sidekick-ui/src/components/detail/DetailPanel.tsx`, add `HookDetail` to the imports (after the existing detail component imports):

```typescript
import { HookDetail } from './HookDetail'
```

- [ ] **Step 3: Update `DetailPanel.tsx` — add cases to `DetailContent`**

In the `DetailContent` switch statement, add before the `default:` case:

```typescript
    case 'hook:received':
    case 'hook:completed':
      return <HookDetail line={line} />
```

- [ ] **Step 4: Verify the UI builds without errors**

```bash
pnpm --filter @sidekick/sidekick-ui build 2>&1 | tail -20
```

Expected: clean build, no TypeScript errors.

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-ui/src/types.ts packages/sidekick-ui/src/components/detail/HookDetail.tsx packages/sidekick-ui/src/components/detail/DetailPanel.tsx
git commit -m "feat(ui): add HookDetail component and wire hook events in DetailPanel"
```

---

## Task 7: Full Verification

- [ ] **Step 1: Run full build**

```bash
pnpm build 2>&1 | tail -20
```

Expected: clean build across all packages.

- [ ] **Step 2: Run typecheck**

```bash
pnpm typecheck 2>&1 | tail -20
```

Expected: no type errors.

- [ ] **Step 3: Run relevant tests**

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
pnpm --filter @sidekick/sidekick-cli test
pnpm --filter @sidekick/sidekick-ui test
```

Expected: all tests pass.

- [ ] **Step 4: Run lint**

```bash
pnpm lint 2>&1 | tail -20
```

Expected: no lint errors.

- [ ] **Step 5: Push and open PR**

```bash
git push -u origin feat/hook-events-inputs-return-values
gh pr create --title "feat: capture hook inputs and return values in timeline detail panel" --body "Implements bead claude-code-sidekick-3pz.

## Changes
- Extends \`HookReceivedPayload\` and \`HookCompletedPayload\` with \`input\`/\`returnValue\` fields
- Adds \`truncateForLog\` helper (strings >500 chars, objects >20 keys truncated at CLI layer)
- Strips internal system fields (\`session_id\`, \`transcript_path\`, \`hook_event_name\`) from hook input
- Threads new fields through server mapper and UI types
- Adds \`HookDetail\` component showing hook name, input fields, return value, and duration
- Hook events in detail panel now show \"No input captured\" / \"No response\" instead of generic type label

## Test plan
- [ ] \`pnpm --filter @sidekick/core test\` passes
- [ ] \`pnpm --filter @sidekick/sidekick-cli test\` passes
- [ ] \`pnpm --filter @sidekick/sidekick-ui test\` passes
- [ ] \`pnpm build && pnpm typecheck && pnpm lint\` clean
- [ ] Click a hook:received event in UI → see hook name + input fields
- [ ] Click a hook:completed event in UI → see hook name + return value + duration"
```
