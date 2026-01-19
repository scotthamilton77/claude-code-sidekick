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

### Phase 10: Feature Parity and Legacy Cleanup - COMPLETE 2026-01-19

Audited and cleaned up legacy implementations. Key outcomes:

**10.1 Legacy Audit**: Comprehensive audit of bash runtime, benchmark-next, and scripts
- Core infrastructure ~95% parity, LLM integration ~75%, Features 100%
- benchmark-next relocated to `development-tools/llm-eval/` and archived (91% complete, unvalidated)
- Intentional simplifications documented (sleeper→event-driven, circuit breaker→FallbackProvider)

**10.2 Migration Tasks**: Ported and retired legacy scripts
- OpenRouter provider routing (allowlist/blocklist) implemented
- `dev-mode.sh` → TypeScript CLI command (16 tests, 88% coverage)
- Retired: `analyze-session-at-line.sh`, `bulk-session-summary.sh`, `collect-test-data.sh`, `copy-config.sh`
- Reimagined: `generate-reminder-template.sh` → sidekick-config skill

**10.3 Legacy Cleanup**: Documentation and archival
- Updated `development-tools/llm-eval/` README to reflect archived status
- Archived `llm-eval/ROADMAP.md`, deleted obsolete `docs/benchmark-migration.md`
- Bash runtime disposition and AGENTS.md update deferred to Phase 11/12

---

### Phase 11: Installation & Distribution Hardening
All items redesigned and being implemented per docs/plans/2026-01-19-installation-distribution-design.md

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
