# Plan: Hookable Logger for Log Metrics

## Summary

Refactor the log counting implementation to use a reusable hookable logger pattern. This fixes two issues:
1. **Concurrent sessions**: `currentActiveSessionId` doesn't work with multiple concurrent Claude sessions
2. **Reusability**: Both Daemon and CLI need to count logs; statusline should combine both

## Requirements

- **Hookable Logger**: Create a logger wrapper with level-filtered callbacks
- **Session-aware**: Extract sessionId from log metadata (not global state)
- **Dual-source metrics**: Daemon → `daemon-log-metrics.json`, CLI → `cli-log-metrics.json`
- **Combined display**: StatuslineService reads and sums both files

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        @sidekick/core                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ createHookableLogger(baseLogger, options)               │   │
│  │   - Wraps any Logger                                    │   │
│  │   - Calls hook(level, msg, meta) for configured levels  │   │
│  │   - Hook receives full metadata including sessionId     │   │
│  └─────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                    │                           │
         ┌──────────┴──────────┐     ┌──────────┴──────────┐
         │       Daemon        │     │        CLI          │
         │                     │     │                     │
         │ Hook: count per     │     │ Hook: count per     │
         │ sessionId from meta │     │ sessionId from ctx  │
         │                     │     │                     │
         │ Persists to:        │     │ Persists to:        │
         │ daemon-log-         │     │ cli-log-            │
         │ metrics.json        │     │ metrics.json        │
         └──────────┬──────────┘     └──────────┬──────────┘
                    │                           │
                    └───────────┬───────────────┘
                                │
                    ┌───────────▼───────────┐
                    │   StatuslineService   │
                    │                       │
                    │ Reads both files,     │
                    │ sums counts           │
                    └───────────────────────┘
```

## Implementation Steps

### Phase 1: Create Hookable Logger in @sidekick/core

**File**: `packages/sidekick-core/src/hookable-logger.ts`

```typescript
import type { Logger, LogLevel } from '@sidekick/types'

export interface LogHook {
  /** Callback invoked when a log at a matching level is emitted */
  (level: LogLevel, msg: string, meta?: Record<string, unknown>): void
}

export interface HookableLoggerOptions {
  /** Levels to trigger the hook (default: all levels) */
  levels?: LogLevel[]
  /** Callback invoked for matching log levels */
  hook: LogHook
}

/**
 * Wrap a logger to add hooks for specific log levels.
 * Hooks receive the full metadata including sessionId from context.
 */
export function createHookableLogger(
  baseLogger: Logger,
  options: HookableLoggerOptions
): Logger {
  const { levels, hook } = options
  const allLevels: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal']
  const targetLevels = new Set(levels ?? allLevels)

  const maybeHook = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (targetLevels.has(level)) {
      hook(level, msg, meta)
    }
  }

  return {
    trace: (msg, meta) => { maybeHook('trace', msg, meta); baseLogger.trace(msg, meta) },
    debug: (msg, meta) => { maybeHook('debug', msg, meta); baseLogger.debug(msg, meta) },
    info: (msg, meta) => { maybeHook('info', msg, meta); baseLogger.info(msg, meta) },
    warn: (msg, meta) => { maybeHook('warn', msg, meta); baseLogger.warn(msg, meta) },
    error: (msg, meta) => { maybeHook('error', msg, meta); baseLogger.error(msg, meta) },
    fatal: (msg, meta) => { maybeHook('fatal', msg, meta); baseLogger.fatal(msg, meta) },
    child: (bindings) => createHookableLogger(baseLogger.child(bindings), options),
    flush: () => baseLogger.flush(),
  }
}
```

Export from `packages/sidekick-core/src/index.ts`.

### Phase 2: Update Daemon to Use Hookable Logger

**File**: `packages/sidekickd/src/daemon.ts`

Remove:
- `private currentActiveSessionId: string | null = null`
- `private wrapLoggerWithCounting()` method

Replace with:

```typescript
import { createHookableLogger } from '@sidekick/core'

// In constructor:
const baseLogger = this.logManager.getLogger()
this.logger = createHookableLogger(baseLogger, {
  levels: ['warn', 'error', 'fatal'],
  hook: (level, _msg, meta) => {
    // Extract sessionId from log metadata context
    const sessionId = (meta?.context as { sessionId?: string })?.sessionId
                   ?? (meta as { sessionId?: string })?.sessionId
    if (sessionId) {
      const counters = this.logCounters.get(sessionId)
      if (counters) {
        if (level === 'warn') counters.warnings++
        else counters.errors++  // error and fatal
      }
    }
  }
})
```

Update `persistLogMetrics()` to write to `daemon-log-metrics.json` (rename from `log-metrics.json`).

### Phase 3: Add Log Counting to CLI

**File**: `packages/sidekick-cli/src/runtime.ts`

Add log counters and hookable logger:

```typescript
import { createHookableLogger } from '@sidekick/core'

