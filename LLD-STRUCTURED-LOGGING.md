# Structured Logging & Telemetry LLD

## 1. Overview

This document details the design for the observability stack in Sidekick. The system uses **structured logging** (JSON) as the primary mechanism for both debug logs and telemetry (metrics), enabling a unified stream for debugging, performance analysis, and usage tracking.

## 2. Architecture

The logging system is built on **Pino**, chosen for its low overhead and rich ecosystem. It is wrapped by `sidekick-core` to enforce schemas, redaction, and context management.

### 2.1 Core Components

1.  **`LogManager` (Singleton in `sidekick-core`)**:
    *   Initializes the root Pino instance.
    *   Configures transports (File, Console).
    *   Manages global context (Service Name, Version, Environment).
    *   Handles log rotation setup.

2.  **`Logger` Interface**:
    *   The primary interface consumed by features and the CLI.
    *   Provides standard methods: `debug`, `info`, `warn`, `error`, `fatal`.
    *   Provides `child(bindings)` to create scoped loggers (e.g., for a specific feature or request).

3.  **`Telemetry` Interface**:
    *   A specialized wrapper around the `Logger` for emitting metric events.
    *   Methods: `increment(metric, tags)`, `gauge(metric, value, tags)`, `histogram(metric, value, tags)`.
    *   Metrics are written to the *same* log stream but with a specific `event_type="telemetry"` field.

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

| Field | Type | Description |
| :--- | :--- | :--- |
| `level` | `number` | Log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal). |
| `time` | `number` | Unix timestamp (ms). |
| `pid` | `number` | Process ID. |
| `hostname` | `string` | Hostname. |
| `name` | `string` | Logger name (e.g., `sidekick:cli`, `sidekick:supervisor`). |
| `msg` | `string` | Human-readable message. |
| `context` | `object` | Contextual data (see below). |

### 3.2 Context Object

The `context` object carries metadata about the execution scope.

```json
{
  "context": {
    "scope": "project",      // or "user"
    "correlation_id": "uuid", // Unique ID for the CLI command execution
    "session_id": "uuid",     // If applicable (active shell session)
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
      "provider": "anthropic",
      "model": "claude-3-5-sonnet"
    }
  }
}
```

## 4. Configuration & Routing

### 4.1 Log Levels
*   **Default**: `info`
*   **Configuration**: Controlled via `config.logging.level` or `SIDEKICK_LOG_LEVEL` env var.
*   **Production**: Typically `info`.
*   **Debug**: `debug` or `trace` for verbose output.

### 4.2 Destinations

1.  **Log File**:
    *   **Path**:
        *   Project Scope: `<project_root>/.sidekick/logs/sidekick.log`
        *   User Scope: `~/.sidekick/logs/sidekick.log`
    *   **Format**: JSON Lines (NDJSON).
    *   **Rotation**:
        *   **Mechanism**: Use `pino-roll` as the file transport. This handles rotation within the Node.js process, ensuring cross-platform compatibility (Windows/Linux) without external dependencies like `logrotate`.
        *   **Policy**: Rotate when file size exceeds **10MB**. Keep a maximum of **5 rotated files** (e.g., `sidekick.1.log`, `sidekick.2.log`).
    *   **Concurrency**: Both CLI (ephemeral) and Supervisor (long-running) write to this file. Node.js `fs.appendFile` is atomic for lines < PIPE_BUF (4KB on Linux), which covers most logs. For larger logs, we rely on OS file locking or accept minor interleaving risk, or use the Supervisor as the log aggregator (future optimization). *Decision: Direct append for now for simplicity and reliability if Supervisor is down.*

2.  **Console (Stderr)**:
    *   **Interactive Mode**: When running interactively (e.g., `sidekick config`), pretty-print logs using `pino-pretty` (or a lightweight custom formatter) to stderr.
    *   **Hook Mode**: **SILENT** or strictly errors only to stderr to avoid polluting the shell hook output (which often captures stdout).
    *   **Control**: `SIDEKICK_INTERACTIVE=1` enables console logging.

## 5. Redaction & Privacy

Privacy is critical. We must not log PII or sensitive user content by default.

### 5.1 Redaction Rules (Pino Redact)
*   **Keys to Redact**: `["apiKey", "token", "secret", "authorization", "password", "key"]`.
*   **Strategy**: Replace with `"[Redacted]"`.

### 5.2 Content Policy
*   **User Prompts/Transcripts**:
    *   **Default**: Do NOT log full user prompts or LLM responses.
    *   **Debug Mode**: If `SIDEKICK_LOG_CONTENT=1` is set, log truncated versions (e.g., first 50 chars).
    *   **Telemetry**: Log metadata only (token counts, duration, finish reason), never content.

## 6. Implementation Plan

### 6.1 `sidekick-core`
*   Install `pino`, `pino-pretty` (dev dependency or bundled for CLI).
*   Implement `src/logger/index.ts`:
    *   `createLogger(config)` factory.
    *   `Telemetry` class wrapper.
*   Implement `src/logger/redaction.ts`:
    *   Define redaction paths.

### 6.2 `sidekick-cli`
*   Initialize logger at startup.
*   Generate `correlation_id` for the command.
*   Ensure `uncaughtException` and `unhandledRejection` are caught and logged.

### 6.3 Feature Integration
*   Features receive a `logger` instance in their `register` method (or context).
*   Example:
    ```typescript
    export function register(ctx: Context) {
      const log = ctx.logger.child({ component: 'my-feature' });
      log.info('Feature initialized');
    }
    ```
