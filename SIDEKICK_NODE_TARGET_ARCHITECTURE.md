# Sidekick Node Target Architecture

_Last updated: 2025-11-23_

This document captures the greenfield Node.js rewrite plan for Sidekick. It pulls constraints from `CLAUDE.md`, implementation details from `ARCH.md`, and migration goals from `SIDEKICK_RUNTIME_MIGRATION_PLAN.md`. Bash remains the reference runtime until this plan is implemented, but the Node stack becomes the primary target.

## 1. Guiding Principles

- **Simplicity Rules**: We should keep the architecture as simple as possible, where simplicity is defined by:
  - No unnecessary code: if there's an open source implementation, we shouldn't (a) write our own, (b) unnecessarily wrap it, (c) test the implementation details of the open source code
  - Honor SOLID principles: Files > 500 lines and methods > 20 lines are smells that we're letting complexity creep in
  - Honor DRY principles: If we're unnecessarily doing the same thing in two places, we should refactor
- **Node-first runtime**: CLI, feature orchestration, and hook integration live in TypeScript/Node. Python is reserved for developer tooling only (one-off analyzers, data prep), never as a deployed dependency.
- **Dual-scope parity**: Behavior must remain identical in project (`.claude/`) and user (`~/.claude/`) scopes, mirroring today’s Sidekick guarantees in `CLAUDE.md`.
- **Greenfield repo layout**: Rather than carry forward organic structures, introduce a deliberate workspace rooted at `packages/` with explicit package boundaries and shared tooling.
- **Reuse benchmark-next core**: The `src/lib/` directory in `benchmark-next` becomes the shared core (`sidekick-core`), providing production-ready implementations for LLM providers, configuration, logging, and transcript processing.
- **Benchmark-next toolchain reuse**: Adopt the same modern stack already planned for `benchmark-next` (Node 20+, pnpm workspaces, strict TypeScript, Vitest, eslint/prettier, tsx for local runs) to reduce cognitive load.
- **Feature modularity and flags**: Preserve the plugin-style independence described in `ARCH.md`, including dependency enforcement (e.g., reminders require tracking) and config-driven toggles.
- **Shared assets, flexible overrides**: Defaults (prompts, schemas, reminder templates) live in a new `assets/sidekick/` tree so both Node runtime and Python tools share canonical sources. Runtime overrides still honor user/project cascades, but dev tools only read the defaults unless explicitly told otherwise.

## 2. Workspace Layout

```
packages/
├── sidekick-core/          # Shared runtime library (config cascade, logging, feature graph, LLM providers)
├── sidekick-cli/           # CLI entry + hook commands (session-start, user-prompt-submit, statusline, admin tools)
├── feature-session-summary/# Feature implementation packages (one per major feature)
├── feature-reminders/
├── feature-statusline/
├── feature-resume/
├── shared-providers/       # Provider SDK adapters, retry/circuit breaker primitives
├── schema-contracts/       # Type-safe definitions + Zod schemas for transcripts, prompts, reminder payloads
└── testing/fixtures/       # Shared mocks, golden transcripts, CLI harness
assets/
└── sidekick/
    ├── prompts/
    ├── schemas/
    └── reminders/
```

Key characteristics:

- **`pnpm-workspace.yaml`** at repo root lists all packages plus `benchmark-next` so tooling (lint, test, build) is consistent.
- **`packages/sidekick-core`** (derived from `benchmark-next/src/lib`) houses runtime primitives: configuration cascade loader, path utilities, feature registry, process manager, structured logging, JSON helpers, telemetry.
- **Feature packages** expose a standard interface (`registerHooks(registry)`) and ship compiled JS ready for dynamic loading. This mirrors the Bash plugin loader while allowing typed dependencies and tree-shaking.
- **`schema-contracts`** publishes generated TypeScript types plus JSON Schema artifacts produced during build. Python tools can import the JSON Schema directly from `assets/sidekick/schemas` without pulling Node code.
- **`assets/sidekick`** keeps versioned defaults under source control. Build scripts copy or bundle them into packages while also leaving them accessible at runtime for cascading overrides.

## 3. Static Assets Strategy

