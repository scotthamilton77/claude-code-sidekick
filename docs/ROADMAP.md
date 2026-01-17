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

---

## Pending Phases

### Phase 9: Refactoring & Architecture Improvements

Comprehensive refactoring to improve code quality, test coverage, and architectural consistency. Sub-phases can run in parallel where noted.

- [x] **9.1 Test Coverage Foundation** - COMPLETE 2025-01-12
  - [x] Objectives
    - [x] Establish safety net before major refactoring
    - [x] Target 90%+ coverage for code that should be tested
  - [x] **9.1.1 Coverage Analysis** - COMPLETE 2025-01-11
    - [x] Comprehensive audit of current coverage across all packages
    - [x] Identify gaps in critical paths (handlers, services, IPC)
    - [x] Evaluate existing exclusions - are we missing something important?
    - **Baseline**: 83.02% (8,149/9,815 statements)
  - [x] **9.1.2 Configure Exclusions** - COMPLETE 2025-01-11
    - [x] Add emulators to exclusion list (test infrastructure, not production code)
    - [x] Document exclusion rationale in vitest.config.ts comments
  - [x] **9.1.3 Increase Coverage** - COMPLETE 2025-01-12
    - [x] **context-metrics-service.ts**: 23 tests added (12% → 55%)
    - [x] **completion-classifier.ts**: 11 tests added (52% → 99%)
    - [x] **staging handlers**: 6 tests added (55% → 88%)
    - Remaining files (context-overhead-reader, instrumented-profile-factory) deferred as 90% target met
  - [x] Acceptance criteria
    - [x] **90.08%** line coverage achieved (exceeds 90% target)
    - [x] Coverage config documents all exclusions with rationale
    - [o] CI enforces coverage thresholds (deferred to Phase 12)

