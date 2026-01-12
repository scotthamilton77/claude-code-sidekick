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

- [ ] **9.1 Test Coverage Foundation** (prerequisite for safe refactoring)
  - [ ] Objectives
    - [ ] Establish safety net before major refactoring
    - [ ] Target 90%+ coverage for code that should be tested
  - [x] **9.1.1 Coverage Analysis** - COMPLETE 2025-01-11
    - [x] Comprehensive audit of current coverage across all packages
    - [x] Identify gaps in critical paths (handlers, services, IPC)
    - [x] Evaluate existing exclusions - are we missing something important?
    - **Baseline**: 83.02% (8,149/9,815 statements) — Gap to 90%: ~685 statements
    - **Low coverage files identified**:
      | File | Coverage | Uncovered | Priority |
      |------|----------|-----------|----------|
      | `context-metrics-service.ts` | 12% | 321 stmts | HIGH |
      | `completion-classifier.ts` | 52% | 62 stmts | HIGH |
      | `staging handlers` | 55% | 101 stmts | HIGH |
      | `context-overhead-reader.ts` | 32% | ~47 stmts | MEDIUM |
      | `instrumented-profile-factory.ts` | 18% | ~62 stmts | MEDIUM |
  - [ ] **9.1.2 Configure Exclusions**
    - [ ] Add emulators to exclusion list (test infrastructure, not production code)
      ```typescript
      // vitest.config.ts - add to exclude array:
      'packages/shared-providers/src/providers/emulators/**',  // LLM test emulators
      ```
    - [ ] Document exclusion rationale in vitest.config.ts comments
  - [ ] **9.1.3 Increase Coverage** (prioritized by impact)
    - [ ] **context-metrics-service.ts** (321 uncovered statements)
      - Service orchestrates transcript parsing and metric aggregation
      - Needs: mock TranscriptService, test metric calculation flows
      - Tests: initialization, metric updates, error handling
    - [ ] **completion-classifier.ts** (62 uncovered statements)
      - Main `classifyCompletion()` function untested
      - Needs: mock LLM provider responses
      - Tests: CLAIMING_COMPLETION classification, error fallbacks, disabled state
    - [ ] **staging handlers** (101 uncovered statements)
      - `stage-default-user-prompt.ts` (76%) - minor gaps
      - `task-completion.ts` handler if exists
      - Tests: threshold logic, suppression patterns
    - [ ] **context-overhead-reader.ts** (47 uncovered statements)
      - No test file exists
      - Needs: mock file system reads
      - Tests: file missing, corrupt JSON, Zod validation errors
    - [ ] **instrumented-profile-factory.ts** (62 uncovered statements)
      - Factory for creating instrumented LLM profiles
      - Tests: profile creation, fallback behavior
  - [ ] Acceptance criteria
    - [ ] 90%+ line coverage for non-excluded code
    - [ ] Coverage config documents all exclusions with rationale
    - [ ] CI enforces coverage thresholds

- [ ] **9.2 Architecture Review & Findings** (research phase - produces actionable findings)
  - [ ] Objectives
    - [ ] Systematic audit of codebase architecture
    - [ ] Produce prioritized findings document for subsequent phases
  - [ ] **9.2.1 Feature/Hook Modularization Audit**
    - [ ] Inventory: where does handler code live?
    - [ ] Find: feature logic leaking into wrong domains
    - [ ] Find: hook-specific logic outside handler files
    - [ ] Assess: is handler registration consistent across features?
  - [ ] **9.2.2 Daemon/CLI Coupling Audit**
    - [ ] Find: implementation details in Daemon/CLI core that belong in feature packages
    - [ ] Find: duplicated data structures across Daemon and CLI
    - [ ] Find: hardcoded paths, magic strings, format assumptions
  - [ ] **9.2.3 Reminder Relationship Mapping**
    - [ ] Document: current cross-reminder rules (UserPromptSubmit unstages others, etc.)
    - [ ] Document: counter resets, suppression logic, priority interactions
    - [ ] Identify: where these rules are implemented (scattered vs centralized)
  - [ ] **9.2.4 State Access Pattern Inventory**
    - [ ] Catalog: all state file access points across packages
    - [ ] Catalog: path construction patterns, file formats, validation
    - [ ] Identify: duplication, inconsistencies, missing abstractions
  - [ ] **9.2.5 TODO/FIXME/@deprecated Scan**
    - [ ] Find and categorize all TODO/FIXME comments
    - [ ] Find @deprecated usage and assess removal
    - [ ] Prioritize: which are blockers, which are nice-to-have
  - [ ] Acceptance criteria
    - [ ] Findings document with categorized issues
    - [ ] Each finding has severity and scope estimate
    - [ ] Prioritized backlog for 9.3-9.6 phases

