# Sidekick Target Architecture

This document defines the target state for the Sidekick Node.js rewrite. It establishes a clean, modular, and observable runtime that resolves existing limitations while maintaining strict backward compatibility with user workflows.

**This is an executive summary**. Each section references detailed Low-Level Design (LLD) documents for implementation specifics.

## 1. Guiding Principles

- **Simplicity & Standard Tooling**:
  - **Stack**: Node 20+, pnpm workspaces, strict TypeScript, Vitest, eslint/prettier.
  - **No Unnecessary Code**: Do not wrap open-source implementations unless strictly necessary.
  - **SOLID/DRY**: Enforce file size limits (500 lines) and method size limits (20 lines) to prevent complexity creep.
- **Node-First Runtime**: The primary runtime for CLI, orchestration, and hooks is TypeScript/Node.js. Python is reserved strictly for developer tooling (one-off analyzers, data prep) and never as a deployed dependency.
- **Observability-First**: Use `pino` + telemetry wrapper from day one. Separate log files for CLI and Supervisor enable unified debugging via the Monitoring UI.
- **Dual-Scope Parity**: Behavior must be identical in User (`~/.claude`) and Project (`.claude`) scopes. Preserve the existing cascade (user/project installed vs. persistent) through the asset resolver.
- **Feature Modularity**: Preserve plugin-style independence. Features must explicitly register dependencies and config-driven toggles.
- **Shared Assets Policy**: Defaults (prompts, schemas, templates) live in `assets/sidekick/` so both Node runtime and Python tools share canonical sources.

## 2. Workspace Layout

The system is organized as a monorepo with a clear distinction between runtime packages and static assets.

### 2.1 Package Structure (`packages/`)

```
packages/
├── sidekick-core/          # Shared runtime library (see docs/design/CORE-RUNTIME.md)
├── sidekick-cli/           # CLI entry + hook commands (see docs/design/CLI.md)
├── sidekick-supervisor/    # Background process for async work (see docs/design/SUPERVISOR.md)
├── sidekick-ui/            # Monitoring UI for debugging (see packages/sidekick-ui/docs/MONITORING-UI.md)
├── feature-session-summary/# Session summary feature (see docs/design/FEATURE-SESSION-SUMMARY.md)
├── feature-reminders/      # Reminder system (see docs/design/FEATURE-REMINDERS.md)
├── feature-statusline/     # Statusline rendering (see docs/design/FEATURE-STATUSLINE.md)
├── feature-resume/         # Resume message generation (see docs/design/FEATURE-RESUME.md)
├── shared-providers/       # LLM provider adapters (see docs/design/LLM-PROVIDERS.md)
├── testing-fixtures/       # Shared test infrastructure (see docs/design/TEST-FIXTURES.md)
└── types/                  # Shared TypeScript types + Zod schemas (see docs/design/SCHEMA-CONTRACTS.md)
```

### 2.2 Interface Contracts

- **Feature Packages**: Must expose a standard interface `register(context)` and ship compiled JS ready for dynamic loading.
- **Schema Contracts**: Publishes generated TypeScript types plus JSON Schema artifacts. Python tools import JSON Schema directly from `assets/sidekick/schemas`.

### 2.3 Static Assets (`assets/sidekick/`)

- **Authoritative Location**: Contains all shipped defaults—prompts (`prompts/*.prompt.txt`), schemas (`schemas/*.json`), reminders (`reminders/*.yaml`), and templates.
- **Monorepo Lockstep**: `assets/sidekick` represents the current development state (HEAD). Compatibility is enforced by `packages/types` (Zod/TS types) during the build.
- **Runtime Access**: `sidekick-core` exposes helpers (`assetResolver.resolve(...)`) that read from assets by default, respecting the cascade. See **docs/design/CORE-RUNTIME.md §3.3** for cascade order.

## 3. Runtime Architecture

### 3.1 Hook Wrapper Architecture

Hooks configured in Claude Code's `settings.json` are **bash scripts** installed to `.claude/hooks/sidekick/` (project-scope) or `~/.claude/hooks/sidekick/` (user-scope). These bash scripts:

