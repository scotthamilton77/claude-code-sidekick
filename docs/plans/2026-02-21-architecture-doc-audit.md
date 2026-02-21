# ARCHITECTURE.md Validation Audit

**Bead**: sidekick-z63.1
**Date**: 2026-02-21
**Scope**: Compare `docs/ARCHITECTURE.md` claims against actual implementation. No code changes.

---

## Summary

| Category | Confirmed | Different | Missing/Undocumented |
|----------|-----------|-----------|----------------------|
| Package Structure (S2.1) | 9 | 1 | 3 |
| Assets (S2.3) | 4 | 0 | 2 |
| Feature Contracts (S2.2) | 2 | 1 | 0 |
| Hook Architecture (S3.1) | 0 | 2 | 0 |
| CLI/Daemon (S3.2) | 2 | 0 | 0 |
| Event Model (S3.3) | 2 | 1 | 0 |
| TranscriptService (S3.4) | 2 | 0 | 0 |
| Staging Pattern (S3.5) | 1 | 0 | 0 |
| Config Cascade (S3.6) | 6 | 1 | 0 |
| Daemon (S3.7) | 2 | 1 | 0 |
| LLM/Telemetry (S3.8) | 1 | 0 | 0 |
| Distribution (S4) | 0 | 2 | 0 |
| LLD Docs (S6) | 16 | 0 | 0 |
| Testing (S5) | 2 | 0 | 5 undocumented mocks |
| **Totals** | **49** | **9** | **10** |

---

## S2.1 — Package Structure

### Confirmed (9)
All of these packages exist with matching names:
`sidekick-core`, `sidekick-cli`, `sidekick-ui`, `feature-session-summary`,
`feature-reminders`, `feature-statusline`, `shared-providers`, `testing-fixtures`, `types`

### Different (1)

| # | Doc Claims | Reality |
|---|-----------|---------|
| D1 | Package directory `sidekickd/` | Actual directory is `sidekick-daemon/` (pkg name `@sidekick/daemon`) |

### Missing from Docs (3)

| # | What's Missing | Details |
|---|---------------|---------|
| M1 | `feature-resume/` package | Doc lists it but **no directory exists** — never implemented |
| M2 | `sidekick-dist/` package | Undocumented. Published as `@scotthamilton77/sidekick` on npm. Bundles the CLI for distribution |
| M3 | `sidekick-plugin/` directory | Undocumented. Contains Claude Code plugin config (`hooks.json`, skills). No `package.json` — not a true workspace member |

---

## S2.2 — Feature Interface Contracts

### Confirmed (2)
`feature-reminders` and `feature-session-summary` both export `register(context: RuntimeContext)` + `FeatureManifest` + default `Feature` object.

### Different (1)

| # | Doc Claims | Reality |
|---|-----------|---------|
| D2 | All feature packages expose `register(context)` | `feature-statusline` does **not** — it's CLI-only, invoked directly via `sidekick statusline` command. Intentional design exception, but doc doesn't acknowledge it |

---

## S2.3 — Static Assets

### Confirmed (4)
- Prompts use `*.prompt.txt` — 4 files
- Schemas use `*.json` — 2 files
- Reminders use `*.yaml` — 6 files
- `assetResolver` fully implemented with 6-layer cascade in `sidekick-core/src/assets.ts`

### Missing from Docs (2)

| # | What's Missing | Details |
|---|---------------|---------|
| M4 | `personas/` directory (20 YAML files) | Actively used for prompt interpolation. Not mentioned in S2.3 at all |
| M5 | `templates/` directory is empty | Doc implies it contains content; actually has only `.gitkeep`. Dead placeholder |

---

## S3.1 — Hook Wrapper Architecture

### Different (2)

| # | Doc Claims | Reality |
|---|-----------|---------|
| D3 | Hooks are "bash scripts" installed to `.claude/hooks/sidekick/` using bash introspection | Hooks are **JSON command entries** in `packages/sidekick-plugin/hooks/hooks.json`. Claude Code's native plugin hook format — no bash scripts |
| D4 | CLI invoked via `npx @sidekick/cli` | Invoked via `npx --yes @scotthamilton77/sidekick hook <name>` (different npm scope, different binary name) |

---

## S3.2 — CLI/Daemon Relationship

