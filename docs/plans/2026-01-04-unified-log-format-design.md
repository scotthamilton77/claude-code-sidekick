# Unified Log Format Design

## Problem

`sidekick.log` (CLI) and `sidekickd.log` have inconsistent formatting:

| Aspect | CLI | Daemon |
|--------|-----|------------|
| Context nesting | Nested in `context: {}` | Flat at root level |
| Session ID | `context.sessionId` | Top-level `sessionId` |
| Structured events | Consistent `type`, `source`, `state`, `metadata` | Mixed plain messages and structured events |
| Correlation ID | Present | Not propagated from CLI |

This requires cognitive shift when scanning between logs.

## Solution

Standardize both logs on the CLI's structured pattern and propagate `correlationId` from CLI to daemon for full request tracing.

## Unified Log Context Schema

```typescript
interface LogContext {
  scope: 'project' | 'user'
  sessionId?: string        // Present once session is known
  correlationId?: string    // Present for all hook-triggered operations
  component?: string        // Optional: 'transcript', 'staging', 'summary', etc.
}
```

**Field placement:**
- `context: {}` - Always nested object
- `type`, `source`, `state`, `metadata` - Top-level for structured events
- `msg` - Always present as human-readable message

**Example unified output:**
```json
{"level":30,"time":1767542853331,"name":"daemon","context":{"scope":"project","sessionId":"c8c46dc5-...","correlationId":"3c422c06-..."},"type":"EventReceived","source":"daemon","metadata":{"hook":"UserPromptSubmit"},"msg":"EventReceived"}
```

## Correlation ID Propagation

The CLI already sends `correlationId` in `event.context`. The daemon will:

1. Extract `correlationId` from incoming hook events
2. Create request-scoped child logger with bound context
3. Pass logger through call chain to downstream operations

**Concurrency safety:** Each `handleHookInvoke` creates a new child logger instance (local variable, not stored on `this`). Pino's `.child()` creates independent instances, so concurrent requests don't interfere.

## Implementation Changes

### 1. Daemon Initialization (`daemon.ts:117-124`)

Add base context to `createLogManager()`:

```typescript
this.logManager = createLogManager({
  name: 'daemon',
  context: { scope: 'project' },  // Add base context
  level: this.configService.core.logging.level,
  destinations: { /* ... */ },
})
```

### 2. Request-Scoped Logger (`daemon.ts:handleHookInvoke`)

Extract correlationId and create child logger:

```typescript
private async handleHookInvoke(params: Record<string, unknown> | undefined): Promise<unknown> {
  const event = params?.event as HookEvent
  const { sessionId, correlationId } = event.context ?? {}

  // Create request-scoped logger
  const requestLogger = this.logger.child({
    context: { sessionId, correlationId }
  })

  // Pass to downstream methods
  await this.setContextForHook(sessionId, transcriptPath, requestLogger)
  // ...
}
```

### 3. Per-Method Logger Pattern for Services

Services accept optional logger parameter for request-scoped operations:

```typescript
class StagingService {
  private logger: Logger  // Base logger

  async clearStaging(options?: { logger?: Logger }): Promise<void> {
    const log = options?.logger ?? this.logger
    log.info('Clearing staged reminders')
  }
}
```

Call site:
```typescript
await stagingService.clearStaging({ logger: requestLogger })
```

### 4. Structured Event Migration

Convert plain log messages to structured events:

**Add to `LogEvents` in `structured-logging.ts`:**
- `DaemonStarting` - startup initiated
- `DaemonStarted` - startup complete
- `IpcServerStarted` - socket listening
- `ConfigWatcherStarted` - file watcher active
- `SessionEvictionStarted` - cleanup timer running

## Files to Modify

1. `packages/sidekick-core/src/structured-logging.ts` - Add new LogEvents
2. `packages/sidekickd/src/daemon.ts` - Context propagation
3. `packages/sidekickd/src/services/*.ts` - Per-method logger pattern
4. `packages/sidekickd/src/handlers/*.ts` - Accept logger parameter

## Testing

- Verify correlationId appears in daemon logs for hook invocations
- Verify concurrent requests have distinct correlationIds
- Verify background operations (timers, watchers) use base logger without correlationId