- **Authoritative location**: `assets/sidekick/` contains all shipped defaults—prompts (`prompts/*.prompt.txt`), schemas (`schemas/*.json`), static reminder templates, and other LLM resources. This mirrors how `scripts/benchmark` snapshots prompts today but centralizes them outside the runtime source tree.
- **Runtime access**: `sidekick-core` exposes helpers (`assetResolver.resolve("prompts/session-summary.prompt.txt")`) that read from assets by default, then apply the existing cascade logic (user installed → user persistent → project installed → project persistent) before falling back to `assets/sidekick/`.
- **Developer tools**: Python scripts (e.g., `scripts/simulate-session.py`) read directly from `assets/sidekick/` when they need prompt/schema data. Because overrides are runtime concerns, these tools ignore cascade layers unless explicitly provided a path.
- **Versioning & snapshots**: We adopt a **Monorepo Lockstep** strategy. `assets/sidekick` represents the current development state (HEAD). Compatibility is enforced by `packages/schema-contracts` (Zod/TS types) during the build. For reproducibility, `benchmark-next` records the git SHA of the `assets/` folder in its run metadata, rather than relying on a separate semantic version file.

## 4. Runtime Architecture

1. **CLI Entry (`sidekick-cli`)**
   - Provides commands: `sidekick session-start`, `sidekick user-prompt-submit`, `sidekick statusline`, diagnostics, and admin utilities (config doctor, log tailing).
   - Accepts the same stdin JSON payloads documented in `ARCH.md` and outputs identical JSON/strings to maintain Claude hook compatibility.
2. **Bootstrap Flow**
   - Parse argv, read stdin, initialize telemetry + logging using config-driven settings.
   - Resolve project directory and install scope (user vs project) to know which cascade roots to consult.
   - Instantiate `sidekick-core` runtime with dependencies (feature registry, provider adapters, asset resolver).
3. **Feature Graph**
   - Each feature module registers declared dependencies (e.g., `reminders` depends on `tracking`). The runtime performs a DAG validation during startup, mirroring Bash’s loader but with compile-time types and descriptive errors.
   - Features expose hook handlers (`onSessionStart`, `onUserPromptSubmit`, `onStatusLine`, etc.) and optional background tasks.
4. Configuration Cascade
   - Implemented in `sidekick-core/config` (reusing `benchmark-next` config logic). Supports the same domains (`config`, `llm-core`, `llm-providers`, `features`).
   - **Format**: JSONC (JSON with comments). This allows users to document settings while maintaining structure.
   - **Validation**: Zod schemas ensure type safety and fail-fast validation at runtime.
   - **Migration**: A standalone utility will convert legacy shell-style `.conf` files to the new JSONC format. The runtime itself will strictly support JSONC.
   - Environment `.env` files are sourced in the same order as today (user persistent → project root → project `.sidekick`).
5. **LLM Providers**
   - `shared-providers` (reusing `benchmark-next/src/lib/providers`) offers typed adapters for Claude CLI (via child_process), OpenAI, OpenRouter, and custom commands. It mirrors the provider matrix described in `ARCH.md` but leverages async/await, AbortController, and circuit-breaker primitives for resilience.
6. **Logging & Telemetry**
   - Use `pino` (as in `benchmark-next`) for structured logs. File output continues to `.sidekick/sessions/<id>/sidekick.log`. **Telemetry is implemented as a lightweight wrapper around logging, emitting metric events (counters, timers) into the same stream.** Console logging remains opt-in via config/env/CLI flag, matching current semantics.
7. **Background Work (Event Loop Supervisor)**
   - **Architecture**: A detached Node process acts as a background supervisor/event loop.
   - **Lifecycle**: The CLI checks for the supervisor's existence (via PID file/socket). If missing, the CLI starts it.
   - **Communication**: The CLI queues events (e.g., "session updated") to the supervisor.
   - **Responsibility**: Handles compute-heavy tasks (resume generation, session summary updates) asynchronously to avoid blocking the CLI.
   - **State Management**: Acts as the **single writer** for shared state files (using atomic writes). The CLI reads these files for synchronous hooks (like `statusline`) but delegates all mutations to the supervisor via IPC.
   - **Sync vs Async**: Decided on a per-hook basis. Lightweight hooks remain synchronous; heavy hooks delegate to the supervisor.

## 5. Installation & Distribution

- **Default usage**: `npx @sidekick/cli <hook>` inside a project. This keeps the runtime project-scoped by default, aligning with Option A from the migration plan.
- **Optional global install**: `npm i -g @sidekick/cli` for power users who want user-scope hooks without bundling Node per project.
- **Installer scripts**: Existing `scripts/install.sh` and `scripts/uninstall.sh` evolve to:
  - Detect Node CLI availability (`npx` fallback if not globally installed).
  - Copy the distributed `dist/` bundle plus necessary assets into `.claude/hooks/sidekick/` or `~/.claude/hooks/sidekick/` while leaving user/project configs untouched.
  - Maintain the same safety prompts and cleanup logic described in `scripts/uninstall.sh`.