### Confirmed (2)
- Log files: `cli.log` and `sidekickd.log` paths confirmed in code
- CLI-to-Daemon IPC fire-and-forget confirmed
- Note: code also produces `transcript-events.log` (undocumented but minor)

---

## S3.3 — Event Model

### Confirmed (2)
- All 7 Hook Events present: `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`, `SessionEnd`
- `HandlerRegistry` with filter-based registration (`kind: 'all' | 'hook' | 'transcript'`) confirmed

### Different (1)

| # | Doc Claims | Reality |
|---|-----------|---------|
| D5 | 5 Transcript Events: `UserPrompt`, `AssistantMessage`, `ToolCall`, `ToolResult`, `Compact` | Actually **6** — also includes `BulkProcessingComplete` (emitted when transcript replay finishes) |

---

## S3.4 — TranscriptService

### Confirmed (2)
- File watching via chokidar with debouncing
- `getMetrics()` API returns full `TranscriptMetrics` snapshot (turns, tools, tokens, etc.)

---

## S3.5 — Staging Pattern

### Confirmed (1)
- Exact paths verified: `.sidekick/sessions/{session_id}/stage/{hook_name}/`
- Consumed reminders use timestamp pattern `{name}.{timestamp}.json`

---

## S3.6 — Configuration Cascade

### Confirmed (6)
- YAML domain files with bash-style `sidekick.config` overrides
- All 4 domain files exist: `config.yaml`, `llm.yaml`, `transcript.yaml`, `features.yaml`
- `.env` file loading implemented (user, project, project-local)
- `.yaml.local` override files supported (highest priority)
- `.sidekick/` paths used for both scopes
- `SIDEKICK_*` env vars mapped (10 explicit mappings)

### Different (1)

| # | Doc Claims | Reality |
|---|-----------|---------|
| D6 | Cascade: Unified Config **before** Domain Config at each scope (levels 3-4 and 5-6) | Implementation: Domain Config loaded **first**, then Unified Config **overrides** it. Order within each scope is swapped vs. docs. The impl is arguably more intuitive, but contradicts stated order |

---

## S3.7 — Background Daemon

### Confirmed (2)
- Unix domain sockets with path-length handling (108-byte limit, project-hash shortening)
- Token auth at `.sidekick/sidekickd.token` + PID file at `.sidekick/sidekickd.pid`

### Different (1)

| # | Doc Claims | Reality |
|---|-----------|---------|
| D7 | "NDJSON protocol" | Actually **JSON-RPC 2.0** with newline framing. Uses `JsonRpcRequestSchema` / `JsonRpcResponseSchema` (Zod-validated). Technically distinct from raw NDJSON |

---

## S3.8 — LLM Providers & Telemetry

### Confirmed (1)
- Pino-based structured logging with telemetry emission (counters, gauges, histograms)

---

## S4 — Distribution

### Different (2)

| # | Doc Claims | Reality |
|---|-----------|---------|
| D8 | Default invocation: `npx @sidekick/cli <hook>` | Actual: `npx @scotthamilton77/sidekick hook <name>`. Different npm scope and command structure |
| D9 | Installer creates bash wrapper scripts | Installation is via Claude Code plugin marketplace (`plugin-installer.ts`), producing JSON hook entries — no bash wrappers |

---

## S5 — Testing

### Confirmed (2)
- All 4 claimed mocks exist: `MockLLMService`, `MockHandlerRegistry`, `MockTranscriptService`, `MockStagingService`
- Integration tests use recorded JSONL transcripts from fixtures directory

### Undocumented (5 additional mocks)
`MockStateService`, `MockLogger`, `MockConfigService`, `MockAssetResolver`, `MockTelemetry` — all exist but aren't mentioned in docs.

---

## S6 — LLD Reference Index

### Confirmed (16/16)
Every single referenced design document exists:

