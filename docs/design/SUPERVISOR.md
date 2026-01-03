# Supervisor Low-Level Design

## 1. Overview

The Supervisor is a long-running, detached Node.js background process responsible for:

1.  **State Management**: Acting as the _single writer_ to shared state and staging files to prevent race conditions.
2.  **Handler Execution**: Running registered handlers in response to hook events from the CLI.
3.  **Async Task Execution**: Handling heavy compute tasks (e.g., session summarization, resume generation) off the critical path of the CLI.
4.  **Resource Management**: Managing concurrency and ensuring system stability.

It is **always project-scoped**. Even if the user invokes Sidekick from a global install, the supervisor runs within the context of the specific project (`$CLAUDE_PROJECT_DIR`).

**Related Documentation:**

- `docs/design/flow.md`: Authoritative source for event model, hook flows, and CLI/Supervisor interaction patterns.
- `docs/design/TRANSCRIPT-PROCESSING.md`: TranscriptService as metrics owner, event emission, compaction history.
- `docs/design/CORE-RUNTIME.md`: RuntimeContext, HandlerRegistry API, service interfaces.
- `docs/design/STRUCTURED-LOGGING.md`: Logging infrastructure and conventions.

## 2. Process Architecture

### 2.1 Filesystem Layout

All supervisor-related files live in `<project-root>/.sidekick/`:

| File                                                        | Purpose                                                                 |
| ----------------------------------------------------------- | ----------------------------------------------------------------------- |
| `supervisor.pid`                                            | Contains the Process ID of the running supervisor. Acts as a lock file. |
| `supervisor.sock`                                           | Unix Domain Socket (or Named Pipe on Windows) for IPC.                  |
| `supervisor.token`                                          | Randomly generated auth token for IPC connection verification.          |
| `logs/supervisor.log`                                       | Structured JSON log file for supervisor events.                         |
| `state/supervisor-status.json`                              | Global supervisor status (not session-specific).                        |
| `sessions/{session_id}/*.json`                              | Session-specific persistent state (e.g., `summary.json`).               |
| `sessions/{session_id}/stage/{hook_name}/*.json`            | Staged reminders for CLI consumption (see §4.1).                        |
| `sessions/{session_id}/transcripts/pre-compact-{ts}.jsonl`  | Transcript snapshots captured by CLI before compaction (see §4.7).      |
| `sessions/{session_id}/state/compaction-history.json`       | Compaction metadata for Monitoring UI timeline (see §4.7).              |

### 2.2 Lifecycle Management

#### Startup Sequence (Initiated by CLI)

1.  **Check Liveness**: CLI reads `supervisor.pid`.
    - If file exists: Check if process is running (`kill -0 <pid>`).
    - If process dead: Remove stale `.pid`, `.sock`, `.token` files.
2.  **Connect**: Attempt to connect to `supervisor.sock`.
    - **Handshake**: Send `{ jsonrpc: "2.0", method: "handshake", params: { version: "<cli-version>", token: "<read-from-file>" } }`.
    - **Version Mismatch**: If supervisor version differs from CLI, send `shutdown` command, wait, then proceed to spawn.
3.  **Spawn (if needed)**:
    - Launch new Node.js process: `node dist/supervisor.js`.
    - **Detached**: `spawn(..., { detached: true, stdio: 'ignore' }).unref()`.
    - **Wait**: Poll for `supervisor.sock` and `supervisor.token` creation (timeout: 5s).

#### Shutdown Sequence

1.  **Graceful**: CLI sends `shutdown` method via IPC.
2.  **Signal**: Supervisor catches `SIGTERM`/`SIGINT`.
3.  **Cleanup**:
    - Stop accepting new tasks.
    - Stop TranscriptService file watchers (flush pending state).
    - Wait for in-flight tasks to complete (configurable via `supervisor.shutdownTimeoutMs`, default 30s).
    - Remove `.pid`, `.sock`, `.token`.
    - Exit.

**Note**: TranscriptService file watchers are configured with `watcher.unref()` so they don't prevent shutdown even if cleanup is delayed.