- [ ] **9.3 State Management Infrastructure** (foundational - parallel with 9.4)
  - [ ] Objectives
    - [ ] Centralize state access behind clean abstractions
    - [ ] No consumer should know file paths, formats, or storage details
    - [ ] Extensible design: domain-specific subclasses handle domain nuances
  - [ ] **9.3.1 Design**
    - [ ] Base `StateManager` in `@sidekick/core`: generic registration, get/put interface
    - [ ] Consumers register: state key, schema validator, serialization hints
    - [ ] Domain subclasses (e.g., `ReminderStateManager` in `feature-reminders`) add domain logic
    - [ ] Scope: `.sidekick/state/*`, `.sidekick/sessions/*/state/*`, `.sidekick/sessions/*/stage/*`
  - [ ] **9.3.2 Implement Base StateManager**
    - [ ] Generic state manager in `@sidekick/core`
    - [ ] Path resolution based on scope (global vs session)
    - [ ] Atomic writes, schema validation on read
  - [ ] **9.3.3 Implement Domain Extensions**
    - [ ] `SessionSummaryState` manager in `feature-session-summary`
    - [ ] `ReminderState` manager in `feature-reminders`
    - [ ] `TranscriptMetrics` manager (location TBD based on 9.2 findings)
  - [ ] **9.3.4 Migrate Existing Access**
    - [ ] Replace direct file access with state manager calls
    - [ ] Remove hardcoded path construction
  - [ ] Acceptance criteria
    - [ ] No direct `fs.readFile`/`writeFile` for state files outside state managers
    - [ ] All path construction centralized
    - [ ] Schema validation on all state reads

- [ ] **9.4 Config Source-of-Truth** (parallel with 9.3)
  - [ ] Objectives
    - [ ] YAML files are single source of truth for defaults
    - [ ] Zod schemas validate but fail hard on parse errors (no silent defaults)
    - [ ] Prevent configuration drift
  - [ ] **9.4.1 Audit**
    - [ ] Find all Zod schemas with `.default()` calls
    - [ ] Cross-reference with YAML config files in `assets/sidekick/defaults/`
    - [ ] Identify: defaults in Zod without corresponding YAML setting
  - [ ] **9.4.2 Establish Source of Truth**
    - [ ] Remove `.default()` from Zod schemas (or make them throw-on-missing)
    - [ ] Ensure all defaults exist in YAML files
    - [ ] Config loading fails hard if required values missing
  - [ ] **9.4.3 Enforcement**
    - [ ] Add test or lint rule: Zod schemas cannot use `.default()` for config values
    - [ ] Add test: all config keys have YAML defaults
  - [ ] Acceptance criteria
    - [ ] No Zod `.default()` for configuration values
    - [ ] Config parse failures are hard errors
    - [ ] CI prevents drift

- [ ] **9.5 Feature Domain Consolidation** (depends on 9.2 findings, 9.3 infrastructure)
  - [ ] Objectives
    - [ ] Features own both Daemon-side (staging) AND CLI-side (consumption) logic
    - [ ] Features own their state file schemas and access patterns
    - [ ] Daemon/CLI core contain no feature-specific implementation details
  - [ ] **9.5.1 Refactor Feature Packages**
    - [ ] Move feature logic from Daemon/CLI core into feature packages
    - [ ] Each feature exports: staging handlers, consumption handlers, state manager extension
    - [ ] Features register with core services, not embedded in them
  - [ ] **9.5.2 Clean Core Packages**
    - [ ] `sidekickd`: only lifecycle, IPC, task engine, handler dispatch
    - [ ] `sidekick-cli`: only argument parsing, command routing, IPC client
    - [ ] Remove any feature-specific conditionals or knowledge
  - [ ] Acceptance criteria
    - [ ] Adding a new feature requires no changes to Daemon/CLI core
    - [ ] Feature packages are self-contained
    - [ ] Core packages have no imports from feature packages (dependency inversion)

