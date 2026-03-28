# Hook Events: Capture Inputs on Start, Return Value on Finish

**Bead:** claude-code-sidekick-3pz
**Date:** 2026-03-26
**Status:** Approved

## Problem

Hook events in the timeline are not informative enough:
1. `hook:received` does not capture the inputs/arguments passed to the hook
2. `hook:completed` does not capture the return value given back to Claude Code
3. The hook name is not visible in the detail panel (falls through to a generic default)

## Goals

1. Show hook-specific input fields in the detail panel for `hook:received`
2. Show the return value (or "No response") in the detail panel for `hook:completed`
3. Show the hook name prominently in the detail panel for both event types
4. Keep log files lean — truncate large values at the CLI before writing to disk

## Non-Goals

- Capturing return values on the **failure path** in `hook.ts` (lines 379-384). That path calls `LogEvents.hookCompleted` with no `returnValue` — this is intentional. No change needed there; passing `returnValue: undefined` explicitly is not required.

## Approach: Truncate at CLI Layer

Raw hook input and return value are truncated **before** being written to the event log. This keeps `.sidekick/*.log` files lean regardless of payload size (important for PostToolUse hooks with large tool_input/tool_response).

**Truncation rules (applied to top-level values only, not nested):**
- String values > 500 chars: truncated with `…` suffix
- Object values with > 20 keys: keep first 20 keys, add `_truncated: true`
- Null/undefined values: passed through as-is

## Data Flow

```
hookInput.raw (CLI)
  → strip known system fields (see below)
  → truncate top-level values
  → HookReceivedPayload.input

mergedResponse (CLI)
  → omit entirely if Object.keys(mergedResponse).length === 0
  → truncate top-level values
  → HookCompletedPayload.returnValue
```

**Fields stripped from `hookInput.raw` (explicit allowlist exclusions):**
- `session_id`
- `transcript_path`
- `hook_event_name`

Everything else — including `cwd`, `permission_mode`, and all hook-specific fields — is retained.

```
LogEvents.hookReceived / hookCompleted (sidekick-core)
  → event log (NDJSON)
  → transcript-api server (extract to ApiTranscriptLine)
  → TranscriptLine (UI types)
  → HookDetail component (DetailPanel)
```

## File Changes

### 1. `packages/types/src/events.ts`
- `HookReceivedPayload`: add `input?: Record<string, unknown>`
- `HookCompletedPayload`: add `returnValue?: Record<string, unknown>`

### 2. `packages/sidekick-core/src/structured-logging.ts`

Updated `hookReceived` signature — `input` is added to the existing `metadata` object (consistent with how `cwd` and `mode` are already passed):

```typescript
hookReceived(
  context: EventLogContext & { hook: string },
  metadata: { cwd?: string; mode?: 'hook' | 'interactive'; input?: Record<string, unknown> }
): HookReceivedEvent
```

Updated `hookCompleted` signature — `returnValue` is added to the existing `state` object:

```typescript
hookCompleted(
  context: EventLogContext & { hook: string },
  metadata: { durationMs: number },
  state?: { reminderReturned?: boolean; responseType?: string; returnValue?: Record<string, unknown> }
): HookCompletedEvent
```

Existing tests in `structured-logging.test.ts` for these factories must be updated to cover the new fields.

### 3. `packages/sidekick-cli/src/commands/hook.ts`
- Extract a local helper `truncateForLog(raw: Record<string, unknown>): Record<string, unknown>` that applies the truncation rules above
- On `hook:received`: strip `session_id`, `transcript_path`, `hook_event_name` from `hookInput.raw`, call `truncateForLog`, pass result as `metadata.input`
- On `hook:completed` (success path only): if `Object.keys(mergedResponse).length > 0`, call `truncateForLog(mergedResponse as Record<string, unknown>)` and pass as `state.returnValue`

### 4. `packages/sidekick-ui/server/transcript-api.ts`
In the event-to-line mapper (same block as existing `hookName`/`hookDurationMs` extraction):
```typescript
if (payload.input) line.hookInput = payload.input as Record<string, unknown>
if (payload.returnValue) line.hookReturnValue = payload.returnValue as Record<string, unknown>
```

### 5. `packages/sidekick-ui/src/types.ts`
- `ApiTranscriptLine`: add `hookInput?: Record<string, unknown>`, `hookReturnValue?: Record<string, unknown>`
- `TranscriptLine`: same additions

### 6. `packages/sidekick-ui/src/components/detail/HookDetail.tsx` (new file)

`HookDetail` is **data-driven**, not type-driven. It renders sections based on what data is present on `line`, not on `line.type`:
- Hook name always shown
- "Input" section shown when `line.hookInput` is present (with key/value pairs), or "No input captured" when absent on a `hook:received` event
- "Return Value" section shown when `line.hookReturnValue` is present (with key/value pairs), or "No response" when absent on a `hook:completed` event
- Duration shown when `line.hookDurationMs` is present

The `hook:received` case will never have `hookReturnValue`; the `hook:completed` case will never have `hookInput`. No `line.type` branching needed inside the component.

### 7. `packages/sidekick-ui/src/components/detail/DetailPanel.tsx`
Add two cases delegating to `<HookDetail line={line} />`:
```typescript
case 'hook:received':
case 'hook:completed':
  return <HookDetail line={line} />
```

## HookDetail Component Layout

```
┌─────────────────────────────────┐
│ Hook Name (sky/blue label)      │
├─────────────────────────────────┤
│ Input                           │  (when hookInput present)
│   prompt   "Fix the bug in..."  │
│   cwd      "/Users/..."         │
│  — or —                         │
│   No input captured             │  (hook:received, no hookInput)
├─────────────────────────────────┤
│ Return Value                    │  (when hookReturnValue present)
│   additionalContext  "Remem..."  │
│  — or —                         │
│   No response                   │  (hook:completed, no hookReturnValue)
├─────────────────────────────────┤
│ Duration: 42ms                  │  (when hookDurationMs present)
└─────────────────────────────────┘
```

Color scheme: sky/blue (`text-sky-600`, `bg-sky-50`) matching existing hook event styling.

## Testing

- **Unit tests for `truncateForLog()`** — strings >500 chars, objects >20 keys, short values pass through, null/undefined pass through, empty object returns `{}`
- **Unit tests for transcript-api mapper** — `hookInput` and `hookReturnValue` extracted correctly; absent when not in payload
- **Update existing `structured-logging.test.ts`** — add `input` to `hookReceived` factory test, add `returnValue` to `hookCompleted` factory test
- **Update existing `hook.ts` CLI tests** — verify `input` is passed to `LogEvents.hookReceived()`, verify `returnValue` is passed on success path, verify `returnValue` absent on failure path

## Acceptance Criteria

- Build passes (`pnpm build`)
- Typecheck passes (`pnpm typecheck`)
- Tests pass (excluding IPC tests)
- Clicking a `hook:received` event shows hook name + input fields (or "No input captured")
- Clicking a `hook:completed` event shows hook name + return value fields (or "No response") + duration
