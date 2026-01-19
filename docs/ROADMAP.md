# Phased Implementation Plan

This plan sequences the Node/TypeScript rewrite into phases that each end with working, demoable software. Every phase lists objectives, relevant design documents/sections, acceptance criteria, and a reminder that tests are authored at the start to cover the criteria.

> **Note**: Full details for completed phases are archived in [ROADMAP-COMPLETED.md](./ROADMAP-COMPLETED.md).

---

## Completed Phases Summary

### Phase 1: Bootstrap CLI & Runtime Skeleton - COMPLETE 2025-11-29

Delivered minimal Node-based CLI with scope detection and bootstrap sequence. Key outcomes:

- Event Model types (`SidekickEvent`, `HookEvent`, `TranscriptEvent`) in `@sidekick/types`
- Type guards for event discrimination
- `HandlerRegistry` interface wired into `RuntimeContext`
- CLI detects user vs project scope via `--hook-script-path` argument

### Phase 1.5: UI Foundation - COMPLETE 2025-11-29

Built monitoring UI infrastructure. Key outcomes:

- Log parsing (NDJSON reader, session filtering, log merging)
- Replay Engine with time-travel state reconstruction
- Shared types between UI and backend packages
- Event type badges and source indicators

### Phase 2: Configuration & Asset Resolution - COMPLETE 2025-11-30

Implemented configuration cascade with YAML domain files. Key outcomes:

- 4 domain files: `config.yaml`, `llm.yaml`, `transcript.yaml`, `features.yaml`
- 7-layer cascade: defaults → env → user unified → user domain → project unified → project domain → project-local
- `sidekick.config` unified override support (dot-notation)
- Derived path helpers for staging directories
- Breaking change: flat config → domain-based (`config.core.logging.level`, etc.)

### Phase 3: Structured Logging & Telemetry - COMPLETE 2025-11-30

Added two-phase logging pipeline. Key outcomes:

- Split log files: `cli.log` / `sidekickd.log`
- `source` field distinguishing CLI vs Daemon
- `ContextLogger` with deep-merge context
- 8 logging event types (HookReceived, HookCompleted, ReminderStaged, etc.)
- UI wired to read real logs with filter/search capabilities

### Phase 4: Core Services & Providers - COMPLETE 2025-12-01

Built LLM providers, TranscriptService, and StagingService. Key outcomes:

**4.1 RuntimeContext Discriminated Union**: `CLIContext | DaemonContext` with type guards, service interfaces in `@sidekick/types`

**4.2 TranscriptService Foundation**: Expanded `TranscriptMetrics` schema with token usage, cache tiers, per-model breakdown

**4.3 TranscriptService Implementation**: File watching (chokidar), incremental processing, compaction detection, metrics persistence

**4.4 StagingService**: Atomic file staging, suppression markers, sync/async APIs

**4.5 Integration & Verification**: End-to-end tests for Feature → LLM flow, TranscriptService → Handler flow, credential precedence

**4.6 UI Integration**: MetricsPanel with sparklines, Compaction Timeline markers, StateInspector tabs, API endpoints for session data

### Phase 5: Daemon & Background Tasks - COMPLETE 2025-12-04

Built daemon process with IPC socket, task engine, and CLI integration. Key outcomes:

**5.1 Core Daemon Process**: Entry point, signal handlers, IPC socket (Unix domain), version handshake, token auth, heartbeat mechanism

**5.2 Task Engine & State Manager**: Single-writer atomic JSON updates, task queue with priority ordering, worker pool, orphan prevention via TaskRegistry

**5.3 TranscriptService Integration**: Initialize on SessionStart, stop on SessionEnd, HandlerRegistryImpl with invokeHook() and emitTranscriptEvent()

**5.4 Handler Event Dispatch & Staging**: Sequential hook handler execution, concurrent transcript handlers, staging directory management

**5.5 CLI Integration & Graceful Fallback**: `sidekick daemon start/stop/status` commands, auto-start on first hook, connection pooling, graceful degradation

**5.6 UI Integration**: System Health dashboard (uptime, memory, queue depth), offline detection, session state file reading

### Phase 6: Feature Enablement & Integration - COMPLETE 2025-12-13