## 3. Communication Layer (IPC)

### 3.1 Transport

- **Linux/macOS**: Unix Domain Sockets (`net.createServer`). Path: `<project>/.sidekick/supervisor.sock`.
- **Windows**: Named Pipes (`\\.\pipe\sidekick-<project-hash>-sock`).
- **Abstraction**: `IPCServer` and `IPCClient` classes in `sidekick-core` hide these differences.

### 3.2 Protocol: JSON-RPC 2.0

All messages follow the JSON-RPC 2.0 specification.

**Request:**

```json
{
  "jsonrpc": "2.0",
  "method": "state.update",
  "params": { "key": "status", "value": { ... } },
  "id": 1
}
```

**Response:**

```json
{
  "jsonrpc": "2.0",
  "result": "ok",
  "id": 1
}
```

### 3.3 Security

- **Token Auth**: On startup, supervisor generates a crypto-random token and writes it to `supervisor.token` (0600 permissions).
- **Handshake**: The first message on any new connection _must_ be `handshake` with the correct token. Connection dropped otherwise.

## 4. Subsystems

### 4.1 State Manager (Single Writer)

The Supervisor is the **only** entity allowed to write to `.sidekick/` state and staging files. The State Manager provides two distinct APIs:

#### Persistent State

For long-lived session data (summaries, transcript metadata):

- **API**: `state.update(file: string, data: any, merge: boolean = false)`
- **Location**: `.sidekick/sessions/{session_id}/*.json`
- **Mechanism**:
  1.  Receive update request via IPC or handler invocation.
  2.  Apply change to in-memory cache.
  3.  **Atomic Write**: Write to `<path>.tmp`, then `rename` to `<path>.json`.

#### Staging (Reminder Files)

For files prepared by the Supervisor and consumed by the CLI on subsequent hook invocations:

- **API**: `stage.write(session_id: string, hook_name: string, reminder: StagedReminder)`
- **API**: `stage.suppress(session_id: string, hook_name: string)` — creates `.suppressed` marker
- **API**: `stage.clear(session_id: string, hook_name?: string)`
- **Location**: `.sidekick/sessions/{session_id}/stage/{hook_name}/*.json`
- **Mechanism**:
  1.  Create/overwrite reminder file at staging path.
  2.  Emit `ReminderStaged` event (see §4.5).
- **Consumption**: CLI reads staged files directly. No IPC required for reads.

See **docs/design/flow.md §4** for reminder file schema and **docs/design/FEATURE-REMINDERS.md §3.3** for suppression semantics.

### 4.2 Handler System (Unified Event Model)

The Supervisor registers **handlers** that execute in response to events from two sources:
1. **Hook Events**: Received via IPC from CLI (processed sequentially for synchronous response).
2. **Transcript Events**: Emitted by TranscriptService on file changes (processed concurrently, fire-and-forget).

Per **docs/design/flow.md §2.3** and **docs/design/CORE-RUNTIME.md §3.5**, handlers register with filters to specify which events they process:

```typescript
context.handlers.register({
  id: 'feature:handler-name',
  priority: 70,
  filter: { kind: 'hook', hooks: ['PostToolUse'] }  // or 'transcript' or 'all'
             | { kind: 'transcript', eventTypes: ['UserPrompt', 'ToolCall'] }
             | { kind: 'all' },
  handler: async (event, ctx) => { ... }
});
```

