# Structured Logging & Telemetry LLD

## 1. Overview

This document details the design for the observability stack in Sidekick. The system uses **structured logging** (JSON) as the primary mechanism for both debug logs and telemetry (metrics), enabling a unified stream for debugging, performance analysis, and usage tracking.

## 2. Architecture

The logging system is built on **Pino**, chosen for its low overhead and rich ecosystem. It is wrapped by `sidekick-core` to enforce schemas, redaction, and context management.

### 2.1 Core Components

1.  **`LogManager` (Singleton in `sidekick-core`)**:
    - Initializes the root Pino instance.
    - Configures transports (File, Console).
    - Manages global context (Service Name, Version, Environment).
    - Handles log rotation setup.

2.  **`Logger` Interface**:
    - The primary interface consumed by features and the CLI.
    - Provides standard methods: `debug`, `info`, `warn`, `error`, `fatal`.
    - Provides `child(bindings)` to create scoped loggers (e.g., for a specific feature or request).

3.  **`Telemetry` Interface**:
    - A specialized wrapper around the `Logger` for emitting metric events.
    - Methods: `increment(metric, tags)`, `gauge(metric, value, tags)`, `histogram(metric, value, tags)`.
    - Metrics are written to the _same_ log stream but with a specific `event_type="telemetry"` field.

### 2.2 Data Flow

```mermaid
graph TD
    CLI[Sidekick CLI] -->|Log/Metric| CoreLogger
    Feature[Feature Module] -->|Log/Metric| ScopedLogger
    ScopedLogger -->|Inherits| CoreLogger
    CoreLogger -->|JSON Stream| Redactor
    Redactor -->|Sanitized JSON| MultiStream
    MultiStream -->|Stream 1| FileTransport[File: .sidekick/logs/sidekick.log]
    MultiStream -->|Stream 2 (Interactive)| PrettyTransport[Console (stderr)]
```

## 3. Log Schema

All logs are valid JSON objects.

### 3.1 Standard Fields (Pino Defaults + Custom)

| Field      | Type     | Description                                                           |
| :--------- | :------- | :-------------------------------------------------------------------- |
| `level`    | `number` | Log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal). |
| `time`     | `number` | Unix timestamp (ms).                                                  |
| `pid`      | `number` | Process ID.                                                           |
| `hostname` | `string` | Hostname.                                                             |
| `name`     | `string` | Logger name (e.g., `sidekick:cli`, `sidekick:supervisor`).            |
| `msg`      | `string` | Human-readable message.                                               |
| `context`  | `object` | Contextual data (see below).                                          |

### 3.2 Context Object

The `context` object carries metadata about the execution scope.

```json
{
  "context": {
    "scope": "project", // or "user"
    "correlation_id": "uuid", // Unique ID for the CLI command execution
    "session_id": "uuid", // If applicable (active shell session)
    "component": "feature-name", // e.g., "statusline", "reminders"
    "command": "user-prompt-submit" // The hook being executed
  }
}
```

### 3.3 Telemetry Schema

Telemetry events add specific fields to the root object.

```json
{
  "level": 30,
  "time": 1678888888888,
  "event_type": "telemetry",
  "metric": {
    "name": "llm_request_duration_ms",
    "type": "histogram", // counter, gauge, histogram
    "value": 450,
    "unit": "ms",
    "tags": {
      "provider": "claude-cli",
      "model": "claude-3-5-sonnet"
    }
  }
}
```

### 3.4 Entity-Lifecycle Events

To support the "Time Travel" and "Unified Cockpit" features of the Monitoring UI, the system uses a unified **Entity-Lifecycle** event model. This enables consistent querying ("show me all reminder events") and causality tracking.

#### Unified Event Schema

```json
{
  "level": 30,
  "time": 1678888888888,
  "source": "sidekick-cli",           // Required: which component emitted this event
  "pid": 12345,                       // Required: process ID

  "context": {                        // Required: correlation and scope metadata
    "session_id": "sess-abc123",      // Required: correlates all events in a session
    "trace_id": "req-456",            // Optional: links causally-related events
    "hook": "UserPromptSubmit",       // Optional: which hook triggered this event
    "task_id": "task-001"             // Optional: which background task is running
  },

  "entity": "reminder",               // Required: the type of thing
  "entity_id": "rem-789",             // Required: unique instance identifier
  "lifecycle": "triggered",           // Required: what happened to it

  "reason": "turn_cadence_met",       // Optional: explains why this happened
  "state": { ... },                   // Optional: full entity state snapshot
  "metadata": { ... }                 // Optional: additional context
}
```

#### Standard Entity Types

| Entity       | Lifecycle States                        | Emitted By              |
| ------------ | --------------------------------------- | ----------------------- |
| `session`    | started, ended                          | CLI                     |
| `command`    | received, processed                     | CLI, Supervisor IPC     |
| `task`       | queued, started, completed, failed      | Supervisor              |
| `reminder`   | created, triggered, injected, dismissed | Reminders feature       |
| `summary`    | analyzing, updated                      | Session-Summary feature |
| `statusline` | rendered, error                         | Statusline feature      |
| `transcript` | normalized, pruned                      | Transcript processing   |