- [ ] **9.6 Reminder Orchestration** (depends on 9.2.3 findings)
  - [ ] Objectives
    - [ ] Encapsulate cross-reminder coordination rules
    - [ ] Keep individual handler code simple and single-responsibility
  - [ ] **9.6.1 Design Orchestrator**
    - [ ] `ReminderOrchestrator` in `feature-reminders`
    - [ ] Rules engine: "when X happens, do Y to reminders Z"
    - [ ] Examples: UserPromptSubmit unstages pending reminders, VerifyCompletion resets counters
  - [ ] **9.6.2 Implement Orchestrator**
    - [ ] Central place for cross-reminder business logic
    - [ ] Handlers delegate coordination decisions to orchestrator
  - [ ] **9.6.3 Simplify Handlers**
    - [ ] Handlers focus on single concern: stage/consume one reminder type
    - [ ] Orchestrator handles interactions between reminder types
  - [ ] Acceptance criteria
    - [ ] Cross-reminder rules documented in one place
    - [ ] Handlers have single responsibility
    - [ ] Adding new reminder type doesn't require modifying existing handlers

- [ ] **9.7 Code Documentation Polish** (after refactoring stabilizes)
  - [ ] Objectives
    - [ ] Documentation matches implementation
    - [ ] No stale references to implementation phases
  - [ ] **9.7.1 Code Documentation**
    - [ ] File headers describe purpose
    - [ ] Key data structures documented
    - [ ] Complex methods have explanatory comments
  - [ ] **9.7.2 Cleanup**
    - [ ] Remove phase references from code comments
    - [ ] Address or remove resolved TODOs
    - [ ] Update design docs if implementation diverged
  - [ ] Acceptance criteria
    - [ ] No "Phase N" references in code
    - [ ] Design docs current with implementation
    - [ ] New contributor can understand code from docs + comments


### Phase 10: Feature Parity and Legacy Cleanup
- [ ] Objectives
  - [ ] Audit legacy implementations against TypeScript rewrite for feature parity
  - [ ] Port remaining functionality not obsolete or in conflict with new designs; document intentional omissions
  - [ ] Clean up or archive legacy code
- [ ] Relevant documents/sections
  - [ ] `{project_root_dir}/docs/ARCHITECTURE.md` (§1 Guiding Principles)
  - [ ] `{project_root_dir}/docs/design/flow.md` (complete hook flows as feature reference)
- [ ] **10.1 Legacy Audit**
  - [ ] Audit `benchmark-next/` for unported features (early TypeScript exploration, largely stale)
  - [ ] Audit `src/sidekick/` (bash runtime) for behaviors not yet in TypeScript packages
  - [ ] Audit `scripts/` for analysis tools that should migrate (e.g., `analyze-session-at-line.sh`, `simulate-session.py`)
  - [ ] Audit transcript processing logic
  - [ ] Document feature gaps and create tasks for each
- [ ] **10.2 Migration Tasks** (populated by audit)
  - [ ] Placeholder: Tasks added based on audit findings
- [ ] **10.3 Legacy Cleanup**
  - [ ] Archive `benchmark-next/` (mark as superseded in README)
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
  - [ ] Remove or archive stale files (benchmark-next/, legacy scripts)
  - [ ] Verify all `// TODO` and `// FIXME` comments addressed
  - [ ] Final lint/typecheck/test pass
- [ ] **12.3 Release Preparation**
  - [ ] Version bump and changelog
  - [ ] npm publish dry-run
  - [ ] Final dual-scope verification
- [ ] Acceptance criteria
  - [ ] README accurately reflects TypeScript runtime
  - [ ] No stale/orphaned files in repository
  - [ ] All tests passing, zero lint warnings
  - [ ] Package ready for npm publish