- [x] **9.2 Architecture Review & Findings** - COMPLETE 2026-01-12
  - [x] Objectives
    - [x] Systematic audit of codebase architecture
    - [x] Produce prioritized findings document for subsequent phases
  - [x] **9.2.1 Feature/Hook Modularization Audit** - **Grade: A (no violations)**
    - Handler architecture is clean and well-modularized
    - All 13 handlers in correct locations with proper separation of concerns
    - Registration patterns consistent across all features
  - [x] **9.2.2 Daemon/CLI Coupling Audit** - **4 high-severity issues found**
    - P&R baseline management in daemon.ts (should be in feature-reminders)
    - VC state management in daemon.ts (should be in feature-reminders)
    - 90+ path constructions need PathResolver abstraction
    - Reminder names hardcoded in daemon core
  - [x] **9.2.3 Reminder Relationship Mapping** - **4 cross-reminder rules documented**
    - P&R unstages VC (cascade prevention)
    - UserPromptSubmit unstages VC (task complete)
    - VC consumption resets P&R baseline
    - VC consumption unstages P&R (prevent double block)
    - Rules scattered across handlers, candidates for orchestrator
  - [x] **9.2.4 State Access Pattern Inventory** - **40+ access points cataloged**
    - No centralized StateWriter abstraction
    - Path construction duplicated across 7+ files
    - Inconsistent Zod validation (state-reader uses it, others don't)
    - Non-atomic writes in some handlers
  - [x] **9.2.5 TODO/FIXME/@deprecated Scan** - **9 FIXMEs, 7 deprecated items**
    - 5 FIXMEs in structured-logging.ts: event definitions should move to feature packages
    - 1 FIXME in daemon.ts:624: P&R baseline should move to feature handler
    - 7 deprecated APIs with clear migration paths (initialize→prepare+start pattern)
  - [x] Acceptance criteria
    - [x] Findings in `docs/architecture-review/9.2.*.md`
    - [x] Each finding has severity and scope estimate
    - [x] Prioritized backlog for 9.3-9.6 phases

- [ ] **9.3 State Management Infrastructure** (foundational - informed by 9.2.4 findings)
  - Design: [docs/plans/2026-01-12-state-service-design.md](./plans/2026-01-12-state-service-design.md)
  - [ ] Objectives
    - [ ] Centralize state access behind clean abstractions
    - [ ] Eliminate 90+ duplicated path constructions
    - [ ] Consistent atomic writes and Zod validation
    - [ ] Clean code: no @deprecation, no need to preserve backward compatibility
  - [x] **9.3.1 StateService Core** (unified service - merges StateManager) - COMPLETE 2026-01-12
    - [x] Create `StateService` class in `@sidekick/core/src/state/`
    - [x] `PathResolver` as package-private internal (not exported)
    - [x] Generic `read<T>()` with optional default (throws if missing and no default)
    - [x] Generic `write<T>()` with atomic writes (tmp + rename) and Zod validation
    - [x] `delete()` and `rename()` for StagingService support
    - [x] Optional caching (daemon enables, CLI doesn't)
    - [x] `StateNotFoundError` and `StateCorruptError` for error handling
    - [x] Corrupt file recovery (move to `.bak`, return default or throw)
  - [x] **9.3.2 Add Missing Schemas** (owned by writer packages) - COMPLETE 2026-01-12
    - [x] `SummaryCountdownStateSchema` - already exists in @sidekick/types
    - [x] `CompactionHistorySchema` in sidekick-core (+ pruning to last N entries)
  - [x] **9.3.3 Migrate Writers** (priority order - writers define contracts) - COMPLETE 2026-01-15
    - [x] TranscriptService - transcript-metrics.json, compaction-history.json - COMPLETE 2026-01-12
    - [x] Session summary handlers - session-summary.json, summary-countdown.json, resume-message.json
    - [x] Daemon IPC handlers - pr-baseline.json, vc-unverified.json, daemon-log-metrics.json
    - [x] StagingService - stateService now required, removed sync methods (dead code)
    - [x] Session summary handlers - snarky-message.json (converted from .txt) - COMPLETE 2026-01-13
    - [x] CLI log metrics - cli.ts writes cli-log-metrics.json (already migrated)
    - [x] Instrumented LLM provider - llm-metrics.json reads/writes (already migrated)
  - [x] **9.3.4 Migrate Readers** - COMPLETE 2026-01-15
    - [x] StateReader (feature-statusline) - uses StateService internally
    - [x] discoverPreviousResumeMessage() - uses StateService for file reads
    - [x] stage-pause-and-reflect.ts - reads pr-baseline.json via stateService
    - [x] unstage-verify-completion.ts - reads/deletes vc-unverified.json via stateService
    - [x] context-overhead-reader.ts - uses StateService for baseline metrics
    - [x] runtime.ts - reads cli-log-metrics.json (already migrated in 9.3.3)
    - [x] UI handlers - **Intentional exception**: read-only, separate package (@sidekick/ui) without @sidekick/core dependency. Benefits of StateService (atomic writes, backup) don't apply to readers.
  - [x] **9.3.5 Cleanup (Phase A)** - COMPLETE 2026-01-17
    - [x] Remove `DerivedPaths` from config.ts (replaced by StateService path accessors)
    - [x] Mark `StateReader` complete - already uses composition pattern with typed accessors
  - [x] **9.3.6 StateService DevMode Backup** (consolidate backup logic) - COMPLETE 2026-01-17
    - [x] Add `config?: StateServiceConfig` option to StateServiceOptions (minimal interface with just `core.development.enabled`)
    - [x] Add private `backupBeforeWrite()` method to StateService (timestamped copy)
    - [x] In `write()`: if `config?.core.development.enabled`, backup before overwrite
    - [x] Remove `backupIfDevMode()` calls from handlers (update-summary.ts)
    - [x] Update tests to verify backup behavior with mock config (5 test cases)
  - [x] **9.3.7 Cleanup (Phase B)** - COMPLETE 2026-01-17
    - [x] Delete `StateManager` from sidekick-daemon (merged into StateService)
    - [x] Delete `backupIfDevMode()` from file-utils.ts (moved to StateService)
  - [x] **9.3.8 ContextMetricsService Migration** - COMPLETE 2026-01-17
    - [x] Refactor `context-metrics-service.ts` to use StateService for all state operations
    - [x] Remove 3 non-atomic writes (now uses StateService.write() with atomic tmp+rename)
    - [x] Remove 4 direct path constructions (now uses globalStatePath/sessionStatePath)
    - [x] Delete duplicate schemas from `context-metrics/types.ts` - re-exports from `@sidekick/types`
    - [x] Added `stateDir` option to StateServiceOptions for user-level state (stateDir: '' means no .sidekick prefix)
    - [x] Added `lastErrorAt` and `lastErrorMessage` fields to BaseTokenMetricsStateSchema
    - Note: Remaining fs/path usage is for reading Claude's transcript files (~/.claude/projects/), not sidekick state
  - [ ] **9.3.9 Path Construction Cleanup** (7 files remaining with direct path construction)
    - [ ] daemon.ts - 6 locations (lines 129, 187, 736, 856, 1016, 1405)
    - [ ] config-watcher.ts - line 71
    - [ ] cleanup.handler.ts - line 49
    - [ ] ipc/transport.ts - 5 locations (lines 66, 70, 78, 86, 97) - Note: IPC paths may need special handling
    - [ ] statusline.ts - line 145
    - [ ] cli.ts - line 210
    - [x] context-overhead-reader.ts - COMPLETE (uses StateService path accessors, done in 9.3.8)
  - [ ] **9.3.10 Schema Validation on All Reads**
    - [ ] staging-service.ts - add Zod validation (lines 204-205, 283-284)
    - [ ] cli-staging-reader.ts - add Zod validation (line 60-61)
    - [ ] transcript-service.ts - add Zod validation for TranscriptEntry (lines 376, 643, 1023)
  - [ ] Acceptance criteria
    - [x] Single `StateService` instance per process (DI pattern)
    - [ ] All state writes use atomic pattern
    - [ ] Schema validation on all state reads
    - [x] Schemas centralized in `@sidekick/types` (no duplicates) - replaces "domain packages own schemas"
    - [ ] No direct path construction outside StateService
    - [ ] No direct fs read/write for state files outside StateService (UI package exempted - read-only)
    - [x] Dev mode backups automatic via StateService (no manual `backupIfDevMode` calls)

- [ ] **9.4 Config Source-of-Truth** (lower priority - no issues found in 9.2)
  - [ ] Objectives
    - [ ] YAML files are single source of truth for defaults
    - [ ] Prevent configuration drift
    - [ ] Clean code: no @deprecation, no need to preserve backward compatibility
  - [ ] **9.4.1 Audit & Establish Source of Truth**
    - [ ] Find all Zod schemas with `.default()` calls
    - [ ] Ensure all defaults exist in YAML files in `assets/sidekick/defaults/`
    - [ ] Config loading fails hard if required values missing
  - [ ] **9.4.2 Enforcement**
    - [ ] Add test: all config keys have YAML defaults
  - [ ] Acceptance criteria
    - [ ] No Zod `.default()` for configuration values
    - [ ] Config parse failures are hard errors

- [ ] **9.5 Feature Domain Consolidation** (minimal - 9.2.1 found architecture already clean)
  - [ ] Objectives
    - [ ] Move remaining feature code from daemon.ts to feature packages
    - [ ] Note: 9.2.1 audit found handler architecture is already Grade A - no structural refactoring needed
    - [ ] Clean code: no @deprecation, no need to preserve backward compatibility
  - [ ] **9.5.1 Move Reminder State Logic from Daemon** (from 9.2.2 findings)
    - [ ] Move P&R baseline management (`pr-baseline.json` writes) from daemon.ts:624 to feature-reminders handler
    - [ ] Move VC state management (`vc-unverified.json`, IPC handlers) from daemon.ts:642-705 to feature-reminders
    - [ ] Remove reminder name hardcoding (`'verify-completion'`) from daemon core
  - [ ] **9.5.2 Move Event Definitions to Feature Packages** (from 9.2.5 FIXMEs)
    - [ ] Move `ReminderConsumed` event from structured-logging.ts to feature-reminders
    - [ ] Move `ReminderStaged` event from structured-logging.ts to feature-reminders
    - [ ] Move `RemindersCleared` event from structured-logging.ts to feature-reminders
    - [ ] Move `SummaryUpdated` event from structured-logging.ts to feature-session-summary
    - [ ] Move `SummarySkipped` event from structured-logging.ts to feature-session-summary
  - [ ] Acceptance criteria
    - [ ] daemon.ts has no reminder-specific logic or hardcoded reminder names
    - [ ] Feature packages own their event definitions
    - [ ] All 5 FIXME comments in structured-logging.ts resolved

- [ ] **9.6 Reminder Orchestration** (informed by 9.2.3 findings - 4 cross-reminder rules)
  - [ ] Objectives
    - [ ] Centralize 4 cross-reminder rules currently scattered across handlers
    - [ ] Replace scattered `deleteReminder()` calls with declarative rule engine
    - [ ] Clean code: no @deprecation, no need to preserve backward compatibility
  - [ ] **9.6.1 Design Rule Engine**
    - [ ] `ReminderOrchestrator` in `feature-reminders` with declarative rules:
      - Rule 1: P&R staged → unstage VC (cascade prevention)
      - Rule 2: UserPromptSubmit → unstage VC or re-stage if unverified
      - Rule 3: VC consumed → reset P&R baseline
      - Rule 4: VC consumed → unstage P&R (prevent double block)
  - [ ] **9.6.2 Centralize Baseline State**
    - [ ] Move `pr-baseline.json` management from IPC to orchestrator service
    - [ ] Clear read/write semantics for baseline state
  - [ ] **9.6.3 Simplify Handlers**
    - [ ] Remove scattered `deleteReminder()` calls from: stage-pause-and-reflect.ts, unstage-verify-completion.ts, inject-stop.ts
    - [ ] Handlers call orchestrator instead of direct coordination
  - [ ] Acceptance criteria
    - [ ] 4 cross-reminder rules in single declarative location
    - [ ] Handlers have single responsibility (no cross-reminder logic)
    - [ ] Adding new reminder type doesn't require modifying existing handlers

- [ ] **9.7 Code Cleanup & Documentation Polish** (after refactoring stabilizes)
  - [ ] Objectives
    - [ ] Remove deprecated APIs and resolve remaining FIXMEs
    - [ ] Documentation matches implementation
    - [ ] Clean code: no @deprecation, no need to preserve backward compatibility
  - [ ] **9.7.1 Remove Deprecated APIs** (from 9.2.5 scan - 7 items)
    - [ ] Remove `initialize()` → use `prepare()` + `start()` pattern (3 locations)
    - [ ] Remove `getTranscriptService()` → use `prepareTranscriptService()` (2 locations)
    - [ ] Remove `getSessionState()` → use `getTranscriptMetrics()` (1 location)
    - [ ] Remove `SessionMetricsState` type alias → use `TranscriptMetricsState` (2 locations)
  - [ ] **9.7.2 Address Remaining FIXMEs** (from 9.2.5 scan)
    - [ ] structured-logging.ts:383 - Extract event routing logic from logging setup
    - [ ] transcript-service.ts:1439 - Remove old `currentContextTokens` backward compat
    - [ ] types/config.ts:15 - Review minimal interface pattern
  - [ ] **9.7.3 Documentation Cleanup**
    - [ ] Remove phase references from code comments
    - [ ] Update design docs if implementation diverged
  - [ ] Acceptance criteria
    - [ ] No @deprecated APIs remain
    - [ ] All FIXMEs addressed or converted to tracked issues
    - [ ] Design docs current with implementation


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
    - **Port HIGH**: `dev-mode.sh` (CLI command), `analyze-session-at-line.sh` (keep bash as fallback)
    - **Port MEDIUM**: `bulk-session-summary.sh`, `collect-test-data.sh`, `copy-config.sh`, `generate-reminder-template.sh`
    - **Port LOW**: `kill-sidekick-processes.sh`, `find-orphaned-processes.sh`, `generate-model-report.py`
    - **Archive**: `simulate-session.py` (refactor to TypeScript integration tests), legacy shell tests
- [ ] **10.2 Migration Tasks**
  - [ ] **OpenRouter Provider Routing**: Add allowlist/blocklist support to filter unreliable providers
    - Config: `llm.openrouter.providerAllowlist`, `llm.openrouter.providerBlocklist`
    - Implementation: Add `provider` field to OpenRouter request body (see OpenRouter API docs)
    - Location: `@sidekick/shared-providers` factory or dedicated OpenRouter provider class
  - [ ] **Script Ports (HIGH priority)**:
    - [ ] `dev-mode.sh` → `packages/sidekick-cli/src/commands/dev-mode.ts`
    - [ ] `analyze-session-at-line.sh` → `packages/sidekick-cli/src/commands/analyze-session.ts` (keep bash as fallback)
  - [ ] **Script Ports (MEDIUM priority)**:
    - [ ] `bulk-session-summary.sh` → `packages/sidekick-cli/src/commands/bulk-analyze.ts`
    - [ ] `collect-test-data.sh` → `packages/testing-fixtures/` or CLI command
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