| Document | Size |
|----------|------|
| `docs/design/flow.md` | 28.7 KB |
| `docs/design/CORE-RUNTIME.md` | 19.2 KB |
| `docs/design/CLI.md` | 17.7 KB |
| `docs/design/DAEMON.md` | 20.4 KB |
| `docs/design/CONFIG-SYSTEM.md` | 17.2 KB |
| `docs/design/TRANSCRIPT-PROCESSING.md` | 22.9 KB |
| `docs/design/STRUCTURED-LOGGING.md` | 12.0 KB |
| `docs/design/SCHEMA-CONTRACTS.md` | 16.5 KB |
| `docs/design/LLM-PROVIDERS.md` | 15.4 KB |
| `docs/design/FEATURE-REMINDERS.md` | 25.5 KB |
| `docs/design/FEATURE-SESSION-SUMMARY.md` | 18.7 KB |
| `docs/design/FEATURE-STATUSLINE.md` | 16.3 KB |
| `docs/design/FEATURE-RESUME.md` | 6.7 KB |
| `docs/design/TEST-FIXTURES.md` | 22.7 KB |
| `docs/design/TRANSCRIPT_METRICS.md` | 10.5 KB |
| `packages/sidekick-ui/docs/MONITORING-UI.md` | 20.8 KB |

---

## Ranked Discrepancies

Each item classified: **fix=doc** (code is correct, update docs) or **fix=code** (docs are correct, update code).

### Batch 1 (High Impact)

| Rank | IDs | Summary | Fix | Details |
|------|-----|---------|-----|---------|
| 1 | D3, D4, D8, D9 | Hook/distribution model is fundamentally different | **doc** | Docs describe bash wrapper scripts + `@sidekick/cli`; reality is Claude Code plugin JSON hooks + `npx @scotthamilton77/sidekick`. Affects S3.1 and S4 |
| 2 | M1 | `feature-resume` package doesn't exist | **doc** | Listed in S2.1 package tree but never implemented. Design doc exists (6.7 KB) — specced but not built. Remove from S2.1 or mark as planned |
| 3 | D6 | Config cascade order is inverted | **doc** | S3.6 says unified before domain at each scope; code does domain first, then unified overrides. Code behavior is more intuitive |
| 4 | M2, M3 | Distribution packages undocumented | **doc** | `sidekick-dist` (npm bundle) and `sidekick-plugin` (Claude Code plugin config) are critical to shipping but invisible in S2.1 |
| 5 | D7 | IPC protocol is JSON-RPC 2.0, not NDJSON | **doc** | S3.7 says "NDJSON protocol"; actual is JSON-RPC 2.0 with newline framing. Distinct specs |

### Batch 2 (Medium Impact)

| Rank | IDs | Summary | Fix | Details |
|------|-----|---------|-----|---------|
| 6 | D1 | Daemon directory name mismatch | **doc** | S2.1 says `sidekickd/`; actual dir is `sidekick-daemon/` (pkg name `@sidekick/daemon`) |
| 7 | D5 | Missing transcript event type | **doc** | S3.3 lists 5 transcript events; code has 6th: `BulkProcessingComplete` |
| 8 | M4 | Personas directory undocumented | **doc** | 20 YAML files in `assets/sidekick/personas/`, actively used, absent from S2.3 |
| 9 | D2 | `feature-statusline` doesn't expose `register()` | **doc** | S2.2 says all features expose `register(context)`; statusline is CLI-only, intentional exception not acknowledged |
| 10 | M5 | `templates/` directory is empty placeholder | **doc** | S2.3 implies it contains content; only has `.gitkeep` |

### Batch 3 (Low Impact / Completeness)

| Rank | IDs | Summary | Fix | Details |
|------|-----|---------|-----|---------|
| 11 | — | 5 additional test mocks undocumented | **doc** | S5 lists 4 mocks; 5 more exist: `MockStateService`, `MockLogger`, `MockConfigService`, `MockAssetResolver`, `MockTelemetry` |
| 12 | — | `transcript-events.log` undocumented | **doc** | S3.2 lists `cli.log` and `sidekickd.log`; code also produces `transcript-events.log` |
| 13 | — | Asset cascade has 6 layers, not documented in S2.3 | **doc** | `assets.ts` implements a 6-layer cascade (bundled defaults, user-installed, user-persistent, project-installed, project-persistent, project-local). S2.3 just says "respecting the cascade" without listing layers |
| 14 | — | `defaults/features/` subdirectory undocumented | **doc** | Contains `reminders.defaults.yaml`, `session-summary.defaults.yaml`, `statusline-empty-messages.txt` — not mentioned in S2.3 |