Implemented feature packages using unified handler model. Key outcomes:

**6.1 Reminders Feature**: ReminderUtils module, staging handlers (Daemon), consumption handlers (CLI), suppression pattern

**6.2 Session Summary Feature**: SessionSummaryState types, countdown throttling, LLM integration, transcript extraction via getExcerpt()

**6.2.1 TranscriptService Completion**: Added getExcerpt() and getTranscript() methods, bookmark-based windowing

**6.3 Statusline Feature**: StateReader, GitProvider, Formatter with ANSI colors, CLI command

**6.4 Resume Feature**: Resume message generation on title change, artifact discovery from session state

**6.5 UI Integration**: Reminder event visualization, session summary cards, Decision Log view, trace correlation

### Phase 7: Monitoring UI Completion & Hardening - COMPLETE 2025-12-13

Closed gaps for production-ready monitoring UI. Key outcomes:

**7.A Contracts & Data Surfaces**: API endpoints for session state/stage reading, path validation, dual-scope resolution

**7.B Real State Inspector**: Replay-driven state inspection, generic JSON tree viewer, snapshot diff view

**7.C Unified Cockpit UX**: Time-cut indicator, click-to-snap from events, live/paused mode, search alignment

**7.D Performance & Reliability**: Incremental NDJSON ingestion, robustness guardrails, perf regression tests

**7.E Production-Local Runtime**: Node server for SPA + API, `sidekick ui` CLI command, dual-scope verification

### Phase 8: CLI→Daemon Event Dispatch - COMPLETE 2025-12-20

Wired CLI hook commands to dispatch events to Daemon via IPC. Key outcomes:

**8.1-8.4 Event Dispatch**: Full CLI → IpcService → Daemon → HandlerRegistry → Handlers flow with graceful degradation

**8.5 Refactoring**: Cleaned up normalizeHookName(), extracted buildHookEvent() methods, refactored cli.ts runCli(), wired reminder consumption handlers, simplified hook response format

### Phase 9: Refactoring & Architecture Improvements - COMPLETE 2026-01-18

Comprehensive refactoring to improve code quality, test coverage, and architectural consistency. Key outcomes:

**9.1 Test Coverage Foundation**: Achieved 90.08% line coverage (exceeded 90% target), documented exclusions

**9.2 Architecture Review**: Systematic audit with prioritized findings - handler architecture Grade A, 4 high-severity coupling issues identified

**9.3 State Management Infrastructure**: Centralized StateService with atomic writes, Zod validation, 90+ path constructions consolidated

**9.4 Config Source-of-Truth**: YAML files as single source of truth, removed all Zod `.default()` calls, hard failures on missing config

**9.5 Feature Domain Consolidation**: Moved reminder state logic from daemon.ts to feature packages, event definitions to owning packages

**9.6 Reminder Orchestration**: Centralized 4 cross-reminder rules in ReminderOrchestrator, handlers have single responsibility

**9.7 Code Cleanup**: Removed deprecated APIs, addressed FIXMEs, cleaned phase references from ~60 source files

---

### Phase 10: Feature Parity and Legacy Cleanup
- [ ] Objectives
  - [ ] Audit legacy implementations against TypeScript rewrite for feature parity
  - [ ] Port remaining functionality not obsolete or in conflict with new designs; document intentional omissions
  - [ ] Clean up or archive legacy code
- [ ] Relevant documents/sections
  - [ ] `{project_root_dir}/docs/ARCHITECTURE.md` (§1 Guiding Principles)
  - [ ] `{project_root_dir}/docs/design/flow.md` (complete hook flows as feature reference)