1. Extract their own location using bash introspection.
2. Access Claude Code environment including `$CLAUDE_PROJECT_DIR`.
3. Forward explicit parameters to the Node.js CLI (`--hook-script-path`, `--project-dir`).
4. Invoke the Node.js CLI via `npx @sidekick/cli` or global install.

This decouples Claude Code's hook registration from the Node.js runtime. See **docs/design/CLI.md §3.1** for details.

### 3.2 CLI/Supervisor Relationship

The CLI and Supervisor operate as **separate processes** with distinct responsibilities:

| Component      | Responsibilities                                                     | Log File                        |
| -------------- | -------------------------------------------------------------------- | ------------------------------- |
| **CLI**        | Synchronous hook responses, reads staged files, logs events          | `.sidekick/logs/cli.log`        |
| **Supervisor** | Async background work (LLM calls, transcript analysis), stages files | `.sidekick/logs/supervisor.log` |

**Communication**: CLI sends events to Supervisor via IPC (fire-and-forget). Supervisor "responds" by staging files that CLI reads on subsequent hook invocations.

See **docs/design/flow.md §2.1** for the complete interaction model.

### 3.3 Event Model

The system uses a **unified event model** with discriminated unions:

- **Hook Events**: External events from Claude Code (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`, `SessionEnd`)
- **Transcript Events**: Internal events from TranscriptService (`UserPrompt`, `AssistantMessage`, `ToolCall`, `ToolResult`, `Compact`)

Both event types flow through a unified **HandlerRegistry** with filter-based registration. Handlers specify which events they process via `{ kind: 'hook', hooks: [...] }` or `{ kind: 'transcript', eventTypes: [...] }`.

See **docs/design/flow.md §3** for complete event schema and **docs/design/CORE-RUNTIME.md §3.5** for handler registration API.

### 3.4 TranscriptService

The **TranscriptService** is the single source of truth for transcript-derived metrics:

- Watches the Claude Code transcript file for changes
- Derives metrics incrementally (turn count, tool count, tokens, tools-this-turn)
- Emits `TranscriptEvent` entries to the HandlerRegistry
- Manages compaction history for Monitoring UI time-travel

Features consume metrics via `ctx.transcript.getMetrics()` rather than maintaining independent counters.

See **docs/design/TRANSCRIPT-PROCESSING.md** for complete specification.

### 3.5 Staging Pattern

The Supervisor prepares future CLI actions by staging files. This decouples async Supervisor work from sync CLI responses.

**Staging Directory**: `.sidekick/sessions/{session_id}/stage/{hook_name}/`

```
.sidekick/sessions/{session_id}/
├── stage/                    # Reminder staging (CLI reads these)
│   ├── UserPromptSubmit/
│   ├── PreToolUse/
│   └── Stop/
├── state/                    # Persistent state files
│   ├── session-summary.json
│   └── session-state.json
└── transcripts/              # Pre-compact snapshots (for Monitoring UI)
```

See **docs/design/flow.md §2.2** for staging semantics and **docs/design/FEATURE-REMINDERS.md §3.3** for reminder file schema.

### 3.6 Configuration Cascade

Configuration uses **YAML** for domain-specific files with a bash-style `sidekick.config` for quick overrides.

**Domain Files**: `config.yaml`, `llm.yaml`, `transcript.yaml`, `features.yaml`

**Cascade Order** (lowest to highest priority):

1. Internal Defaults
2. Environment Variables (`SIDEKICK_*`) + `.env` files
3. User Unified Config (`~/.sidekick/sidekick.config`)
4. User Domain Config (`~/.sidekick/{domain}.yaml`)
5. Project Unified Config (`.sidekick/sidekick.config`)
6. Project Domain Config (`.sidekick/{domain}.yaml`)
7. Project-Local Overrides (`.sidekick/{domain}.yaml.local`)

See **docs/design/CONFIG-SYSTEM.md** for complete schema and merge semantics.

### 3.7 Background Supervisor

- **Architecture**: A detached Node.js process acts as the background supervisor.
- **Scope**: Supervisor is **always project-scoped** (`.sidekick/supervisor.pid`).
- **IPC**: Unix domain sockets (`.sidekick/supervisor.sock`) with **Newline-Delimited JSON (NDJSON)** protocol. Auth via shared token (`.sidekick/supervisor.token`).
- **Single Writer**: Acts as the single writer for shared state files using atomic writes (temp file + `mv`).

See **docs/design/SUPERVISOR.md** for lifecycle management, handler execution, and task queue.

### 3.8 LLM Providers & Telemetry

- **Providers**: `shared-providers` offers typed adapters for Claude CLI, OpenAI, OpenRouter, and custom commands, with retry logic and fallback chains.
- **Telemetry**: Implemented as a lightweight wrapper around `pino` logging, emitting metric events into the structured log stream.

See **docs/design/LLM-PROVIDERS.md** for provider architecture and **docs/design/STRUCTURED-LOGGING.md** for telemetry schema.

## 4. Installation & Distribution

- **Hook Installation**: Installer creates bash wrapper scripts in `.claude/hooks/sidekick/` (project) or `~/.claude/hooks/sidekick/` (user).
- **Node.js Runtime Distribution**:
  - **Default**: `npx @sidekick/cli <hook>` inside a project (project-scoped).
  - **Optional**: `npm i -g @sidekick/cli` for user-scope hooks.
- **Dual-Scope Configs**: `.sidekick/` and `~/.sidekick/` store overrides, logs, and sessions. The Node runtime reads/writes identical paths to maintain manual workflow compatibility.

## 5. Testing & Validation Strategy

- **Unit Tests**: Each package includes Vitest suites. `sidekick-core` covers config, cascade, and providers.
- **Integration Tests**: Run the Node CLI against recorded transcripts from `test-data/` and diff outputs with expected results.
- **Test Fixtures**: Shared mocks (`MockLLMService`, `MockHandlerRegistry`, `MockTranscriptService`, `MockStagingService`), factories for events/reminders/metrics, and harnesses for CLI and Supervisor testing.

See **docs/design/TEST-FIXTURES.md** for complete testing infrastructure.

## 6. LLD Reference Index

| Document                                       | Scope                                                                                          |
| ---------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| **docs/design/flow.md**                        | Event model, hook flows, handler registration, staging pattern (architectural source of truth) |
| **docs/design/CORE-RUNTIME.md**                | RuntimeContext, services, feature registration, bootstrap sequence                             |
| **docs/design/CLI.md**                         | CLI framework, hook dispatcher, scope resolution, supervisor lifecycle                         |
| **docs/design/SUPERVISOR.md**                  | Background process, IPC, state management, task execution                                      |
| **docs/design/CONFIG-SYSTEM.md**               | Configuration cascade, YAML schemas, domain separation                                         |
| **docs/design/TRANSCRIPT-PROCESSING.md**       | TranscriptService, metrics ownership, compaction handling                                      |
| **docs/design/STRUCTURED-LOGGING.md**          | Pino logging, event schema, redaction, log rotation                                            |
| **docs/design/SCHEMA-CONTRACTS.md**            | Zod schemas, JSON Schema generation, type contracts                                            |
| **docs/design/LLM-PROVIDERS.md**               | Provider adapters, retry/fallback, observability                                               |
| **docs/design/FEATURE-REMINDERS.md**           | Reminder handlers, staging, suppression pattern                                                |
| **docs/design/FEATURE-SESSION-SUMMARY.md**     | Summary generation, bookmark system, snarky messages                                           |
| **docs/design/FEATURE-STATUSLINE.md**          | Statusline rendering, state consumption                                                        |
| **docs/design/FEATURE-RESUME.md**              | Resume message generation, artifact discovery                                                  |
| **docs/design/TEST-FIXTURES.md**               | Mocks, factories, test harnesses                                                               |
| **packages/sidekick-ui/docs/MONITORING-UI.md** | Time-travel debugging UI, log aggregation                                                      |
