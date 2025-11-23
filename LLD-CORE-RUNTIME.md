# Core Runtime Library

## Scope

`sidekick-core`, bootstrap flow, feature graph validation, dependency injection, cross-cutting services (config, telemetry, IPC clients) exposed to features and CLI.

## To Be Defined

- Bootstrap stages after CLI hand-off: config load, logger init, asset resolver wiring, supervisor client creation.
- Feature graph declaration syntax (e.g., `registerHooks(registry, { needs: ['session-summary'], provides: ['statusline'] })`) and DAG validation failure handling.
- Dependency injection boundary—do we use a lightweight container or manual factory exports?
- Lifecycle hooks for long-running services (start/stop) and how they interact with supervisor restarts.

## Outstanding Questions / Concerns

- **IPC Ownership**: Should `sidekick-core` instantiate the supervisor client or should CLI/supervisor packages do so and pass references in? Need a single source of truth.
- **State Caching**: Determine whether core caches config/assets or always reads from disk to stay in sync with dual-scope overrides.
- **Package Split**: Clarify how much of `benchmark-next/src/lib` migrates verbatim versus being refactored into discrete modules to stay within the 500-line guardrail.
