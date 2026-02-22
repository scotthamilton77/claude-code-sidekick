# Log Rotation Design

**Date**: 2026-02-22
**Bead**: sidekick-z63.4
**Status**: Approved

## Problem

Log files grow unbounded. `sidekick.log` and `sidekickd.log` are written continuously with no rotation, cleanup, or size cap. In production this will fill disk space over time.

## Solution

Wire up `pino-roll` (already installed, v4.0.0) to replace the synchronous `appendFileSync` Writable in the file stream creation. Add rotation config to `LoggingSchema` with defaults of 10MB / 5 files (per existing design doc).

## Design

### 1. Config Schema (`packages/sidekick-core/src/config.ts`)

Add `rotation` sub-object to `LoggingSchema`:

```typescript
rotation: z.object({
  maxSizeBytes: z.number().min(1),
  maxFiles: z.number().min(1),
}).optional()
```

### 2. Defaults (`assets/sidekick/defaults/core.defaults.yaml`)

```yaml
logging:
  rotation:
    maxSizeBytes: 10485760  # 10MB
    maxFiles: 5
```

### 3. `structured-logging.ts` — New async helper

Add `buildRotatingFileStream()` exported from `structured-logging.ts`:

```typescript
export async function buildRotatingFileStream(
  path: string,
  opts: { maxSizeBytes?: number; maxFiles?: number }
): Promise<Writable>
```

Uses `pino-roll` with:
- `file`: log path (pino-roll appends `.1`, `.2`, etc. on rotation)
- `size`: converted from bytes to MB string (`'10m'`)
- `limit.count`: maxFiles
- `mkdir: true`: auto-create log directory

`pino-roll` returns a `SonicBoom` instance (extends `Writable`).

### 4. `createLogManager` changes

`LogManagerOptions.destinations.file` gains optional `stream?: Writable`:

```typescript
file?: {
  path: string
  rotateSize?: number   // kept for backward compat / testability
  maxFiles?: number     // kept for backward compat / testability
  stream?: Writable     // when provided, used directly (skips appendFileSync)
}
```

When `stream` is present, use it. When absent, fall back to existing `appendFileSync` Writable (no rotation, backward compatible).

### 5. `createContextLogger` changes

`ContextLoggerOptions` gains optional `stream?: Writable`:

```typescript
stream?: Writable  // when provided with logsDir, used instead of appendFileSync
```

### 6. Call Sites

Both call sites that want rotation must build the stream before calling in:

**`packages/sidekick-cli/src/runtime.ts`** (facade upgrade):
```typescript
const rotatingStream = await buildRotatingFileStream(logPath, {
  maxSizeBytes: config.core.logging.rotation?.maxSizeBytes,
  maxFiles: config.core.logging.rotation?.maxFiles,
})
facade.upgrade({
  destinations: { file: { path: logPath, stream: rotatingStream } }
})
```

**`packages/sidekick-daemon/src/daemon.ts`** (createContextLogger):
```typescript
const rotatingStream = await buildRotatingFileStream(logPath, { ... })
const logger = createContextLogger({ ..., stream: rotatingStream })
```

## File Naming

pino-roll appends a counter to the base filename:
- Active: `sidekick.log` → `sidekick.log.1`
- Rotated: `sidekick.log.2`, `sidekick.log.3`, etc.

## Testing

- Unit tests for `buildRotatingFileStream` using a temp directory
- Existing `createLogManager` / `createContextLogger` tests unaffected (use `testStream` bypass)
- Verify rotation at small size threshold in test

## Non-Goals

- Time-based rotation (not needed per design doc)
- Compressing rotated files
- Exposing rotation config to users via CLI flags
