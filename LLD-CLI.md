# CLI & Hooks Framework Design

## 1. Core Philosophy

The `sidekick-cli` is a **thin, pluggable framework**. It does not contain business logic. Instead, it provides the scaffolding for:

1.  Bootstrapping the runtime.
2.  Loading features dynamically.
3.  Dispatching execution to registered commands.
4.  Handling output formatting based on the execution mode (Interactive vs. Hook).

## 2. Testing Strategy (TDD)

**Unit Tests MUST be written first.**

- **Command Registry**: Verify commands can be registered and retrieved.
- **Output Formatter**: Verify correct JSON/Text output based on mode.
- **Bootstrapper**: Mock `sidekick-core` and verify init sequence.
- **Integration**: Use the `testing/fixtures` harness to simulate CLI invocations without spawning real processes.
- **Hook Dispatcher**: Validate hook routing logic (see §3.4) remains deterministic between `.claude` and `~/.claude` scopes.

## 3. Architecture

### 3.1 Hook Wrapper Layer (Bash Scripts)

**Important**: The hooks configured in Claude Code's `settings.json` are **bash scripts**, not direct Node.js invocations. These bash scripts:

1. **Installation Location**: Installed to `.claude/hooks/sidekick/` (project-scope) or `~/.claude/hooks/sidekick/` (user-scope).
2. **Self-Awareness**: Can extract their own installation path from bash parameters (`$0`, `$BASH_SOURCE`, etc.).
3. **Environment Access**: Have access to Claude Code's environment variables, including `$CLAUDE_PROJECT_DIR`.
4. **Hook Input Reception**: Receive hook invocation JSON from Claude Code containing structured data about the event.
5. **Parameter Forwarding**: Forward hook input to the Node.js CLI along with explicit scope hints.
6. **Explicit Scope Hints**: Pass explicit parameters to the CLI:
   - `--hook-script-path`: The absolute path of the bash script itself (enables scope detection).
   - `--project-dir`: The value of `$CLAUDE_PROJECT_DIR` (explicit project context).
   - Hook input JSON payload via stdin or `--input` flag.

#### 3.1.1 Hook Input Structure

Claude Code invokes hooks with a JSON structure passed via stdin. The structure varies by hook type but always includes core context fields:

**Common Fields** (all hooks):
- `session_id` (string): Unique identifier for the current Claude session
- `transcript_path` (string): Absolute path to the session transcript file
- `cwd` (string): Current working directory when hook was triggered
- `hook_event_name` (string): Name of the triggered hook (e.g., "UserPromptSubmit", "SessionStart")

**Hook-Specific Fields** (examples):
- `UserPromptSubmit`: `user_prompt` (string) - the user's message
- `StatusLine`: (no additional fields)
- `SessionSummary`: Previous summary context (if available)