- **Priority**: Determines execution order (higher = earlier).
- **Error Handling**: Handlers implement internal try/catch. Unhandled exceptions are logged; execution continues to next handler.
- **Concurrency**:
  - Hook events: Sequential execution (must produce single response to CLI).
  - Transcript events: Concurrent execution (handlers manage their own concurrency via StateManager's atomic operations).

**Example Supervisor Handlers:**

| Filter Type   | Event(s)        | Handler                          | Priority | Behavior                                   |
| ------------- | --------------- | -------------------------------- | -------- | ------------------------------------------ |
| hook          | `SessionStart`  | `InitSessionState`               | 100      | Initialize session, start TranscriptService|
| hook          | `SessionStart`  | `StageDefaultUserPromptReminder` | 90       | Stage initial UserPromptSubmit reminder    |
| hook          | `PreCompact`    | `CapturePreCompactState`         | 100      | Invoke TranscriptService.capturePreCompactState() |
| hook          | `SessionEnd`    | `StopTranscriptService`          | 100      | Stop file watcher, flush pending state     |
| transcript    | `UserPrompt`    | `CheckSummaryCadence`            | 80       | Trigger summary if threshold met           |
| transcript    | `ToolCall`      | `StageAreYouStuckReminder`       | 70       | Stage reminder if tools-this-turn threshold met |

Note: Handlers DO NOT increment counters. Metrics (turn count, tool count, tokens) are owned by TranscriptService (see §4.7).

### 4.3 Task Execution Engine

Handlers may trigger **tasks**—long-running async jobs that run off the critical path.

- **Queue**: In-memory `PriorityQueue`.
- **Concurrency**: Configurable limit (default: 2 concurrent tasks).
- **Task Registry**: Task types register executor functions.
- **API**: `task.enqueue(type: string, payload: any, priority?: number)`

**Standard Task Types:**

| Task Type             | Triggered By               | Output                                        |
| --------------------- | -------------------------- | --------------------------------------------- |
| `cleanup`             | Periodic timer             | Prunes old session data                       |

> **Note**: Session summary and resume generation are handled by event-driven handlers in `feature-session-summary`, not by background tasks. See `docs/design/FEATURE-SESSION-SUMMARY.md`.

### 4.4 Watcher Service

Watches files to trigger reactive behaviors.

#### Configuration Watching
- **Targets**: `.sidekick/config.yaml`, `.env`.
- **Action**: On change, reload config in-memory. If critical config changes (e.g., log level), apply immediately.

#### Transcript Watching (via TranscriptService)
- **Target**: Claude Code transcript file (`$CLAUDE_SESSION_TRANSCRIPT_PATH`).
- **Action**: On file change, TranscriptService parses new entries and emits `TranscriptEvent` to HandlerRegistry.
- **Debouncing**: 100ms debounce to batch rapid file updates.
- **See**: §4.7 for TranscriptService details.

### 4.5 Monitoring UI Integration

The Supervisor emits **SidekickEvents** (see `docs/design/flow.md` §3.2 for schema) that the Monitoring UI aggregates for time-travel debugging.

#### 4.5.1 Event Schema

All Supervisor events follow the unified `SidekickEvent` schema:

```typescript
interface SidekickEvent {
  type: string
  time: number                    // Unix timestamp (ms)
  source: 'cli' | 'supervisor'
  context: {
    session_id: string            // Required: correlates all events
    scope?: 'project' | 'user'
    correlation_id?: string       // Unique ID for CLI command execution
    trace_id?: string             // Links causally-related events
    hook?: string                 // Which hook triggered this event
    task_id?: string              // Background task identifier
  }
  payload: {
    state?: Record<string, unknown>
    metadata?: Record<string, unknown>
    reason?: string
  }
}
```

#### 4.5.2 Supervisor-Emitted Events

| Event Type         | When                                   | Payload                                    |
| ------------------ | -------------------------------------- | ------------------------------------------ |
| `EventReceived`    | IPC event arrives from CLI             | `{ metadata: { hook, params } }`           |
| `HandlerExecuted`  | Handler completes (success or failure) | `{ state: { handler, result }, reason? }`  |
| `ReminderStaged`   | Reminder file created/updated          | `{ state: { hook, reminder_name } }`       |
| `SummaryUpdated`   | Session summary recalculated           | `{ state: { summary } }`                   |
| `RemindersCleared` | Stage directory cleaned (SessionStart) | `{ metadata: { session_id } }`             |
| `TaskQueued`       | Task added to execution queue          | `{ state: { type, priority, queue_depth }}`|
| `TaskStarted`      | Task execution begins                  | `{ metadata: { type } }`                   |
| `TaskCompleted`    | Task execution succeeds                | `{ state: { duration_ms } }`               |
| `TaskFailed`       | Task execution fails                   | `{ reason, metadata: { error } }`          |

#### 4.5.3 Example Events

```json
// Handler executed successfully
{
  "type": "HandlerExecuted",
  "time": 1678888888888,
  "source": "supervisor",
  "context": {
    "session_id": "sess-001",
    "trace_id": "req-abc",
    "hook": "PostToolUse"
  },
  "payload": {
    "state": { "handler": "StageAreYouStuckReminder", "result": "staged" }
  }
}

// Reminder staged for future consumption
{
  "type": "ReminderStaged",
  "time": 1678888888900,
  "source": "supervisor",
  "context": {
    "session_id": "sess-001",
    "trace_id": "req-abc",
    "hook": "PostToolUse"
  },
  "payload": {
    "state": { "hook": "PreToolUse", "reminder_name": "AreYouStuckReminder" }
  }
}

// Task failed with error details
{
  "type": "TaskFailed",
  "time": 1678888920000,
  "source": "supervisor",
  "context": {
    "session_id": "sess-001",
    "task_id": "task-001"
  },
  "payload": {
    "reason": "LLM_TIMEOUT",
    "metadata": { "error": "LLM call timed out after 30s", "recoverable": true }
  }
}
```

### 4.6 Internal State Visibility

To allow the Monitoring UI to display system health, the Supervisor must periodically (e.g., every 5s or on change) write its internal status to `state/supervisor-status.json`.

**Schema:**

```json
{
  "timestamp": 1678888888888,
  "pid": 12345,
  "uptime_seconds": 3600,
  "memory": {
    "heapUsed": 102400,
    "heapTotal": 204800,
    "rss": 512000
  },
  "queue": {
    "pending": 2,
    "active": 1
  },
  "active_tasks": [
    {
      "id": "task-1",
      "type": "cleanup",
      "start_time": 1678888880000
    }
  ]
}
```

### 4.7 TranscriptService Integration

The Supervisor owns the `TranscriptService` instance, which serves as the canonical source of transcript-derived metrics. See **docs/design/TRANSCRIPT-PROCESSING.md** for complete specification.

#### Initialization

On `SessionStart`, the Supervisor initializes TranscriptService:

```typescript
// In SessionStart handler (priority 100)
// event is typed as SessionStartHookEvent
ctx.transcript.initialize({
  transcriptPath: event.payload.transcriptPath,
  sessionId: event.context.sessionId
});
ctx.transcript.startWatching();  // Begin file watching
```

#### Shutdown

On `SessionEnd` (reason: `clear` | `logout` | `prompt_input_exit` | `other`), TranscriptService stops watching:

```typescript
// In SessionEnd handler (priority 100)
await ctx.transcript.shutdown();  // Stop watching, flush pending state
```

**Note**: The file watcher is configured with `watcher.unref()` so it doesn't prevent process shutdown even if the SessionEnd event is missed.

#### Metrics Ownership

TranscriptService maintains authoritative metrics:

| Metric            | Description                              |
| ----------------- | ---------------------------------------- |
| `turnCount`       | Total user prompts in session            |
| `toolsThisTurn`   | Tools since last UserPrompt (resets)     |
| `toolCount`       | Total tool invocations                   |
| `inputTokens`     | Extracted from native transcript metadata |
| `outputTokens`    | Estimated output tokens                  |
| `lastProcessedLine` | Watermark for incremental processing   |

Features access via `ctx.transcript.getMetrics()` rather than maintaining independent counters.

#### Event Emission

On transcript file changes, TranscriptService:
1. Parses new lines since `lastProcessedLine`.
2. Updates metrics incrementally.
3. Emits `TranscriptEvent` for each new entry to HandlerRegistry.
4. Persists metrics to StateManager for crash recovery.

#### Compaction Handling

Per **docs/design/flow.md §5.6** (PreCompact flow):

1. CLI copies full transcript to `.sidekick/sessions/{session_id}/transcripts/pre-compact-{timestamp}.jsonl`.
2. CLI sends `PreCompact` event with `transcriptSnapshotPath` reference.
3. Supervisor's PreCompact handler invokes `ctx.transcript.capturePreCompactState(snapshotPath)`.
4. TranscriptService snapshots current metrics and records compaction metadata.
5. On next file change, TranscriptService detects shortened file → triggers full recompute.

### 4.8 ContextMetricsService Integration

The Supervisor owns the `ContextMetricsService` instance, which captures Claude Code's actual context window overhead. See **docs/design/TRANSCRIPT_METRICS.md** for complete specification.

#### Purpose

The Statusline displays context window utilization, but requires visibility into Claude Code's token overhead:
- **System prompt**: ~3.2k tokens (Claude Code's base instructions)
- **System tools**: ~17.9k tokens (built-in tool definitions)
- **MCP tools**: Variable (project-specific MCP server tools)
- **Custom agents**: Variable (plugin-defined agents)
- **Memory files**: Variable (CLAUDE.md, AGENTS.md, etc.)
- **Autocompact buffer**: ~45k tokens (reserved for context management)

#### Initialization

On `SessionStart`, the Supervisor initializes ContextMetricsService:

```typescript
// In supervisor constructor
this.contextMetricsService = createContextMetricsService({
  stateManager: this.stateManager,
  sessionId: this.sessionId,
  transcriptPath: this.transcriptPath,
});

// In start() method (step 4, after TranscriptService)
await this.contextMetricsService.initialize();
```

The `initialize()` method:
1. Writes default metrics immediately (statusline can use these right away)
2. Async-captures real metrics via CLI (non-blocking)

#### Transcript Monitoring

ContextMetricsService monitors transcripts for `/context` command output:

```typescript
// Pattern-match on content (self-identifying)
if (content.includes('<local-command-stdout>') &&
    content.includes('System prompt') &&
    content.includes('System tools')) {
  const metrics = parseContextTable(content);
  if (metrics) {
    await this.updateProjectMetrics(metrics);
  }
}
```

#### State Files

| File | Location | Contents | Updated When |
|------|----------|----------|--------------|
| `baseline-user-context-token-metrics.json` | `~/.sidekick/state/` | System prompt, system tools, autocompact buffer | Supervisor startup |
| `baseline-project-context-token-metrics.json` | `.sidekick/state/` | MCP tools, custom agents, memory files | /context observed |
| `context-metrics.json` | `.sidekick/sessions/{id}/state/` | Full context metrics for this session | /context observed |

#### Statusline Integration

Statusline reads context metrics to calculate accurate context utilization:

```typescript
// Effective limit = context window - overhead
const effectiveLimit = contextWindowSize - getTotalOverhead();
```

## 5. Error Handling & Resilience

- **Uncaught Exceptions**: Log fatal error to `logs/supervisor.log`, attempt graceful cleanup, then exit. CLI will restart it on next run.
- **Stuck Tasks**: Tasks have a strict timeout (default 5m, but task metadata can override this). If timed out, the worker is terminated/promise rejected, and error logged.
- **Corrupt State**: On startup, if state files are malformed JSON, they are moved to `.bak` and reset to empty.

## 6. Outstanding Questions / Recommendations

### 6.1 Task Persistence

_Current Design_: In-memory queue. If supervisor crashes, pending tasks are lost.
_Recommendation_: Accept this for V1. Most tasks (summary, status update) are transient or can be re-triggered.

### 6.2 Windows Named Pipe Security

_Question_: Unix sockets have file permissions. Named pipes are accessible by local users.
_Recommendation_: Rely on the auth token mechanism. The token file is protected by filesystem permissions (NTFS ACLs), effectively securing the pipe.

### 6.3 Log Rotation

_Question_: `supervisor.log` will grow indefinitely.
_Recommendation_: The Supervisor should use the shared `LogManager` from `sidekick-core`, which implements log rotation via `pino-roll` (10MB limit, 5 files). This ensures consistent behavior with the CLI logs (`logs/cli.log`).
