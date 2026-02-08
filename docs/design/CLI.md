# CLI & Hooks Framework Design

## 1. Core Philosophy

The `sidekick-cli` is a **thin, pluggable framework**. It does not contain business logic. Instead, it provides the scaffolding for:

1.  Bootstrapping the runtime.
2.  Loading features dynamically.
3.  Dispatching execution to registered commands.
4.  Handling output formatting based on the execution mode (Interactive vs. Hook).

**Related Documents**:
- `docs/design/flow.md`: Authoritative source for event model, hook flows, and CLI/Daemon interaction patterns
- `docs/design/TRANSCRIPT-PROCESSING.md`: TranscriptService, compaction handling, metrics ownership
- `docs/design/DAEMON.md`: Daemon lifecycle, handler registration, transcript integration
- `docs/design/STRUCTURED-LOGGING.md`: Logging architecture and event schemas

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

Claude Code invokes hooks with a JSON structure passed via stdin. The structure varies by hook type but always includes core context fields.

**Reference**: See [Claude Code Hooks Documentation](https://code.claude.com/docs/en/hooks) for the authoritative specification.

**Common Fields** (all hooks):
- `session_id` (string): Unique identifier for the current Claude session
- `transcript_path` (string): Absolute path to the session transcript file
- `cwd` (string, optional): Current working directory (not present in Stop, SessionStart)
- `permission_mode` (string): Current permission level ("default", "plan", "acceptEdits", "bypassPermissions")
- `hook_event_name` (string): Name of the triggered hook (e.g., "UserPromptSubmit", "SessionStart")

**Hook-Specific Fields**:

| Hook | Additional Fields |
|------|-------------------|
| `UserPromptSubmit` | `prompt` (string) - the user's message |
| `PreToolUse` | `tool_name`, `tool_input` (object), `tool_use_id` |
| `PostToolUse` | `tool_name`, `tool_input`, `tool_response` (object), `tool_use_id` |
| `Stop` / `SubagentStop` | `stop_hook_active` (boolean) - true if continuing from previous stop |
| `SessionStart` | `source` ("startup", "resume", "clear", "compact") |
| `SessionEnd` | `reason` ("exit", "clear", "logout", "prompt_input_exit", "other") |
| `PreCompact` | `trigger` ("manual", "auto"), `custom_instructions` (string) |
| `Notification` | `message` (string), `notification_type` (string) |
| `StatusLine` | (no additional fields) |

**Type Definitions**: See `@sidekick/types` package (`packages/types/src/hook-input.ts`) for Zod schemas.

**Session ID Extraction**: The CLI extracts `session_id` directly from the hook input JSON. This is the authoritative session identifier used for:
- Correlating logs and events
- Organizing session state files (`.sidekick/sessions/{session_id}/`)
- Daemon task tracking and routing

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
5.  **Daemon Handshake**:
    - Check for existing daemon (PID file + socket).
    - Verify version compatibility via IPC ping.
    - Start daemon if missing or restart if version mismatch.
    - Establish IPC connection.
    - See `docs/design/flow.md` §5.1 (SessionStart) for the full daemon initialization flow.
6.  **Load Features**: Scan `packages/` or config to find enabled features.
7.  **Register Commands**: Invoke `register()` on each active feature.
8.  **Dispatch**: Find the matching command(s) and execute. See §9 for hook execution model.

### 3.5 Hook Dispatcher

The CLI owns hook dispatch so there is a single entry point for Claude Desktop integrations:

1.  **Hook Table**: Generated at runtime from enabled features (e.g., `session-start`, `user-prompt-submit`, `statusline`).
2.  **Context Builder**: Injects resolved scope paths, config snapshot, IPC client, telemetry logger, and feature-specific settings.
3.  **Deterministic Output**: Each hook declares whether it emits JSON, NDJSON, or raw text to prevent breaking the Claude protocol.
4.  **Latency Budget**: Dispatcher warns on violated hook-specific SLAs (statusline <50 ms, summaries delegated to daemon).

## 4. Daemon Interaction

The CLI framework provides a shared **IPC Client** helper that commands can use.

- **Abstracts**: Connection logic, retries, and error handling.
- **Usage**: Commands simply call `ctx.ipc.send('task_name', payload)`.

## 5. Error Handling

- **Interactive**: Print friendly error message to `stderr`.
- **Hook**: Log full error to file, exit with code 1 (or 0 if failure should be silent), print minimal/no output to `stderr` to avoid breaking the calling process.

## 6. Project Root Resolution

The CLI determines the project root from the `--project-dir` parameter, which is forwarded from Claude Code's `$CLAUDE_PROJECT_DIR` environment variable by the bash hook wrapper.

**Resolution**:
- If `--project-dir` is provided: Resolve to absolute path and use as project root.
- If not provided: Project root is undefined (graceful degradation).

**Usage**:
- All project-local data is stored under `<project-root>/.sidekick/`.
- Daemon is always project-scoped with PID file at `<project-root>/.sidekick/sidekickd.pid`.

**Note**: Claude Code handles hook deduplication via the `$CLAUDE_PROJECT_DIR` environment variable, so Sidekick does not need to implement dual-install detection.

## 7. Daemon Lifecycle Management

Daemon process should self-terminate after a configurable idle timeout (default: 5 minutes). Configure via `daemon.idleTimeoutMs` in config; set to `0` to disable.

### 7.1 CLI Commands

| Command | Behavior |
|---------|----------|
| `daemon start` | Start project-local daemon (or no-op if already running with matching version) |
| `daemon stop` | Fire-and-forget: send shutdown request, receive ack, return immediately (~100ms) |
| `daemon stop --wait` | Send shutdown, then poll every 1s until stopped or 30s timeout |
| `daemon status` | Check if running and ping for responsiveness |
| `daemon kill` | SIGKILL project-local daemon (no graceful shutdown) |
| `daemon kill-all` | SIGKILL all daemons across all projects |

**Stop Protocol**: The `stop` command uses an ack-then-terminate protocol to avoid deadlock:
1. Client sends `shutdown` IPC request
2. Daemon returns `{ status: 'stopping' }` immediately
3. Client closes connection and returns
4. Daemon self-terminates via `setImmediate()` after response is sent

This prevents the previous deadlock where `server.close()` waited for client to disconnect while client waited for response.

**Stop --wait Timeout**: If daemon doesn't stop within 30s, CLI warns and advises using `kill`:
```
Warning: Daemon did not stop within timeout
Use "sidekick daemon kill" to forcefully terminate
```
Exit code is 1 on timeout.

### 7.2 PID File Management

The CLI includes `--kill` and `--kill-all` switches. This requires tracking daemons at user level:
- Project-level: `<project>/.sidekick/sidekickd.pid` (simple PID number)
- User-level: `~/.sidekick/daemons/{hash}.pid` (JSON with PID, project path, start time)

When a daemon process ends, it should clean up its own PID files (project- and user-level).

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
- **Destination**: `<project-dir>/.sidekick/logs/cli.log` (rotated). See `docs/design/STRUCTURED-LOGGING.md` for rotation policy.
- **Session Correlation**: Each log record includes `context.session_id` for filtering/aggregation.
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

The CLI emits `SidekickEvent` records (see `docs/design/flow.md` §3.2) for every hook invocation:

```json
// Hook invocation received
{
  "type": "HookReceived",
  "time": 1678888888888,
  "source": "cli",
  "context": {
    "session_id": "sess-abc123",
    "correlation_id": "corr-456",
    "hook": "UserPromptSubmit"
  },
  "payload": {
    "metadata": {
      "cwd": "/workspaces/project",
      "mode": "hook"
    }
  }
}
```

```json
// Hook invocation completed
{
  "type": "HookCompleted",
  "time": 1678888888900,
  "source": "cli",
  "context": {
    "session_id": "sess-abc123",
    "correlation_id": "corr-456",
    "trace_id": "req-789",
    "hook": "UserPromptSubmit"
  },
  "payload": {
    "state": { "reminder_returned": true },
    "metadata": { "duration_ms": 12 }
  }
}
```

- **Level**: `INFO`
- **Timing**: `HookReceived` emitted immediately after Phase 2 logger initialization; `HookCompleted` emitted after all CLI handlers finish.
- **Correlation**: The `correlation_id` is unique per CLI invocation. The `trace_id` links causally-related events across CLI and Daemon.

## 9. Process Model for Hooks

The CLI's role in hook processing is defined by `docs/design/flow.md`. This section describes how the CLI implements that model.

### 9.1 Hook Execution Flow

All hooks follow the same execution pattern (see `docs/design/flow.md` §5 for complete flows):

1. **Receive Hook**: Claude Code invokes bash wrapper → CLI receives hook input
2. **Send Event**: CLI sends hook event to Daemon via IPC (fire-and-forget)
3. **Run CLI Handlers**: CLI executes its own registered handlers synchronously
4. **Return Response**: CLI returns JSON response to Claude Code

The Daemon performs background work asynchronously. Its results are staged as files (see `docs/design/flow.md` §2.2) for the CLI to consume on subsequent hook invocations.

### 9.2 CLI Handler Registration

CLI handlers register with explicit priority for execution ordering:

```typescript
interface CliHandlerDefinition {
  name: string;
  hook: string; // Which hook this handler responds to
  priority: number; // Higher = runs first
  handler: (ctx: HookContext) => Promise<HookResult>;
}
```

**Example CLI handlers** (see `docs/design/flow.md` §5 for which hooks invoke which handlers):
- `InjectUserPromptSubmitReminders`: Consumes staged reminders from `stage/UserPromptSubmit/`
- `InjectPreToolUseReminders`: Consumes staged reminders from `stage/PreToolUse/`
- `InjectStopReminders`: Consumes staged reminders from `stage/Stop/`

### 9.3 Timeout & SLA Enforcement

- **StatusLine**: 50ms target (strict—affects terminal responsiveness)
- **Other Hooks**: 500ms default (log warning if exceeded)
- **Timeout exceeded**: Log warning, return fallback/empty response
- **Daemon IPC**: Fire-and-forget, does not block CLI response

### 9.4 Staged File Consumption

The CLI consumes files staged by the Daemon (see **docs/design/flow.md §4.3** for full algorithm):

1. Check for `.suppressed` marker in `.sidekick/sessions/{session_id}/stage/{hook_name}/`
2. If marker exists: delete marker, return empty (suppression cleared)
3. Scan `.sidekick/sessions/{session_id}/stage/{hook_name}/*.json`
4. Sort by `priority` (descending)
5. Take highest priority reminder
6. Delete file if `persistent: false`
7. Return reminder fields in hook response (`blocking`, `reason`, `additionalContext`, etc.)

### 9.5 PreCompact Transcript Capture

The PreCompact hook is an **exception** to the "thin CLI" principle. The CLI performs synchronous transcript capture because the transcript file is modified immediately after Claude Code receives the hook response.

**Flow** (see `docs/design/flow.md` §5.6 for complete sequence):

1. **CLI receives PreCompact hook** with `transcript_path` in payload.
2. **CLI copies full transcript file** to `.sidekick/sessions/{session_id}/transcripts/pre-compact-{timestamp}.jsonl`.
3. **CLI sends PreCompact event** to Daemon with `transcriptSnapshotPath` reference.
4. **CLI returns `{}`** to Claude Code immediately.
5. **Daemon handler** invokes `TranscriptService.capturePreCompactState(snapshotPath)`.
6. **Claude Code proceeds** with compaction.
7. **TranscriptService** detects shortened transcript on next file change → triggers full recompute.

**Implementation Notes**:

```typescript
// In CLI PreCompact handler
async function handlePreCompact(ctx: HookContext): Promise<HookResult> {
  const { transcript_path, session_id } = ctx.input;
  const timestamp = Date.now();

  // Synchronous copy - MUST complete before returning
  const snapshotPath = path.join(
    ctx.paths.sessions,
    session_id,
    'transcripts',
    `pre-compact-${timestamp}.jsonl`
  );
  await fs.mkdir(path.dirname(snapshotPath), { recursive: true });
  await fs.copyFile(transcript_path, snapshotPath);

  // Fire-and-forget to Daemon with snapshot reference
  ctx.ipc.send('PreCompact', {
    ...ctx.input,
    transcriptSnapshotPath: snapshotPath
  });

  return { response: {} };
}
```

**Rationale for CLI-side capture**:
- **Timing**: Must capture before Claude Code modifies the file (cannot delegate to async Daemon).
- **Monitoring UI**: Requires actual transcript content for time-travel debugging, not just metrics.
- **Reliability**: Synchronous copy ensures no race condition with compaction.