**Reference**: See [Claude Code Hooks Documentation](https://docs.anthropic.com/en/docs/claude-code/hooks#hook-input) for complete specification.

**Session ID Extraction**: The CLI extracts `session_id` directly from the hook input JSON. This is the authoritative session identifier used for:
- Correlating logs and events
- Organizing session state files (`.sidekick/sessions/{session_id}/`)
- Supervisor task tracking and routing

**Example Hook Script** (`.claude/hooks/sidekick/session-start`):
```bash
#!/usr/bin/env bash
# This script is registered in .claude/settings.json

# Extract our own location
HOOK_SCRIPT_PATH="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/$(basename "${BASH_SOURCE[0]}")"

# Forward to Node.js CLI with explicit context
exec npx @sidekick/cli session-start \
  --hook \
  --hook-script-path="$HOOK_SCRIPT_PATH" \
  --project-dir="$CLAUDE_PROJECT_DIR" \
  --input "$@"
```

This architecture provides:
- **Deterministic Scope Resolution**: CLI receives explicit hints rather than relying solely on directory walking.
- **Portability**: Bash scripts can invoke `npx`, global installs, or custom Node.js paths.
- **Flexibility**: Bash layer can perform pre-processing, environment setup, or conditional execution.

### 3.2 Execution Modes

The CLI operates in two distinct modes, determined by flags or invocation context:

1.  **Interactive Mode** (Default):

    - **Output**: Rich text, colors, spinners, human-readable errors.
    - **Behavior**: Can prompt for user input, show progress bars.
    - **Use Case**: Manual user interaction (e.g., `npx @sidekick/cli status`).

2.  **Hook Mode** (`--hook` flag):
    - **Output**: Strict, machine-parsable (often silent or specific JSON format required by Claude).
    - **Behavior**: Non-interactive, fail-fast, minimal latency.
    - **Use Case**: Automated calls from Claude Desktop (e.g., `npx @sidekick/cli session-start --hook`).

### 3.3 Pluggable Command Registry

Features register their commands at runtime. The CLI does not hardcode `session-start` or `user-prompt-submit`.

```typescript
interface CommandDefinition {
  name: string;
  description: string;
  mode: 'interactive' | 'hook' | 'both';
  handler: (args: any, context: Context) => Promise<void>;
}

// Feature packages export a registration function
export function register(registry: CommandRegistry) {
  registry.register({
    name: 'session-start',
    handler: async () => { ... }
  });
}
```

### 3.4 Bootstrap Sequence

1.  **Parse Args**: Identify mode and requested command.
2.  **Init Minimal Logger**: Initialize Phase 1 logger (console-based) for bootstrap logging.
3.  **Resolve Scope**: 
    - Extract project path from hook input (if available).
    - Walk up from `cwd` to find nearest `.claude/hooks/sidekick/`.
    - Determine if user-scope or project-scope.
    - **Dual-Install Check**: If running from user-scope, check project's `.claude/settings.json` and `.claude/settings.json.local` for `sidekick` string. If found, log warning to project logs and exit.
4.  **Init Core**: Load `sidekick-core` (Config, Logger Phase 2, Asset Resolver).
5.  **Supervisor Handshake**: 
    - Check for existing supervisor (PID file + socket).
    - Verify version compatibility via IPC ping.
    - Start supervisor if missing or restart if version mismatch.
    - Establish IPC connection.
6.  **Load Features**: Scan `packages/` or config to find enabled features.
7.  **Register Commands**: Invoke `register()` on each active feature.
8.  **Dispatch**: Find the matching command(s) and execute.

### 3.5 Hook Dispatcher

The CLI owns hook dispatch so there is a single entry point for Claude Desktop integrations:

1.  **Hook Table**: Generated at runtime from enabled features (e.g., `session-start`, `user-prompt-submit`, `statusline`).
2.  **Context Builder**: Injects resolved scope paths, config snapshot, IPC client, telemetry logger, and feature-specific settings.
3.  **Deterministic Output**: Each hook declares whether it emits JSON, NDJSON, or raw text to prevent breaking the Claude protocol.
4.  **Latency Budget**: Dispatcher warns on violated hook-specific SLAs (statusline <50 ms, summaries delegated to supervisor).

## 4. Supervisor Interaction

The CLI framework provides a shared **IPC Client** helper that commands can use.

- **Abstracts**: Connection logic, retries, and error handling.
- **Usage**: Commands simply call `ctx.ipc.send('task_name', payload)`.

## 5. Error Handling

- **Interactive**: Print friendly error message to `stderr`.
- **Hook**: Log full error to file, exit with code 1 (or 0 if failure should be silent), print minimal/no output to `stderr` to avoid breaking the calling process.

## 6. Scope Resolution & Dual-Installation Handling

### 6.1 Scope Detection Algorithm

When the CLI is invoked, it determines scope using **explicit hints** provided by the bash hook wrapper (see §3.1):

**Primary Detection (Explicit Hints)**:
1. **`--hook-script-path` parameter**: The bash wrapper passes its own absolute path.
   - If path contains `/.claude/hooks/sidekick/`: **project scope** (extract project root from path).
   - If path contains `~/.claude/hooks/sidekick/` or `$HOME/.claude/hooks/sidekick/`: **user scope**.
2. **`--project-dir` parameter**: The bash wrapper forwards `$CLAUDE_PROJECT_DIR` from Claude Code's environment.
   - Provides explicit project context for validation and logging.
   - Used to verify consistency with scope derived from `--hook-script-path`.

**Fallback Detection (No Explicit Hints)**:
- If `--hook-script-path` is not provided (e.g., manual CLI invocation):
  1. Walk up directory tree from `cwd` to find nearest `.claude/hooks/sidekick/` directory.
  2. If found and is **NOT** `~/.claude/hooks/sidekick/`: Use **project scope**.
  3. If not found: Use **user scope** (`~/.claude/hooks/sidekick/`).

**Manual Override**:
- `--scope=user|project` flag can override all auto-detection logic.

**Validation**:
- If both `--hook-script-path` and `--project-dir` are provided, verify they are consistent:
  - Extract project root from hook script path.
  - Compare with `--project-dir`.
  - Log warning if mismatch detected (but proceed with `--hook-script-path` as source of truth).

### 6.2 Dual-Installation Detection

When **both** user-scope and project-scope installations exist, hooks could fire twice. To prevent this:

**User-Scope Hook Execution Path**:
1. CLI receives explicit project directory via `--project-dir` parameter (forwarded from `$CLAUDE_PROJECT_DIR` by bash wrapper).
2. Check if project has Sidekick registered in `<project-dir>/.claude/settings.json` OR `<project-dir>/.claude/settings.json.local`.
3. Perform simple string search for `sidekick` (no JSON parsing required—just verify the string exists).
4. **If project-scope detected**:
   - Log warning to session-specific log (or fallback to project root if session context unavailable):
     ```
     [WARN] Sidekick hook executed from user-scope (~/.claude/hooks/sidekick/) 
            but project-scope installation detected at <project-dir>. 
            Project-scope takes precedence. User-scope hook exiting. 
            Consider uninstalling user-scope if not needed globally.
     ```
   - Exit silently (exit code 0).
5. **If no project-scope**: Proceed with normal execution.

**Project-Scope Hook Execution Path**:
- Always executes normally (project-scope takes precedence).

**Supervisor Ownership**:
- Supervisor process is **always project-scoped** regardless of installation scope.
- PID file location: `<project>/.sidekick/supervisor.pid`.
- User-scope hooks delegate to project-scope supervisor when dual-install detected.

## 7. Supervisor Lifecycle Management

Supervisor process should self-terminate after a configurable idle timeout (default: 5 minutes). Configure via `supervisor.idleTimeoutMs` in config; set to `0` to disable.

### 7.1 CLI Commands

| Command | Behavior |
|---------|----------|
| `supervisor start` | Start project-local supervisor (or no-op if already running with matching version) |
| `supervisor stop` | Fire-and-forget: send shutdown request, receive ack, return immediately (~100ms) |
| `supervisor stop --wait` | Send shutdown, then poll every 1s until stopped or 30s timeout |
| `supervisor status` | Check if running and ping for responsiveness |
| `supervisor kill` | SIGKILL project-local supervisor (no graceful shutdown) |
| `supervisor kill-all` | SIGKILL all supervisors across all projects |

**Stop Protocol**: The `stop` command uses an ack-then-terminate protocol to avoid deadlock:
1. Client sends `shutdown` IPC request
2. Supervisor returns `{ status: 'stopping' }` immediately
3. Client closes connection and returns
4. Supervisor self-terminates via `setImmediate()` after response is sent

This prevents the previous deadlock where `server.close()` waited for client to disconnect while client waited for response.

**Stop --wait Timeout**: If supervisor doesn't stop within 30s, CLI warns and advises using `kill`:
```
Warning: Supervisor did not stop within timeout
Use "sidekick supervisor kill" to forcefully terminate
```
Exit code is 1 on timeout.

### 7.2 PID File Management

The CLI includes `--kill` and `--kill-all` switches. This requires tracking supervisors at user level:
- Project-level: `<project>/.sidekick/supervisor.pid` (simple PID number)
- User-level: `~/.sidekick/supervisors/{hash}.pid` (JSON with PID, project path, start time)

When a supervisor process ends, it should clean up its own PID files (project- and user-level).

## 8. Telemetry & Logging Bootstrap

### 8.1 Two-Phase Initialization

**Phase 1: Pre-Config (Minimal Logger)**
- Initialize basic console logger with hardcoded defaults:
  - Level: `WARN`
  - Format: Simple text (timestamp + level + message)
  - Destination: `stderr`
- Used during: arg parsing, config loading, error reporting.

**Phase 2: Post-Config (Full Pino Logger)**
- Replace minimal logger with full `pino` instance configured from loaded config.
- **Destination**: `<project-dir>/.sidekick/sessions/{session_id}/cli.log` (rotated).
- Respects user settings: log level, format, redaction rules.
- Logger facade ensures transparent transition (code doesn't need to know which phase).

### 8.2 Logger Facade

```typescript
// Simplified interface
interface Logger {
  debug(msg: string, meta?: object): void;
  info(msg: string, meta?: object): void;
  warn(msg: string, meta?: object): void;
  error(msg: string, meta?: object): void;
}

// Implementation swaps from console → pino after config load
```

### 8.3 Hook Invocation Events

To support the Monitoring UI, the CLI emits **Entity-Lifecycle events** (see `LLD-STRUCTURED-LOGGING.md`) for every hook invocation:

```json
// Hook invocation received
{
  "source": "sidekick-cli",
  "pid": 12345,
  "context": {
    "session_id": "sess-abc",
    "hook": "UserPromptSubmit"
  },
  "entity": "hook",
  "entity_id": "hook-001",
  "lifecycle": "received",
  "metadata": {
    "hook_event_name": "UserPromptSubmit",
    "cwd": "/workspaces/project",
    "mode": "hook"
  }
}
```

```json
// Hook invocation completed
{
  "source": "sidekick-cli",
  "pid": 12345,
  "context": {
    "session_id": "sess-abc",
    "hook": "UserPromptSubmit"
  },
  "entity": "hook",
  "entity_id": "hook-001",
  "lifecycle": "completed",
  "metadata": {
    "duration_ms": 45,
    "execution_model": "sync"
  }
}
```

- **Level**: `INFO`
- **Timing**: `received` emitted immediately after Phase 2 logger initialization; `completed` emitted after handler finishes.
- **Correlation**: The `entity_id` links hook invocation to any resulting tasks in the Supervisor via `trace_id`.

## 9. Process Model for Hooks

### 9.1 Hook Execution Strategy

Hooks declare their execution model during registration:

```typescript
interface HookDefinition {
  name: string;
  executionModel: 'sync' | 'async';
  timeout?: number; // milliseconds
}
```

**Synchronous Hooks** (e.g., `statusline`, `session-start`):
- Run **in-process** within CLI.
- Strict timeout enforcement (default: 50ms for statusline, session-start, 500ms for others).
- If timeout exceeded: log warning - in future we might log as error and return fallback response.

**Asynchronous Hooks** (e.g., `session-summary`, `resume-generation`):
- **Always delegate to supervisor** via IPC.
- CLI enqueues task and returns immediately.
- Supervisor processes task in background.
- Results written to state files (`.sidekick/sessions/{session_id}/*.json`).

### 9.2 Timeout Behavior

- API calls, file locks - these need declared timeouts and explicit fallback or fail modes.
- Supervisor enforces resource limits (max concurrent tasks).
- See Supervisor Lifecycle Management section above for supervisor's process idle timeout.