#### Field Descriptions

- **`source`**: Identifies which Sidekick component emitted this event (e.g., `sidekick-cli`, `sidekick-supervisor`). Required for distinguishing events in multi-process scenarios.
- **`pid`**: Process ID of the component that emitted this event. Required for debugging concurrent processes and correlating with system-level monitoring.
- **`context`**: Nested object containing correlation IDs and scope metadata:
  - **`session_id`**: Unique identifier for the Claude session. Generated at session start. Used to correlate all events within a single user session. (Required)
  - **`trace_id`**: Optional correlation ID linking events that are causally related (e.g., a command → task queued → task completed chain). Enables trace visualization in the UI.
  - **`hook`**: Optional hook name that triggered this event (e.g., `UserPromptSubmit`, `ConversationContinued`). Useful for understanding the execution context.
  - **`task_id`**: Optional background task identifier when this event is part of asynchronous task execution.
- **`entity`**: The type of system component or concept this event describes.
- **`entity_id`**: A unique identifier for this specific instance (e.g., `rem-abc` for a specific reminder, `task-123` for a specific background task).
- **`lifecycle`**: The state transition that occurred. Each entity type defines its valid lifecycle states.
- **`reason`**: Human-readable explanation of why this transition happened. Useful for debugging.
- **`state`**: Complete snapshot of the entity's state at this point in time. Enables full reconstruction without diffs.
- **`metadata`**: Additional context that doesn't fit the standard fields (e.g., error details, performance metrics).

#### Example: Reminder Lifecycle

```json
// Reminder created
{
  "source": "sidekick-cli",
  "pid": 12345,
  "context": { "session_id": "sess-abc123" },
  "entity": "reminder",
  "entity_id": "rem-001",
  "lifecycle": "created",
  "state": { "type": "turn_cadence", "interval": 4, "countdown": 4 }
}

// Reminder triggered (countdown reached zero)
{
  "source": "sidekick-cli",
  "pid": 12345,
  "context": { "session_id": "sess-abc123" },
  "entity": "reminder",
  "entity_id": "rem-001",
  "lifecycle": "triggered",
  "reason": "turn_cadence_met",
  "state": { "countdown": 0, "text": "..." }
}

// Reminder injected into response
{
  "source": "sidekick-cli",
  "pid": 12345,
  "context": {
    "session_id": "sess-abc123",
    "trace_id": "hook-xyz",
    "hook": "UserPromptSubmit"
  },
  "entity": "reminder",
  "entity_id": "rem-001",
  "lifecycle": "injected"
}
```

#### Example: Task Lifecycle (with trace_id)

```json
// Command received by Supervisor
{
  "source": "sidekick-supervisor",
  "pid": 12346,
  "context": {
    "session_id": "sess-abc123",
    "trace_id": "req-abc"
  },
  "entity": "command",
  "entity_id": "cmd-001",
  "lifecycle": "received",
  "metadata": { "method": "task.enqueue" }
}

// Task queued (linked to command)
{
  "source": "sidekick-supervisor",
  "pid": 12346,
  "context": {
    "session_id": "sess-abc123",
    "trace_id": "req-abc",
    "task_id": "task-001"
  },
  "entity": "task",
  "entity_id": "task-001",
  "lifecycle": "queued",
  "state": { "type": "session_summary", "priority": 1 }
}

// Task started
{
  "source": "sidekick-supervisor",
  "pid": 12346,
  "context": {
    "session_id": "sess-abc123",
    "trace_id": "req-abc",
    "task_id": "task-001"
  },
  "entity": "task",
  "entity_id": "task-001",
  "lifecycle": "started"
}

// Task completed (with state snapshot)
{
  "source": "sidekick-supervisor",
  "pid": 12346,
  "context": {
    "session_id": "sess-abc123",
    "trace_id": "req-abc",
    "task_id": "task-001"
  },
  "entity": "task",
  "entity_id": "task-001",
  "lifecycle": "completed",
  "state": { "duration_ms": 1250 }
}
```

### 3.5 Context Logger Wrapper

Pino's built-in `child()` method performs a **shallow merge** of bindings, which means nested objects like `context` get replaced entirely rather than merged:

```typescript
const parent = logger.child({ context: { session_id: "sess-123" } });
const child = parent.child({ context: { trace_id: "req-456" } });

// ❌ PROBLEM: child only has trace_id, session_id is lost
child.info("Task started");
// Output: { "context": { "trace_id": "req-456" } }
```

To preserve context across the call chain, Sidekick provides a **thin wrapper** around Pino's logger that deep-merges the `context` object:

