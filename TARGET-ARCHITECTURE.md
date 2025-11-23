# Sidekick Target Architecture

This document defines the target state for the Sidekick Node.js rewrite. It establishes a clean, modular, and observable runtime that resolves existing limitations while maintaining strict backward compatibility with user workflows.

## 1. Guiding Principles

- **Simplicity & Standard Tooling**:
  - **Stack**: Node 20+, pnpm workspaces, strict TypeScript, Vitest, eslint/prettier.
  - **No Unnecessary Code**: Do not wrap open-source implementations unless strictly necessary.
  - **SOLID/DRY**: Enforce file size limits (500 lines) and method size limits (20 lines) to prevent complexity creep.
- **Node-First Runtime**: The primary runtime for CLI, orchestration, and hooks is TypeScript/Node.js. Python is reserved strictly for developer tooling (one-off analyzers, data prep) and never as a deployed dependency.
- **Reuse Benchmark-Next Core**: The `src/lib/` directory in `benchmark-next` becomes the shared core (`sidekick-core`), providing production-ready implementations for LLM providers, configuration, logging, and transcript processing.
- **Observability-First**: Use `pino` + telemetry wrapper from day one. The supervisor acts as the single writer for state to eliminate file locking/race issues.
- **Dual-Scope Parity**: Behavior must be identical in User (`~/.claude`) and Project (`.claude`) scopes. Preserve the existing cascade (user/project installed vs. persistent) through the asset resolver.
- **Feature Modularity**: Preserve plugin-style independence. Features must explicitly register dependencies and config-driven toggles.
- **Shared Assets Policy**: Defaults (prompts, schemas) live in `assets/sidekick/` so both Node runtime and Python tools share canonical sources.

## 2. Workspace Layout

The system is organized as a monorepo with a clear distinction between runtime packages and static assets.

### 2.1 Package Structure (`packages/`)

The `pnpm-workspace.yaml` at the root lists all packages plus `benchmark-next` to ensure consistent tooling.

```
packages/
├── sidekick-core/          # Shared runtime library (config cascade, logging, feature graph, LLM providers)
├── sidekick-cli/           # CLI entry + hook commands (session-start, user-prompt-submit, statusline)
├── feature-session-summary/# Feature implementation packages (one per major feature)
├── feature-reminders/
├── feature-statusline/
├── feature-resume/
├── shared-providers/       # Provider SDK adapters, retry/circuit breaker primitives
├── schema-contracts/       # Type-safe definitions + Zod schemas for transcripts, prompts, reminder payloads
└── testing/fixtures/       # Shared mocks, golden transcripts, CLI harness
```

### 2.2 Interface Contracts

- **Feature Packages**: Must expose a standard interface `registerHooks(registry)` and ship compiled JS ready for dynamic loading.
- **Schema Contracts**: Publishes generated TypeScript types plus JSON Schema artifacts. Python tools import JSON Schema directly from `assets/sidekick/schemas`.

### 2.3 Static Assets (`assets/sidekick/`)

- **Authoritative Location**: Contains all shipped defaults—prompts (`prompts/*.prompt.txt`), schemas (`schemas/*.json`), and templates.
- **Monorepo Lockstep**: `assets/sidekick` represents the current development state (HEAD). Compatibility is enforced by `packages/schema-contracts` (Zod/TS types) during the build.
- **Runtime Access**: `sidekick-core` exposes helpers (`assetResolver.resolve(...)`) that read from assets by default, respecting the canonical cascade (lowest → highest priority): `assets/sidekick/` → user-installed assets (global hooks) → user-persistent overrides (`~/.sidekick/assets/`) → project-installed assets (`.claude/hooks/sidekick/assets/` or `node_modules/@sidekick/assets/`) → project-persistent overrides (`.sidekick/assets/`) → project-local `.sidekick/assets.local/`.
- **Dev Tools**: Python scripts read directly from `assets/sidekick/` to ensure they use the same defaults as the runtime, ignoring cascade layers unless explicitly configured.

## 3. Runtime Architecture

### 3.1 Hook Wrapper Architecture

**Important**: Hooks configured in Claude Code's `settings.json` are **bash scripts** installed to `.claude/hooks/sidekick/` (project-scope) or `~/.claude/hooks/sidekick/` (user-scope). These bash scripts:

1. **Extract their own location** using bash introspection (`$BASH_SOURCE`, `$0`).
2. **Access Claude Code environment** including `$CLAUDE_PROJECT_DIR`.
3. **Forward explicit parameters** to the Node.js CLI:
   - `--hook-script-path`: Absolute path of the bash script (enables deterministic scope detection).
   - `--project-dir`: Value of `$CLAUDE_PROJECT_DIR` (explicit project context).
   - Hook-specific JSON payload via stdin or `--input` flag.
4. **Invoke the Node.js CLI** via `npx @sidekick/cli` or global install.

This architecture decouples Claude Code's hook registration from the Node.js runtime implementation, providing portability and explicit scope hints.

### 3.2 Bootstrap Flow

