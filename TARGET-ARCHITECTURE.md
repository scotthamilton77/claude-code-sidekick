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
- **Runtime Access**: `sidekick-core` exposes helpers (`assetResolver.resolve(...)`) that read from assets by default, respecting the cascade: User Installed → User Persistent → Project Installed → Project Persistent → `assets/sidekick/`.
- **Dev Tools**: Python scripts read directly from `assets/sidekick/` to ensure they use the same defaults as the runtime, ignoring cascade layers unless explicitly configured.

## 3. Runtime Architecture

### 3.1 Bootstrap Flow
1.  **Initialize**: Parse argv, read stdin, initialize telemetry + logging using config-driven settings.
2.  **Scope Resolution**: Resolve project directory and install scope (user vs project) to determine cascade roots.
3.  **Runtime Instantiation**: Instantiate `sidekick-core` with dependencies (feature registry, provider adapters, asset resolver).
4.  **Feature Graph Validation**: The runtime performs a DAG validation during startup to ensure all declared dependencies are met, mirroring Bash’s loader but with compile-time types.

### 3.2 Configuration Cascade
- **Format**: JSONC (JSON with comments) is the strict standard.
- **Validation**: Zod schemas ensure type safety and fail-fast validation at runtime.
- **Environment Variables**: Sourced in order: User Persistent → Project Root → Project `.sidekick`.
- **Migration**: A standalone utility will convert legacy shell-style `.conf` files to JSONC.

### 3.3 Background Supervisor
- **Architecture**: A detached Node.js process acts as the background supervisor/event loop.
- **Lifecycle**: The CLI checks for the supervisor's existence (PID/socket) and starts it if missing.
- **Responsibility**: Handles compute-heavy tasks (resume generation, session summary updates) asynchronously.
- **Single Writer**: Acts as the **single writer** for shared state files (`state/*.json`) using atomic writes. The CLI reads these files for synchronous hooks (statusline) but delegates mutations to the supervisor via IPC.

### 3.4 LLM Providers & Telemetry
- **Providers**: `shared-providers` offers typed adapters for Claude CLI, OpenAI, OpenRouter, and custom commands, leveraging async/await and circuit breakers.
- **Telemetry**: Implemented as a lightweight wrapper around `pino` logging, emitting metric events (counters, timers) into the structured log stream.

## 4. Installation & Distribution

- **Default Usage**: `npx @sidekick/cli <hook>` inside a project. Keeps the runtime project-scoped (Option A).
- **Optional Global Install**: `npm i -g @sidekick/cli` for power users wanting user-scope hooks without per-project bundling.
- **Installer Scripts**:
    - Detect Node CLI availability (fallback to `npx` if not global).
    - Copy the distributed `dist/` bundle and assets into `.claude/hooks/sidekick/` or `~/.claude/hooks/sidekick/`.
    - Leave user/project configs untouched.
- **Dual-Scope Configs**: `.sidekick/` and `~/.sidekick/` continue to store overrides, logs, and sessions. The Node runtime reads/writes identical paths to maintain manual workflow compatibility.

## 5. Testing & Validation Strategy

- **Unit Tests**: Each package includes Vitest suites. `sidekick-core` covers config, cascade, and providers.
- **Integration Tests**: Run the Node CLI against recorded transcripts from `test-data/` and diff outputs with the Bash runtime.
- **Installer Tests**: Invoke `scripts/install.sh`/`uninstall.sh` in containerized environments to verify clean deployment in both scopes.