```typescript
// packages/sidekick-core/src/logger/context-logger.ts
export class ContextLogger {
  constructor(private pinoLogger: pino.Logger) {}

  child(bindings: pino.Bindings): ContextLogger {
    const mergedBindings = { ...bindings };

    if (bindings.context && this.pinoLogger.bindings().context) {
      mergedBindings.context = {
        ...this.pinoLogger.bindings().context,
        ...bindings.context
      };
    }

    return new ContextLogger(this.pinoLogger.child(mergedBindings));
  }

  // Proxy all standard Pino methods
  debug(obj: object, msg?: string): void { this.pinoLogger.debug(obj, msg); }
  info(obj: object, msg?: string): void { this.pinoLogger.info(obj, msg); }
  warn(obj: object, msg?: string): void { this.pinoLogger.warn(obj, msg); }
  error(obj: object, msg?: string): void { this.pinoLogger.error(obj, msg); }
  fatal(obj: object, msg?: string): void { this.pinoLogger.fatal(obj, msg); }
}
```

#### Usage: Building Context Through the Call Chain

```typescript
// 1. Root logger with source and pid
const rootLogger = new ContextLogger(pino());

// 2. CLI initializes with session_id
const sessionLogger = rootLogger.child({
  source: "sidekick-cli",
  pid: process.pid,
  context: { session_id: "sess-abc123" }
});

// 3. Hook handler adds trace_id and hook name
const hookLogger = sessionLogger.child({
  context: { trace_id: "req-456", hook: "UserPromptSubmit" }
});

// ✅ CORRECT: hookLogger has all context fields
hookLogger.info({ entity: "reminder", lifecycle: "triggered" });
// Output: {
//   "source": "sidekick-cli",
//   "pid": 12345,
//   "context": {
//     "session_id": "sess-abc123",
//     "trace_id": "req-456",
//     "hook": "UserPromptSubmit"
//   },
//   "entity": "reminder",
//   "lifecycle": "triggered"
// }
```

#### Design Rationale

- **Minimal Wrapper**: Only override `child()` for deep merge; all logging methods delegate directly to Pino
- **No Performance Impact**: Deep merge only happens on logger creation (rare), not on every log call (frequent)
- **Type Safety**: Wrapper implements the same interface as Pino's logger
- **Migration Path**: Can be dropped if Pino adds native deep-merge support in the future

## 4. Configuration & Routing

### 4.1 Log Levels

- **Default**: `info`
- **Configuration**: Controlled via `config.logging.level` or `SIDEKICK_LOG_LEVEL` env var.
- **Production**: Typically `info`.
- **Debug**: `debug` or `trace` for verbose output.

### 4.2 Destinations

1.  **Log File**:
    - **Path**:
      - Project Scope: `<project_root>/.sidekick/logs/sidekick.log`
      - User Scope: `~/.sidekick/logs/sidekick.log`
    - **Format**: JSON Lines (NDJSON).
    - **Rotation**:
      - **Mechanism**: Use `pino-roll` as the file transport. This handles rotation within the Node.js process, ensuring cross-platform compatibility (Windows/Linux) without external dependencies like `logrotate`.
      - **Policy**: Rotate when file size exceeds **10MB**. Keep a maximum of **5 rotated files** (e.g., `sidekick.1.log`, `sidekick.2.log`).
    - **Concurrency**: Both CLI (ephemeral) and Supervisor (long-running) write to this file. Node.js `fs.appendFile` is atomic for lines < PIPE_BUF (4KB on Linux), which covers most logs. For larger logs, we rely on OS file locking or accept minor interleaving risk, or use the Supervisor as the log aggregator (future optimization). _Decision: Direct append for now for simplicity and reliability if Supervisor is down._

2.  **Console (Stderr)**:
    - **Interactive Mode**: When running interactively (e.g., `sidekick config`), pretty-print logs using `pino-pretty` (or a lightweight custom formatter) to stderr.
    - **Hook Mode**: **SILENT** or strictly errors only to stderr to avoid polluting the shell hook output (which often captures stdout).
    - **Control**: `SIDEKICK_INTERACTIVE=1` enables console logging.

## 5. Redaction & Privacy

Privacy is critical. We must not log PII or sensitive user content by default.

### 5.1 Redaction Rules (Pino Redact)

- **Keys to Redact**: `["apiKey", "token", "secret", "authorization", "password", "key"]`.
- **Strategy**: Replace with `"[Redacted]"`.

### 5.2 Content Policy

- **User Prompts/Transcripts**:
  - **Default**: Do NOT log full user prompts or LLM responses.
  - **Debug Mode**: If `SIDEKICK_LOG_CONTENT=1` is set, log truncated versions (e.g., first 50 chars).
  - **Telemetry**: Log metadata only (token counts, duration, finish reason), never content.

## 6. Implementation Plan

### 6.1 `sidekick-core`

- Install `pino`, `pino-pretty` (dev dependency or bundled for CLI).
- Implement `src/logger/index.ts`:
  - `createLogger(config)` factory.
  - `Telemetry` class wrapper.
- Implement `src/logger/redaction.ts`:
  - Define redaction paths.

### 6.2 `sidekick-cli`

- Initialize logger at startup.
- Generate `correlation_id` for the command.
- Ensure `uncaughtException` and `unhandledRejection` are caught and logged.

### 6.3 Feature Integration

- Features receive a `logger` instance in their `register` method (or context).
- Example:
  ```typescript
  export function register(ctx: Context) {
    const log = ctx.logger.child({ component: 'my-feature' })
    log.info('Feature initialized')
  }
  ```
