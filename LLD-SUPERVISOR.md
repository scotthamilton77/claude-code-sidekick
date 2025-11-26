# Supervisor Low-Level Design

## 1. Overview

The Supervisor is a long-running, detached Node.js background process responsible for:
1.  **State Management**: Acting as the *single writer* to shared state files to prevent race conditions.
2.  **Async Task Execution**: Handling heavy compute tasks (e.g., session summarization, resume generation) off the critical path of the CLI.
3.  **Resource Management**: Managing concurrency and ensuring system stability.

It is **always project-scoped**. Even if the user invokes Sidekick from a global install, the supervisor runs within the context of the specific project (`$CLAUDE_PROJECT_DIR`).

## 2. Process Architecture

### 2.1 Filesystem Layout
All supervisor-related files live in `<project-root>/.sidekick/`:

| File | Purpose |
|------|---------|
| `supervisor.pid` | Contains the Process ID of the running supervisor. Acts as a lock file. |
| `supervisor.sock` | Unix Domain Socket (or Named Pipe on Windows) for IPC. |
| `supervisor.token` | Randomly generated auth token for IPC connection verification. |
| `supervisor.log` | Dedicated log file for the supervisor process (structured JSON logs). |
| `state/*.json` | State files managed by the supervisor (e.g., `status.json`, `summary.json`). |

### 2.2 Lifecycle Management

#### Startup Sequence (Initiated by CLI)
1.  **Check Liveness**: CLI reads `supervisor.pid`.
    *   If file exists: Check if process is running (`kill -0 <pid>`).
    *   If process dead: Remove stale `.pid`, `.sock`, `.token` files.
2.  **Connect**: Attempt to connect to `supervisor.sock`.
    *   **Handshake**: Send `{ jsonrpc: "2.0", method: "handshake", params: { version: "<cli-version>", token: "<read-from-file>" } }`.
    *   **Version Mismatch**: If supervisor version differs from CLI, send `shutdown` command, wait, then proceed to spawn.
3.  **Spawn (if needed)**:
    *   Launch new Node.js process: `node dist/supervisor.js`.
    *   **Detached**: `spawn(..., { detached: true, stdio: 'ignore' }).unref()`.
    *   **Wait**: Poll for `supervisor.sock` and `supervisor.token` creation (timeout: 5s).

#### Shutdown Sequence
1.  **Graceful**: CLI sends `shutdown` method via IPC.
2.  **Signal**: Supervisor catches `SIGTERM`/`SIGINT`.
3.  **Cleanup**:
    *   Stop accepting new tasks.
    *   Wait for in-flight tasks to complete (configurable via `supervisor.shutdownTimeoutMs`, default 30s).
    *   Remove `.pid`, `.sock`, `.token`.
    *   Exit.

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
- **Handshake**: The first message on any new connection *must* be `handshake` with the correct token. Connection dropped otherwise.

## 4. Subsystems

### 4.1 State Manager (Single Writer)
The Supervisor is the **only** entity allowed to write to `.sidekick/state/`.

- **API**: `state.update(file: string, data: any, merge: boolean = false)`
- **Mechanism**:
    1.  Receive update request via IPC.
    2.  Apply change to in-memory cache.
    3.  **Atomic Write**: Write to `.sidekick/state/<file>.tmp`, then `rename` to `.sidekick/state/<file>.json`.
- **Reads**: The CLI reads these JSON files directly. No IPC required for reads.

### 4.2 Task Execution Engine
Handles long-running or background jobs.

- **Queue**: In-memory `PriorityQueue`.
- **Concurrency**: Configurable limit (default: 2 heavy tasks).
- **Task Registry**: Features register handlers (e.g., `session-summary` registers a summarizer function).
- **API**: `task.enqueue(type: string, payload: any)`

**Standard Tasks:**
1.  `session_summary`: Reads transcript, calls LLM, updates `state/summary.json`.
2.  `resume_generation`: Analyzes context, generates resume points.
3.  `cleanup`: Periodic maintenance (old state pruning).

### 4.3 Watcher Service
Watches configuration files to trigger hot-reloads of internal state.
- **Targets**: `.sidekick/config.jsonc`, `.env`.
- **Action**: On change, reload config in-memory. If critical config changes (e.g., log level), apply immediately.

## 5. Error Handling & Resilience

- **Uncaught Exceptions**: Log fatal error to `supervisor.log`, attempt graceful cleanup, then exit. CLI will restart it on next run.
- **Stuck Tasks**: Tasks have a strict timeout (default 5m, but task metadata can override this). If timed out, the worker is terminated/promise rejected, and error logged.
- **Corrupt State**: On startup, if state files are malformed JSON, they are moved to `.bak` and reset to empty.

## 6. Outstanding Questions / Recommendations

### 6.1 Task Persistence
*Current Design*: In-memory queue. If supervisor crashes, pending tasks are lost.
*Recommendation*: Accept this for V1. Most tasks (summary, status update) are transient or can be re-triggered.

### 6.2 Windows Named Pipe Security
*Question*: Unix sockets have file permissions. Named pipes are accessible by local users.
*Recommendation*: Rely on the auth token mechanism. The token file is protected by filesystem permissions (NTFS ACLs), effectively securing the pipe.

### 6.3 Log Rotation
*Question*: `supervisor.log` will grow indefinitely.
*Recommendation*: The Supervisor should use the shared `LogManager` from `sidekick-core`, which implements log rotation via `pino-roll` (10MB limit, 5 files). This ensures consistent behavior with the CLI logs.
