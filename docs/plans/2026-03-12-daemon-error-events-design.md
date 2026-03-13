# Daemon Error Events Design

**Bead**: claude-code-sidekick-68p
**Date**: 2026-03-12
**Status**: Approved

## Problem

Daemon-level errors (logger.error/fatal calls) are only visible in log files. The UI timeline has no structured error events to display. The IMPLEMENTATION-SPEC.md defines event #31 (`error:occurred`) for this purpose, and the types already exist in `@sidekick/types`.

## Design

### Approach: HookableLogger Integration

Rather than modifying every `logger.error()` call site (~15+), we leverage the existing `HookableLogger` wrapper that already intercepts `warn`/`error`/`fatal` log calls in the daemon.

**Single integration point**: Extend the daemon's existing log hook callback to emit `error:occurred` structured events when `error` or `fatal` level logs fire.

### Changes

1. **`structured-logging.ts`**: Add `ErrorOccurredEvent` interface and `LogEvents.errorOccurred()` factory function following the established pattern.

2. **`daemon.ts` (logger hook, ~line 194-213)**: In the existing hookable logger callback, when level is `error` or `fatal`, also call `logEvent()` with the new factory. Extract:
   - `errorMessage` from the log message string
   - `errorStack` from `meta.error?.stack` or `meta.err?.stack`
   - `source: 'daemon'`

3. **Tests**: Factory unit test + integration test verifying the hook emits events on `logger.error()`.

### What We're NOT Doing

- Modifying individual `logger.error()` call sites (hook catches them all)
- Adding granular `source` values per call site (all daemon errors get `source: 'daemon'`)
- Emitting events for `warn` level (only `error` and `fatal`)

## Types (Already Exist)

```typescript
// packages/types/src/events.ts
export interface ErrorOccurredPayload {
  errorMessage: string
  errorStack?: string
  source: string
}
```

`UIEventType` includes `'error:occurred'`, visibility is `'both'`.
