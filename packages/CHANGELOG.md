# Changelog

All notable changes to the Sidekick Node/TypeScript packages will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

#### Phase 3: Structured Logging & Telemetry (2025-11-26)

- `@sidekick/core`: `structured-logging.ts` - Pino-based logging system
  - Two-phase initialization (bootstrap console → Pino)
  - Automatic redaction of sensitive fields (apiKey, token, secret, etc.)
  - Context binding (scope, correlationId, command, component)
  - Telemetry emission (counters, gauges, histograms)
  - File transport with auto-directory creation
  - Configurable console output for interactive/hook modes
- `@sidekick/cli`: Runtime now exposes `logger`, `telemetry`, `correlationId`, and `cleanup()`
- Dependencies: `pino`, `pino-roll`, `pino-pretty` (dev)
- Log files written to `.sidekick/logs/sidekick.log` (scope-dependent path)

#### Phase 2: Configuration & Asset Resolution (2025-11-26)

- `@sidekick/core`: `config.ts` - Multi-layer configuration cascade
  - Environment variables (SIDEKICK_* prefixed)
  - .env file loading (~/.sidekick/.env, project .env, .sidekick/.env)
  - JSONC config files with deep-merge semantics
  - Zod schema validation with strict mode (rejects unknown keys)
  - Config immutability after loading (Object.freeze)
- `@sidekick/core`: `assets.ts` - Cascading asset resolver
  - Six-level cascade from defaults to project-local overrides
  - Support for text, JSON, and JSONC asset formats
- `assets/sidekick/` directory structure created (prompts/, schemas/, templates/)
- Dependencies: `dotenv`, `jsonc-parser`, `zod`

#### Phase 1: Bootstrap CLI & Runtime Skeleton (2025-11-25)

- `@sidekick/cli`: Node-based CLI invocable via bash hook wrappers
  - `session-start` command with structured JSON output
  - Scope detection (project vs user)
  - yargs-parser for argument parsing
- `@sidekick/core`: `scope.ts` - Scope resolution logic
  - Detects user vs project scope from hook script path
  - Dual-install detection to prevent duplicate execution
  - Warning aggregation for diagnostic output
- `scripts/hooks/sidekick/session-start` bash wrapper for hook integration
- Monorepo structure with pnpm workspaces

### Design Documents

The Node runtime rewrite follows these design documents:

- `TARGET-ARCHITECTURE.md` - High-level architecture and package structure
- `TARGET-IMPLEMENTATION-PLAN.md` - Phased implementation roadmap
- `LLD-CLI.md` - CLI design and hook wrapper layer
- `LLD-CONFIG-SYSTEM.md` - Configuration cascade design
- `LLD-CORE-RUNTIME.md` - Core runtime services
- `LLD-STRUCTURED-LOGGING.md` - Logging and telemetry architecture
- `LLD-SCHEMA-CONTRACTS.md` - Zod schema conventions

### Migration Notes

The Node runtime is being developed alongside the existing Bash runtime. During the
transition period (Phases 1-6), both runtimes coexist:

- **Production**: Bash runtime in `src/sidekick/`
- **Development**: Node runtime in `packages/`

The Bash runtime remains the production deployment until Phase 7 (Installation &
Distribution Hardening) completes the migration.