- [x] **10.1 Legacy Audit** - COMPLETE 2026-01-12
  - [x] Audit `src/sidekick/` (bash runtime) for behaviors not yet in TypeScript packages
  - **Findings Summary:**
    - **Core Infrastructure (~95%)**: All 5 hooks, 8-layer config cascade (exceeds bash), session storage, plugin system with Kahn's toposort
    - **LLM Integration (~75%)**: Providers work (Claude CLI, OpenAI, OpenRouter), FallbackProvider for HA, debug dumps
    - **Features (100%)**: All 9 features implemented (Statusline, Session Summary, Resume, Sleeper→event-driven, Snarky Comment, Tracking, Reminders, Pre-Completion, Cleanup)
  - **Gaps identified:**
    - OpenRouter provider routing (allowlist/blocklist) - **queued for 10.2**
    - Custom provider (schema accepts but factory doesn't implement) - deferred, implement when needed
  - **Intentional simplifications (not porting):**
    - Per-model OpenRouter overrides and model name normalization - internal detail
    - Per-task PID/log files - daemon architecture handles differently
    - Sleeper polling daemon - replaced with event-driven (better design)
    - Stateful circuit breaker - FallbackProvider is simpler and sufficient
  - [x] Audit `benchmark-next/` for unported features (early TypeScript exploration, largely stale)
  - **Note**: benchmark-next/ relocated to `development-tools/llm-eval/` with related scripts and test-data
  - **development-tools/llm-eval/ Findings:**
    - **Reusable**: `CircuitBreakerProvider.ts` (Cockatiel-based, exponential backoff) - consider porting if resilience needed
    - **Reusable**: `json-extraction.ts` - clean utility, currently scattered in packages
    - **Not needed**: Config system (packages/ 8-layer cascade is more mature), consensus/scoring algorithms (LLM eval specific)
    - **Disposition**: Archive after extracting CircuitBreakerProvider pattern if needed
  - [x] Audit `scripts/` for analysis tools that should migrate
  - **scripts/ Findings:**
    - **Keep as-is**: `install.sh`, `uninstall.sh` (shell is natural for file ops and user prompts)
    - **Port HIGH**: `dev-mode.sh` (CLI command) - DONE, `analyze-session-at-line.sh` - RETIRED (dev-mode covers use case)
    - **Port MEDIUM**: `copy-config.sh`, `generate-reminder-template.sh`
    - **Retired**: `bulk-session-summary.sh`, `collect-test-data.sh` (low-usage LLM eval tools, not worth porting)
    - **Port LOW**: `kill-sidekick-processes.sh`, `find-orphaned-processes.sh`, `generate-model-report.py`
    - **Archive**: `simulate-session.py` (refactor to TypeScript integration tests), legacy shell tests
- [ ] **10.2 Migration Tasks**
  - [x] **OpenRouter Provider Routing** - COMPLETE 2026-01-18: Added allowlist/blocklist support to filter unreliable providers
    - Config: `llm.openrouter.providerAllowlist`, `llm.openrouter.providerBlocklist`
    - Implementation: Added `provider` field to OpenRouter request body
    - Location: `@sidekick/shared-providers` OpenRouterProfileProvider class with `buildProviderField()` method
  - [x] **Script Ports (HIGH priority)**:
    - [x] `dev-mode.sh` → `packages/sidekick-cli/src/commands/dev-mode.ts` - COMPLETE 2026-01-19
      - Subcommands: enable, disable, status, clean, clean-all
      - Tests: 16 tests with 88% line coverage
      - Non-interactive (no prompts) unlike bash version - suitable for scripted use
    - [x] `analyze-session-at-line.sh` - RETIRED 2026-01-19: Deleted script, dev-mode history tracking now covers this use case
  - [ ] **Script Ports (MEDIUM priority)**:
    - [x] `bulk-session-summary.sh` - RETIRED 2026-01-19: Low-usage dev tool for test data curation, not worth porting
    - [x] `collect-test-data.sh` - RETIRED 2026-01-19: Low-usage LLM eval tool for test data curation, not worth porting
    - [ ] `copy-config.sh` → `packages/sidekick-cli/src/commands/generate-config.ts`
    - [ ] `generate-reminder-template.sh` → `packages/sidekick-cli/src/commands/generate-reminders.ts`
- [ ] **10.3 Legacy Cleanup**
  - [ ] Update `development-tools/llm-eval/` README and AGENTS.md to reflect new location
  - [ ] Decide: retain bash runtime as fallback or deprecate entirely
  - [ ] Update `AGENTS.md` to reflect final state
- [ ] Acceptance criteria
  - [ ] TypeScript rewrite has feature parity with legacy (documented exceptions allowed)
  - [ ] Legacy code is archived/deprecated with clear migration notes
  - [ ] Code complexity is kept low using stated architecture principles and guidelines
  - [ ] All new and modified files are documented

### Phase 11: Installation & Distribution Hardening
- [ ] Objectives
  - [ ] Evaluate Claude Code Plugins as potential distribution mechanism
  - [ ] Finalize installer scripts for bash wrappers, assets, and dual-scope support
  - [ ] Implement migration utilities (legacy bash `.conf` → YAML domain files)
  - [ ] Ensure dev-hooks scripts and production scripts are either the same or do the same
- [ ] Relevant documents/sections
  - [ ] `{project_root_dir}/docs/ARCHITECTURE.md` (§4 Installation & Distribution)
  - [ ] `{project_root_dir}/docs/design/CLI.md` (§3 Hook Wrapper Layer, §6 Scope Resolution)
  - [ ] `{project_root_dir}/docs/design/CONFIG-SYSTEM.md` (§3 Configuration Domains, §4 Configuration Cascade) — **YAML format spec**
- [ ] **11.1 Installer Implementation**
  - [ ] Hook wrapper generation: bash scripts that invoke `npx @sidekick/cli` or global install
  - [ ] Asset bundling: copy `assets/sidekick/` to installed location
  - [ ] Dual-scope detection: warn when both user and project hooks are installed
  - [ ] CLI commands: `sidekick install --project`, `sidekick install --user`, `sidekick uninstall`
- [ ] **11.2 Config Migration**
  - [ ] Legacy `.conf` → YAML converter: parse bash-style key=value, emit domain YAML files
  - [ ] `sidekick.config` support: unified override file with dot-notation (per docs/design/CONFIG-SYSTEM.md §4.2)
  - [ ] Migration reporting: show what was converted, warn on unrecognized keys
- [ ] **11.3 Distribution Options**
  - [ ] npm package: `@sidekick/cli` with `npx` support
  - [ ] Global install: `npm i -g @sidekick/cli`
  - [ ] Claude Code Plugins: evaluate if/how to integrate
- [ ] Testing
  - [ ] Installer integration tests in isolated temp directories
  - [ ] Migration tests: legacy config → YAML round-trip verification
  - [ ] Dual-scope tests: verify precedence when both scopes installed
- [ ] Acceptance criteria
  - [ ] Installer produces working hook wrappers in both scopes
  - [ ] Project hooks take precedence when dual installs detected
  - [ ] Bundled assets match `assets/sidekick/` HEAD
  - [ ] Migration tool converts legacy configs with clear reporting
  - [ ] All new and modified files documented
  - [ ] All applicable ROADMAP.md tasks are marked complete

### Phase 12: Documentation & Polish
- [ ] Objectives
  - [ ] Finalize user-facing documentation
  - [ ] Clean up development artifacts
  - [ ] Prepare for release
- [ ] **12.1 Documentation**
  - [ ] Update README.md for TypeScript runtime (replace bash-focused content)
  - [ ] User guide: installation, configuration, troubleshooting
  - [ ] Developer guide: architecture overview, contributing
  - [ ] Ensure all LLDs are current with implementation
  - [ ] Ensure all source code documentation is up-to-date (not in conflict with requirements or implementation), clean and lean (not over-documenting), and remove all references to implementation phases (how we planned the work should be irrelevant to code documentation).
- [ ] **12.2 Cleanup**
  - [ ] Remove or archive stale files (legacy scripts not in development-tools/)
  - [ ] Verify all `// TODO` and `// FIXME` comments addressed
  - [ ] Final lint/typecheck/test pass
  - [ ] CI enforces coverage thresholds (deferred from 9.1)
- [ ] **12.3 Release Preparation**
  - [ ] Version bump and changelog
  - [ ] npm publish dry-run
  - [ ] Final dual-scope verification
- [ ] Acceptance criteria
  - [ ] README accurately reflects TypeScript runtime
  - [ ] No stale/orphaned files in repository
  - [ ] All tests passing, zero lint warnings
  - [ ] Package ready for npm publish
  - [ ] All applicable ROADMAP.md tasks are marked complete
