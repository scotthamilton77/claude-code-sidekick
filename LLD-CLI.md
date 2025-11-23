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

### 3.1 Execution Modes

The CLI operates in two distinct modes, determined by flags or invocation context:

1.  **Interactive Mode** (Default):

    - **Output**: Rich text, colors, spinners, human-readable errors.
    - **Behavior**: Can prompt for user input, show progress bars.
    - **Use Case**: Manual user interaction (e.g., `npx @sidekick/cli status`).

2.  **Hook Mode** (`--hook` flag):
    - **Output**: Strict, machine-parsable (often silent or specific JSON format required by Claude).
    - **Behavior**: Non-interactive, fail-fast, minimal latency.
    - **Use Case**: Automated calls from Claude Desktop (e.g., `npx @sidekick/cli session-start --hook`).

### 3.2 Pluggable Command Registry

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

### 3.3 Bootstrap Sequence

1.  **Parse Args**: Identify mode and requested command.
2.  **Init Core**: Load `sidekick-core` (Config, Logger).
3.  **Resolve Scope**: Detect whether invocation is project (`.claude/hooks/sidekick/`) or user (`~/.claude/hooks/sidekick/`) scoped and locate the correct asset/config roots.
4.  **Supervisor Handshake**: Establish IPC with the background supervisor (start if missing) before feature registration so shared clients exist in the command context.
5.  **Load Features**: Scan `packages/` or config to find enabled features.
6.  **Register Commands**: Invoke `register()` on each active feature.
7.  **Dispatch**: Find the matching command(s) and execute.

### 3.4 Hook Dispatcher

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

## 6. Outstanding Questions / Concerns

- **Scope Resolution**: Need explicit algorithm for locating `.claude` vs `~/.claude` installs when both exist—especially for `npx` use inside nested workspaces.
- **Supervisor Lifecycle**: Define when the CLI restarts the supervisor after hook updates (ties into "claude --continue" requirement from `AGENTS.md`).
- **Telemetry Bootstrapping**: Clarify whether CLI initializes telemetry before config load (minimal logger) or after (full `pino` stream).
- **Process Model**: Decide if long-running hooks should spawn worker processes via supervisor vs staying in-process with async tasks to avoid blocking the CLI event loop.