1.  **Initialize**: Parse argv (including `--hook-script-path` and `--project-dir` from bash wrapper), read stdin, initialize minimal logger (Phase 1: console-based).
2.  **Scope Resolution**:
    - **Primary**: Use `--hook-script-path` parameter to extract scope (project vs. user) and project root directory.
    - **Validation**: Compare `--project-dir` with project root extracted from `--hook-script-path`; log warning if mismatch.
    - **Fallback**: If no explicit hints provided (manual invocation), walk up from `cwd` to find nearest `.claude/hooks/sidekick/`.
    - **Dual-Install Detection**: If running from user-scope, check project's `.claude/settings.json` and `.claude/settings.json.local` for `sidekick` string. If found, log warning to project logs and exit (project-scope takes precedence).
3.  **Runtime Instantiation**: Instantiate `sidekick-core` with dependencies (feature registry, provider adapters, asset resolver). Initialize full logger (Phase 2: `pino` with config-driven settings).
4.  **Supervisor Handshake**: Check supervisor PID/socket, verify version compatibility, start/restart as needed.
5.  **Feature Graph Validation**: The runtime performs a DAG validation during startup to ensure all declared dependencies are met, mirroring Bash's loader but with compile-time types.

### 3.3 Configuration Cascade

- **Canonical Order**: The loader applies layers from lowest to highest priority: internal defaults → environment variables (`SIDEKICK_*`) → user global JSONC (`~/.sidekick/*.jsonc`) → project JSONC (`.sidekick/*.jsonc`) → project-local `.local` variants (e.g., `.sidekick/config.jsonc.local`). Later layers override earlier ones for primitives/arrays while objects are deep-merged.
- **Environment Variables**: `.env` files are read before JSONC configs using the same precedence: `~/.sidekick/.env` → project `.env` → `.sidekick/.env.local`, with later files overriding previously loaded values.
- **Format**: JSONC (JSON with comments) is the strict standard.
- **Validation**: Zod schemas ensure type safety and fail-fast validation at runtime.
- **Migration**: A standalone utility will convert legacy shell-style `.conf` files to JSONC.

### 3.4 Background Supervisor

- **Architecture**: A detached Node.js process acts as the background supervisor/event loop.
- **Scope**: Supervisor is **always project-scoped** (`.sidekick/supervisor.pid`). User-scope hooks delegate to project supervisor when dual-install detected.
- **Lifecycle**: 
  - CLI checks supervisor existence via PID file + socket.
  - **Version-based restart**: CLI sends version in IPC handshake; if mismatch, gracefully shuts down supervisor (30s timeout for in-flight tasks), saves state, and starts new version.
  - **Single instance**: PID file acts as lock; prevents multiple supervisors per project.
- **Responsibility**: Handles compute-heavy tasks (resume generation, session summary updates) asynchronously.
- **Single Writer**: Acts as the **single writer** for shared state files (`.sidekick/state/*.json`) using atomic writes (temp file + `mv`). The CLI reads these files directly (no IPC needed) for synchronous hooks (statusline) but delegates mutations to the supervisor via IPC.
- **IPC**: Unix domain sockets (`.sidekick/supervisor.sock`) with JSON-RPC 2.0 protocol. Auth via shared token (`.sidekick/supervisor.token`).

### 3.5 LLM Providers & Telemetry

- **Providers**: `shared-providers` offers typed adapters for Claude CLI, OpenAI, OpenRouter, and custom commands, leveraging async/await and circuit breakers.
- **Telemetry**: Implemented as a lightweight wrapper around `pino` logging, emitting metric events (counters, timers) into the structured log stream.

## 4. Installation & Distribution

- **Hook Installation**: Installer creates **bash wrapper scripts** in `.claude/hooks/sidekick/` (project-scope) or `~/.claude/hooks/sidekick/` (user-scope). These scripts:
  - Extract their own location via `$BASH_SOURCE`.
  - Forward `$CLAUDE_PROJECT_DIR` from Claude Code's environment.
  - Invoke the Node.js CLI with explicit `--hook-script-path` and `--project-dir` parameters.
- **Node.js Runtime Distribution**:
  - **Default Usage**: `npx @sidekick/cli <hook>` inside a project. Keeps the runtime project-scoped (Option A).
  - **Optional Global Install**: `npm i -g @sidekick/cli` for power users wanting user-scope hooks without per-project bundling.
- **Installer Scripts**:
  - Detect Node CLI availability (fallback to `npx` if not global).
  - Generate bash wrapper scripts for each hook (session-start, user-prompt-submit, statusline, etc.).
  - Copy the distributed `dist/` bundle and assets into `.claude/hooks/sidekick/` or `~/.claude/hooks/sidekick/`.
  - Leave user/project configs untouched.
- **Dual-Scope Configs**: `.sidekick/` and `~/.sidekick/` continue to store overrides, logs, and sessions. The Node runtime reads/writes identical paths to maintain manual workflow compatibility.

## 5. Testing & Validation Strategy

- **Unit Tests**: Each package includes Vitest suites. `sidekick-core` covers config, cascade, and providers.
- **Integration Tests**: Run the Node CLI against recorded transcripts from `test-data/` and diff outputs with the Bash runtime.
- **Installer Tests**: Invoke `scripts/install.sh`/`uninstall.sh` in containerized environments to verify clean deployment in both scopes.