// In RuntimeShell:
let logCounters: { warnings: number; errors: number } = { warnings: 0, errors: 0 }

// After creating logger:
const countingLogger = createHookableLogger(baseLogger, {
  levels: ['warn', 'error', 'fatal'],
  hook: (level) => {
    if (level === 'warn') logCounters.warnings++
    else logCounters.errors++
  }
})

// Add to RuntimeShell interface and return:
getLogCounts: () => ({ ...logCounters }),
resetLogCounts: () => { logCounters = { warnings: 0, errors: 0 } },
```

**File**: `packages/sidekick-cli/src/cli.ts`

Persist CLI log metrics on exit:

```typescript
// Before process exit or at hook completion:
async function persistCliLogMetrics(sessionId: string, counts: { warnings: number; errors: number }) {
  const stateDir = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
  await fs.mkdir(stateDir, { recursive: true })
  await fs.writeFile(
    path.join(stateDir, 'cli-log-metrics.json'),
    JSON.stringify({
      sessionId,
      warningCount: counts.warnings,
      errorCount: counts.errors,
      lastUpdatedAt: Date.now(),
    }, null, 2)
  )
}
```

### Phase 4: Update StateReader to Read Both Files

**File**: `packages/feature-statusline/src/state-reader.ts`

Update `getLogMetrics()` to read and sum both files:

```typescript
async getLogMetrics(): Promise<StateReadResult<LogMetricsState>> {
  const daemonPath = path.join(this.stateDir, 'daemon-log-metrics.json')
  const cliPath = path.join(this.stateDir, 'cli-log-metrics.json')

  const [daemonResult, cliResult] = await Promise.all([
    this.readLogMetricsFile(daemonPath),
    this.readLogMetricsFile(cliPath),
  ])

  // Sum counts from both sources
  const combined: LogMetricsState = {
    sessionId: daemonResult.data.sessionId || cliResult.data.sessionId || '',
    warningCount: daemonResult.data.warningCount + cliResult.data.warningCount,
    errorCount: daemonResult.data.errorCount + cliResult.data.errorCount,
    lastUpdatedAt: Math.max(daemonResult.data.lastUpdatedAt, cliResult.data.lastUpdatedAt),
  }

  const isStale = daemonResult.source === 'stale' || cliResult.source === 'stale'
  return {
    source: isStale ? 'stale' : (daemonResult.source === 'default' && cliResult.source === 'default' ? 'default' : 'fresh'),
    data: combined,
    mtime: combined.lastUpdatedAt,
  }
}

private async readLogMetricsFile(filePath: string): Promise<StateReadResult<LogMetricsState>> {
  // ... existing single-file read logic
}
```

### Phase 5: Update Daemon Persistence Path

**File**: `packages/sidekickd/src/daemon.ts`

In `persistLogMetrics()`:
```diff
- const logMetricsPath = path.join(stateDir, 'log-metrics.json')
+ const logMetricsPath = path.join(stateDir, 'daemon-log-metrics.json')
```

## Files to Modify

| File | Changes |
|------|---------|
| `packages/sidekick-core/src/hookable-logger.ts` | **NEW** - Hookable logger wrapper |
| `packages/sidekick-core/src/index.ts` | Export `createHookableLogger` |
| `packages/sidekickd/src/daemon.ts` | Use hookable logger, remove old wrapper, update file path |
| `packages/sidekick-cli/src/runtime.ts` | Add log counting via hookable logger |
| `packages/sidekick-cli/src/cli.ts` | Persist CLI log metrics on exit |
| `packages/feature-statusline/src/state-reader.ts` | Read and sum both metric files |

## Testing

1. **Unit test hookable-logger.ts**: Verify hooks fire at correct levels
2. **Update daemon tests**: Ensure log counting still works
3. **Add CLI runtime tests**: Verify log counting and persistence
4. **StateReader tests**: Verify summing from multiple files

## Migration Notes

- Rename existing `log-metrics.json` → `daemon-log-metrics.json` (or let it be recreated)
- No schema changes needed - same `LogMetricsState` structure