- **Dual-scope configs**: `.sidekick/` (project persistent) and `~/.sidekick/` (user persistent) continue to store `.conf` overrides, logs, sessions, and reminder templates. The Node runtime reads/writes identical paths so manual workflows remain unchanged.

## 6. Python Tooling Interop

- Developer-facing Python scripts (`scripts/simulate-session.py`, benchmarking helpers) read from `assets/sidekick/` for prompts/schemas, ensuring they share the same defaults as Node.
- When a tool needs runtime-aware overrides, it accepts explicit paths or environment variables pointing to `.sidekick/` directories; no implicit cascade traversal is performed by default.
- Shared schemas (e.g., `session-summary.schema.json`, `reminder-payload.schema.json`) live in `assets/sidekick/schemas`. The build for `schema-contracts` also emits `dist/json/*.schema.json` so other ecosystems can import them directly.

## 7. Testing & Validation

- **Unit tests**: Each package includes Vitest suites. `sidekick-core` covers config parsing, cascade precedence, provider adapters, feature registry, and logging. Feature packages include deterministic tests with fixture transcripts.
- **Integration tests**: Mirror existing Bash harnesses by running the Node CLI against recorded transcripts from `test-data/` and diffing outputs with the Bash runtime until parity is achieved.
- **Golden tests**: Use the same methodology as `benchmark-next`—shared fixtures, `hyperfine` comparisons, and automated diffs to ensure Node matches Bash behavior before cutting over.
- **Installer tests**: Extend `scripts/tests` to invoke `scripts/install.sh`/`uninstall.sh` in containerized environments, ensuring Node bundles deploy cleanly in both scopes.

## 8. Migration Stages (Recap)

1. **Scaffold packages/** with pnpm + shared configs.
2. **Port core infrastructure** (config loader, logging, provider adapters, CLI entry).
3. **Incrementally port features** (statusline → session summary → reminders → resume → cleanup) using TypeScript packages.
4. **Pilot in project scope** while Bash remains fallback (toggle via env or installer flag).
5. **Cut over** once integration tests show parity, then optionally deprecate Bash runtime.

## 9. Open Questions

1. **Config Format Evolution**: **Decision: Adopt JSONC.** The runtime will strictly use JSONC (JSON with comments) validated by Zod. A standalone migration tool will be provided to convert legacy `.conf` files.
2. **Background Task Implementation**: **Decision: Async Event Loop.** A detached background process (supervisor) will handle heavy compute tasks. The CLI queues events to this process, which updates state files for synchronous hooks to consume.
3. **Shared Tooling Governance**: **Decision: Monorepo Lockstep.** We will rely on the monorepo structure where `assets/sidekick` represents the current development state. Compatibility is enforced by `packages/schema-contracts` (Zod/TS types). If an asset change breaks the contract, the build fails. For benchmarking reproducibility, `benchmark-next` will record the git SHA of the `assets/` folder in its run metadata.
4. **Telemetry/Observability Enhancements**: **Decision: Logging-First with Structured Metrics.** We will defer full OpenTelemetry integration to avoid scope creep. Instead, `sidekick-core` will include a lightweight telemetry helper that emits metrics (counters, timers) as structured log entries (e.g., `{ "level": "info", "kind": "metric", ... }`). This provides sufficient visibility for the migration phase while keeping the runtime dependency-free.
5. **State Management**: **Decision: Supervisor-Owned JSON State.** We will move away from scattered counter files. The Background Supervisor will act as the **single writer** for state, persisting it to `state/*.json` files using atomic writes. The CLI will read these files directly for low-latency access (e.g., statusline) but must send IPC messages to the Supervisor to request updates. This eliminates file locking complexity and race conditions while preserving human-readable debuggability.
6. **Separation of Concerns**: **Decision: Hexagonal Architecture (Ports & Adapters).** We will strictly decouple the "Core Domain" from the "Claude Interface".
   - **`sidekick-core`**: Contains pure business logic (summarization, reminders, state) and operates on generic domain objects. It has zero knowledge of Claude-specific JSON formats or environment variables.
   - **`sidekick-cli`**: Acts as the **Claude Hook Adapter**. It is responsible for parsing the specific stdin payloads defined by Anthropic, converting them to domain objects, invoking the core, and formatting the response.
   - **Benefit**: This allows the core logic to be unit-tested in isolation and potentially reused in other environments (e.g., VS Code extensions, CI pipelines) without modification.

Answering these questions is part of the implementation roadmap, but the architecture above frames the intended direction for the Node rewrite.
