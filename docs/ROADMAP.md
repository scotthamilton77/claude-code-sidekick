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

- Split log files: `cli.log` / `supervisor.log`
- `source` field distinguishing CLI vs Supervisor
- `ContextLogger` with deep-merge context
- 8 logging event types (HookReceived, HookCompleted, ReminderStaged, etc.)
- UI wired to read real logs with filter/search capabilities

### Phase 4: Core Services & Providers - COMPLETE 2025-12-01

Built LLM providers, TranscriptService, and StagingService. Key outcomes:

**4.1 RuntimeContext Discriminated Union**: `CLIContext | SupervisorContext` with type guards, service interfaces in `@sidekick/types`

**4.2 TranscriptService Foundation**: Expanded `TranscriptMetrics` schema with token usage, cache tiers, per-model breakdown

**4.3 TranscriptService Implementation**: File watching (chokidar), incremental processing, compaction detection, metrics persistence

**4.4 StagingService**: Atomic file staging, suppression markers, sync/async APIs

**4.5 Integration & Verification**: End-to-end tests for Feature → LLM flow, TranscriptService → Handler flow, credential precedence

**4.6 UI Integration**: MetricsPanel with sparklines, Compaction Timeline markers, StateInspector tabs, API endpoints for session data

---

## Pending Phases

- [x] **Phase 5: Supervisor & Background Tasks** - COMPLETE 2025-12-04
  - [x] Objectives
    - [x] Implement the supervisor process with IPC socket, task engine, and single-writer state manager for shared files.
    - [x] Connect CLI commands to supervisor lifecycle (start/stop/version handshake) and delegate background tasks (e.g., session summary updates).
  - [x] Relevant documents/sections
    - [x] `{project_root_dir}/docs/ARCHITECTURE.md` (§3.7 Background Supervisor)
    - [x] `{project_root_dir}/docs/design/flow.md` (§2.1 CLI/Supervisor Relationship, §5 Complete Hook Flows) — **CLI/Supervisor interaction patterns**
    - [x] `{project_root_dir}/docs/design/SUPERVISOR.md` (§2 Process Architecture, §3 Communication Layer, §4 Subsystems) — **Supervisor process specification**
    - [x] `{project_root_dir}/docs/design/CLI.md` (§4 Supervisor Interaction, §7 Supervisor Lifecycle Management)
    - [x] `{project_root_dir}/docs/design/TRANSCRIPT-PROCESSING.md` (§2 Components, §6 Implementation Details) — **TranscriptService integration**
  - [x] Acceptance criteria (applies to all sub-phases)
    - [x] We're utilizing open source to its maximum potential - no unnecessary wheel reinvention!
    - [x] We're testing OUR code, not open source behaviors.
    - [x] Code complexity is kept low using stated architecture principles and guidelines. (See `docs/ARCHITECTURE.md` Guiding Principles).
    - [x] All new and modified files are documented in the project's documentation with header comments describing purpose and any breaking changes.
    - [x] Code-review agent has reviewed your work and all blocking issues have been addressed
    - [x] No suppressing lint or typescript errors unless architecturally justified - and then add rationale comment
    - [x] No lint or typescript warnings or errors
    - [x] All tests pass
  - [x] **5.1 Core Supervisor Process** - COMPLETE 2025-12-02
    - [x] Supervisor skeleton: entry point, signal handlers (SIGTERM, SIGINT), graceful shutdown
    - [x] IPC socket setup (Unix domain socket): `.sidekick/supervisor.sock`
    - [x] Version handshake protocol: CLI sends version, supervisor validates compatibility
    - [x] Token-based authentication for IPC connections (per docs/design/SUPERVISOR.md §3)
    - [x] Heartbeat mechanism: periodic health writes to `.sidekick/state/supervisor-status.json`
    - [x] Testing: Socket lifecycle, version handshake acceptance/rejection, auth token validation
    - [x] **Verification gate**: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
  - [x] **5.2 Task Engine & State Manager** - COMPLETE 2025-12-03
    - [x] Single-writer state manager: atomic JSON updates to `.sidekick/state/*.json`
    - [x] Task queue: enqueue, dequeue, priority ordering
    - [x] Task execution: worker pool (configurable concurrency), timeout handling
    - [x] Task types: `session_summary`, `resume_generation`, `cleanup`, `metrics_persist`
    - [x] Orphan prevention: tasks tracked in state via TaskRegistry, cleaned on supervisor restart
    - [x] Testing: State atomicity, queue ordering, timeout behavior, orphan cleanup
    - [x] **Verification gate**: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
  - [x] **5.3 TranscriptService Integration** - COMPLETE 2025-12-03
    - [x] Initialize TranscriptService on `SessionStart` handler (per docs/design/SUPERVISOR.md §4, docs/design/TRANSCRIPT-PROCESSING.md §6)
    - [x] Stop TranscriptService on `SessionEnd` handler
    - [x] Ensure `shutdown()` is called before process exit (watcher.close() releases handle)
    - [x] Implement HandlerRegistryImpl in sidekick-core with invokeHook() and emitTranscriptEvent()
    - [x] Add hook.invoke IPC method for CLI to dispatch events to Supervisor
    - [x] Testing: Lifecycle tests (initialize on SessionStart, stop on SessionEnd), handler dispatch tests
    - [x] **Verification gate**: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
  - [x] **5.4 Handler Event Dispatch & Staging** - COMPLETE 2025-12-04
    - [x] Wire HandlerRegistry into Supervisor for event dispatch (per docs/design/flow.md §2.3)
    - [x] `invokeHook()` for hook events received via IPC from CLI
    - [x] `emitTranscriptEvent()` called by TranscriptService when file changes detected
    - [x] Sequential execution for hook handlers, concurrent for transcript handlers
    - [x] Staging directory management (per docs/design/flow.md §2.2):
      - [x] Create session staging directories: `.sidekick/sessions/{session_id}/stage/{hook_name}/`
      - [x] Clean staging directories on `SessionStart` (type: startup|clear)
    - [x] Log to separate supervisor log file: `.sidekick/logs/supervisor.log` (per docs/design/STRUCTURED-LOGGING.md §2.2)
    - [x] Testing: Handler dispatch (sequential vs concurrent), staging directory lifecycle, log isolation
    - [x] **Verification gate**: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
  - [x] **5.5 CLI Integration & Graceful Fallback** - COMPLETE 2025-12-04
    - [x] CLI commands: `sidekick supervisor start`, `sidekick supervisor stop`, `sidekick supervisor status`
    - [x] Supervisor auto-start on first hook invocation (if not running)
    - [x] Connection pooling: reuse socket across hook invocations within CLI process
    - [x] Graceful degradation: CLI proceeds with sync paths when supervisor unavailable, logging warnings
    - [x] Timeout/retry logic for IPC calls (configurable via `config.yaml`)
    - [x] Testing: CLI lifecycle commands, auto-start behavior, fallback paths, timeout handling
    - [x] **Verification gate**: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
  - [x] **5.6 UI Integration** - COMPLETE 2025-12-04
    - [x] System Health dashboard (per packages/sidekick-ui/docs/MONITORING-UI.md §3.2.E)
      - [x] Read `.sidekick/state/supervisor-status.json` for health metrics
      - [x] Display: Uptime, Memory Usage (Heap/RSS), Queue Depth, Active Tasks
      - [x] Memory/queue sparklines for trend visualization
    - [x] Offline detection:
      - [x] Poll file mtime; if > 30s old, show "Supervisor Offline" state
      - [x] Red/grey badge with last-known timestamp
    - [x] Session state files (per packages/sidekick-ui/docs/MONITORING-UI.md §2.2):
      - [x] Read `.sidekick/sessions/{sessionId}/state/*.json`
      - [x] Read staged reminders from `.sidekick/sessions/{sessionId}/stage/{hookName}/*.json`
    - [x] Testing: Health dashboard tests, offline detection tests
    - [x] **Verification gate**: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`

- [x] **Phase 6: Feature Enablement & Integration** - COMPLETE 2025-12-13
  - [x] Objectives
    - [x] Implement feature packages using the unified handler model (hook events + transcript events)
    - [x] Features consume TranscriptService metrics via `ctx.transcript.getMetrics()` rather than maintaining independent counters
    - [x] Staging handlers run in Supervisor (transcript events); consumption handlers run in CLI (hook events)
  - [x] Relevant documents/sections
    - [x] `{project_root_dir}/docs/ARCHITECTURE.md` (§2.1 Package Structure, §3.3 Event Model, §3.4 TranscriptService)
    - [x] `{project_root_dir}/docs/design/flow.md` (§4 Reminder System, §5 Complete Hook Flows) — **handler registration patterns**
    - [x] `{project_root_dir}/docs/design/CORE-RUNTIME.md` (§6.10 Dual-Registration Patterns) — **event routing vs role discriminant**
    - [x] `{project_root_dir}/docs/design/FEATURE-SESSION-SUMMARY.md` (handler registration, LLM integration)
    - [x] `{project_root_dir}/docs/design/FEATURE-REMINDERS.md` (§3 Architecture, §3.3 Reminder File Schema) — **staging/consumption pattern**
    - [x] `{project_root_dir}/docs/design/FEATURE-STATUSLINE.md` (state rendering, supervisor integration)
    - [x] `{project_root_dir}/docs/design/FEATURE-RESUME.md` (artifact discovery, message generation)
    - [x] `{project_root_dir}/docs/design/TRANSCRIPT-PROCESSING.md` (§3 Metrics System, §5 Event Emission)
    - [x] `{project_root_dir}/docs/design/TEST-FIXTURES.md` (§4 Test Data Management)
  - [x] Testing
    - [x] Tests for handler registration and filter matching
    - [x] Tests for staging/consumption flow with mock TranscriptService metrics
    - [x] End-to-end flows against recorded transcripts in `test-data/`
  - [x] Acceptance criteria
    - [x] We're utilizing open source to its maximum potential - no unnecessary wheel reinvention!
    - [x] We're testing OUR code, not open source behaviors.
    - [x] Code complexity is kept low using stated architecture principles and guidelines. (See `docs/ARCHITECTURE.md` Guiding Principles).
    - [x] Features register handlers via `ctx.handlers.register()` with appropriate filters (hook vs transcript events)
    - [x] Features consume metrics from `ctx.transcript.getMetrics()` - no independent counters
    - [x] Staging/consumption separation: Supervisor handles staging, CLI handles consumption
    - [x] Dual-scope parity verified: features behave identically in user and project contexts
    - [x] All new and modified files are documented in the project's documentation with header comments describing purpose and any breaking changes.
  - [x] **6.1 Reminders Feature** (`feature-reminders/`) - COMPLETE 2025-12-04
    - [x] Implement `ReminderUtils` module: `resolveReminder()`, `stageReminder()`, `consumeReminder()`, `suppressHook()`
    - [x] Staging handlers (Supervisor, transcript events per docs/design/FEATURE-REMINDERS.md §3.1):
      - [x] `StageDefaultUserPromptReminder` (SessionStart hook)
      - [x] `StageAreYouStuckReminder` (ToolCall transcript, `toolsThisTurn >= stuck_threshold`)
      - [x] `StageTimeForUserUpdateReminder` (ToolCall transcript, `toolsThisTurn >= update_threshold`)
      - [x] `StageStopReminders` (ToolCall transcript, on file edit tools)
    - [x] Consumption handlers (CLI, hook events):
      - [x] `InjectUserPromptSubmitReminders`, `InjectPreToolUseReminders`, `InjectPostToolUseReminders`, `InjectStopReminders`
    - [x] Suppression pattern: marker files `.sidekick/sessions/{session_id}/stage/{hook_name}/.suppressed`
    - [x] Reminder file schema: `StagedReminder { name, blocking, priority, persistent, userMessage?, additionalContext?, stopReason? }`
  - [x] **6.2 Session Summary Feature** (`feature-session-summary/`) ✓ COMPLETED
    - [x] Package scaffold (`@sidekick/feature-session-summary`)
    - [x] Types: `SessionSummaryState`, `SummaryCountdownState`, config types
    - [x] Event types: `SummaryUpdatedEvent`, `SummarySkippedEvent` in `@sidekick/types`
    - [x] `CreateFirstSessionSummary` handler (SessionStart) - placeholder summary
    - [x] `UpdateSessionSummary` handler (UserPrompt, ToolCall transcript events)
    - [x] Countdown-based throttling with confidence reset logic
    - [x] Summary state: `.sidekick/sessions/{session_id}/state/session-summary.json`
    - [x] Prompt templates: `session-summary.prompt.txt`, `snarky-message.prompt.txt`, `resume-message.prompt.txt`
    - [x] Response schemas: `session-summary.schema.json`, `resume-message.schema.json`
    - [x] Unit tests for handler registration (28 tests)
    - [x] LLM integration: Wire `ctx.llm.complete()` into `performAnalysis()` with Zod validation
    - [x] Added `resolve()` to `MinimalAssetResolver` interface for prompt template loading
    - [x] Transcript extraction via `ctx.transcript.getExcerpt()` (unblocked by 6.2.1)
    - [x] Snarky message generation side-effect (separate LLM call)
    - [x] Resume message generation side-effect (pivot detection)
    - [x] Unit tests for side-effect generation (7 tests)
  - [x] **6.2.1 TranscriptService Completion** ✓ COMPLETED
    - [x] Investigate gap: design doc (`TRANSCRIPT-PROCESSING.md §2.2.5`) specifies `getTranscript()` and `getExcerpt()` but interface missing
    - [x] Define types: `ExcerptOptions`, `TranscriptExcerpt`, `Transcript`, `CanonicalTranscriptEntry` (per design doc §2.1.3)
    - [x] Add `getExcerpt(options: ExcerptOptions): TranscriptExcerpt` to `TranscriptService` interface
    - [x] Add `getTranscript(): Transcript` to `TranscriptService` interface
    - [x] Implement excerpt extraction with bookmark strategy support:
      - [x] Bookmark-based windowing: prioritize recent context after bookmark
      - [x] Fallback: tail last N lines if no bookmark set
      - [x] Format entries for LLM context (USER/ASSISTANT/TOOL/RESULT labels)
    - [x] Update `update-summary.ts` to use `ctx.transcript.getExcerpt()` instead of direct `fs.readFile()`
    - [x] Update `MockTranscriptService` with `getExcerpt()` and `setMockExcerptContent()` test utility
    - [x] Tests for `getExcerpt()` with bookmark scenarios
  - [x] **6.3 Statusline Feature** (`feature-statusline/`) - COMPLETE
    - [x] Package scaffold with Zod schemas (StatuslineConfig, SessionState, SessionSummary)
    - [x] StateReader: Safe JSON reading with fallback defaults, staleness detection
    - [x] GitProvider: Branch detection with 10ms timeout protection
    - [x] Formatter: Template interpolation with ANSI color support, threshold coloring
    - [x] StatuslineService: Parallel data fetching, display mode selection, view model building
    - [x] CLI command: `sidekick statusline [--format text|json]`
    - [x] Unit tests (25 tests covering formatter, state reader, service)
  - [x] **6.4 Resume Feature** (`feature-resume/`) - COMPLETE 2025-12-13
    - [x] Generate resume message on significant title change (implemented as side-effect in `UpdateSessionSummary`)
    - [x] Artifact discovery from session state (`discoverPreviousResumeMessage()` in StateReader)
    - [x] Resume logging events: `ResumeGenerating`, `ResumeUpdated`, `ResumeSkipped` in @sidekick/types
    - [x] LogEvents factory functions for resume events in sidekick-core
    - [x] StatuslineService integration: discovers previous session's resume-message.json for new sessions
  - [x] **6.5 UI Integration** - COMPLETE 2025-12-13
    - [x] Reminder event visualization (per packages/sidekick-ui/docs/MONITORING-UI.md §4.1):
      - [x] `ReminderStaged` cards with name, priority, blocking status
      - [x] `ReminderConsumed` cards showing which reminder was returned
      - [x] `RemindersCleared` events on SessionStart
    - [x] Session summary event cards:
      - [x] `SummaryUpdated` with state diff and reason (cadence_met, title_change, etc.)
      - [x] Expandable payload view for full summary state
    - [x] Decision Log view (per packages/sidekick-ui/docs/MONITORING-UI.md §3.2.D):
      - [x] Filtered view of decision events (Summary, Reminder, Context Prune, Handler)
      - [x] Show system reasoning chain via trace grouping
    - [x] End-to-end flow visualization:
      - [x] Trace `UserPromptSubmit` → `HandlerExecuted` → `SummaryUpdated` → `ReminderConsumed`
      - [x] Use `context.traceId` to link causally-related events (`trace-correlator.ts`)
    - [x] Testing: trace-correlator tests (17), event-adapter extraction tests (30)
      - Note: React component tests excluded per vitest.config.ts (deliberate scope limitation)

- [ ] **Phase 7: Monitoring UI Completion & Hardening**
  - [ ] Objectives
    - [ ] Close remaining gaps against `packages/sidekick-ui/docs/MONITORING-UI.md` so the UI is truly usable for time-travel debugging (not just log viewing).
    - [ ] Replace mock-only state inspection with real, compaction-aware, replay-derived state inspection.
    - [ ] Make the Monitoring UI runnable outside Vite dev mode (production-local runtime) while preserving dual-scope behavior.
    - [ ] Improve performance and robustness for large sessions/logs.
  - [ ] Relevant documents/sections
    - [ ] `packages/sidekick-ui/docs/MONITORING-UI.md` (§3.1 Compaction Timeline, §3.2 Time Travel, §5 Unified Cockpit)
    - [ ] `{project_root_dir}/docs/design/flow.md` (§3.2 Event Schema)
    - [ ] `{project_root_dir}/docs/design/STRUCTURED-LOGGING.md` (§2.2 Log File Strategy, §3 Log Record Format)
    - [ ] `{project_root_dir}/docs/design/TRANSCRIPT-PROCESSING.md` (§3 Metrics System, §4.2 Compaction History Schema)
    - [ ] `{project_root_dir}/docs/design/SUPERVISOR.md` (§4.6 Heartbeat Mechanism)
  - [ ] Acceptance criteria (applies to all sub-phases)
    - [ ] UI can be launched in a “real logs” mode and all panels are backed by real data (no hard-coded mock state except in an explicit demo mode).
    - [ ] Time travel changes the inspected state deterministically (scrubbing produces consistent snapshots).
    - [ ] Compaction markers and snapshot viewing work for multi-compaction sessions.
    - [ ] Large log files remain usable (no multi-second UI freezes on refresh/poll).
    - [ ] All tests pass and no lint/typecheck warnings.
  - [ ] **7.1 Wire Replay Engine into the UI (Real State Inspector)**
    - [ ] Replace `stateData` mock plumbing with replay-derived state snapshots per timestamp.
      - [ ] Use `TimeTravelStore` / replay timeline as the canonical “state at time” for the inspector.
      - [ ] Ensure staged reminders (`stage/{hookName}`) and summary state participate in replay state.
    - [ ] Implement a generic JSON tree viewer for state (read-only) instead of `session-summary.json`-specific rendering.
    - [ ] Implement computed diff view between consecutive snapshots (Git-style), not a hard-coded field diff.
    - [ ] Add tests for: state reconstruction correctness, snapshot selection by scrub position, diff calculation correctness.
  - [ ] **7.2 Session State & Stage Directory Reading (Backed by Files)**
    - [ ] Add/finish API endpoints to read session state domains needed by the inspector:
      - [ ] `.sidekick/sessions/{sessionId}/state/session-summary.json`
      - [ ] `.sidekick/sessions/{sessionId}/state/session-state.json` (if present)
      - [ ] `.sidekick/sessions/{sessionId}/stage/{hookName}/*.json` and suppression markers
    - [ ] Validate and sanitize all path parameters (`sessionId`, `hookName`, filenames) to prevent traversal.
    - [ ] Define a small, stable API response schema in `@sidekick/types` for UI consumption.
    - [ ] Add unit tests for handlers (missing files, empty dirs, invalid IDs, dual-scope resolution).
  - [ ] **7.3 Unified Cockpit UX Parity (Spec Alignment)**
    - [ ] Add the time-travel “current time indicator” that visually cuts the stream at the selected timestamp.
    - [ ] Make stream items clickable to snap time (not only the timeline rail).
    - [ ] Ensure “Live” mode follows new events and reliably returns to “paused” when user scrubs.
    - [ ] Ensure search UX matches spec intent (filters + free-text) and operates on displayed event content.
  - [ ] **7.4 Performance & Reliability for Large Sessions**
    - [ ] Stop re-parsing full logs on every poll; add a cheap “mtime-only” check or incremental fetch behavior.
    - [ ] Use the existing streaming NDJSON parser for incremental ingestion.
    - [ ] Add guardrails for edge cases: 0–1 events (timeline math), missing timestamps, malformed NDJSON lines.
    - [ ] Add focused perf regression tests/benchmarks (lightweight; no external API calls).
  - [ ] **7.5 Production-Local Runtime (Beyond Vite Dev Middleware)**
    - [ ] Provide a Node runtime that serves the built SPA and hosts the same `/api/*` endpoints.
    - [ ] Add a CLI entrypoint (e.g., `sidekick ui`) to launch the server and open/print the URL.
    - [ ] Verify dual-scope path resolution in both `.sidekick/` and `~/.sidekick/` contexts.
    - [ ] **Verification gate**: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`

- [ ] **Phase 8: Feature Parity and Legacy Cleanup**
  - [ ] Objectives
    - [ ] Audit legacy implementations against TypeScript rewrite for feature parity
    - [ ] Port remaining functionality not obsolete or in conflict with new designs; document intentional omissions
    - [ ] Clean up or archive legacy code
  - [ ] Relevant documents/sections
    - [ ] `{project_root_dir}/docs/ARCHITECTURE.md` (§1 Guiding Principles)
    - [ ] `{project_root_dir}/docs/design/flow.md` (complete hook flows as feature reference)
  - [ ] **8.1 Legacy Audit**
    - [ ] Audit `benchmark-next/` for unported features (early TypeScript exploration, largely stale)
    - [ ] Audit `src/sidekick/` (bash runtime) for behaviors not yet in TypeScript packages
    - [ ] Audit `scripts/` for analysis tools that should migrate (e.g., `analyze-session-at-line.sh`, `simulate-session.py`)
    - [ ] Audit transcript processing logic
    - [ ] Document feature gaps and create tasks for each
  - [ ] **8.2 Migration Tasks** (populated by audit)
    - [ ] Placeholder: Tasks added based on audit findings
  - [ ] **8.3 Legacy Cleanup**
    - [ ] Archive `benchmark-next/` (mark as superseded in README)
    - [ ] Decide: retain bash runtime as fallback or deprecate entirely
    - [ ] Update `AGENTS.md` to reflect final state
  - [ ] Acceptance criteria
    - [ ] TypeScript rewrite has feature parity with legacy (documented exceptions allowed)
    - [ ] Legacy code is archived/deprecated with clear migration notes
    - [ ] Code complexity is kept low using stated architecture principles and guidelines
    - [ ] All new and modified files are documented

- [ ] **Phase 9: Installation & Distribution Hardening**
  - [ ] Objectives
    - [ ] Evaluate Claude Code Plugins as potential distribution mechanism
    - [ ] Finalize installer scripts for bash wrappers, assets, and dual-scope support
    - [ ] Implement migration utilities (legacy bash `.conf` → YAML domain files)
  - [ ] Relevant documents/sections
    - [ ] `{project_root_dir}/docs/ARCHITECTURE.md` (§4 Installation & Distribution)
    - [ ] `{project_root_dir}/docs/design/CLI.md` (§3 Hook Wrapper Layer, §6 Scope Resolution)
    - [ ] `{project_root_dir}/docs/design/CONFIG-SYSTEM.md` (§3 Configuration Domains, §4 Configuration Cascade) — **YAML format spec**
  - [ ] **9.1 Installer Implementation**
    - [ ] Hook wrapper generation: bash scripts that invoke `npx @sidekick/cli` or global install
    - [ ] Asset bundling: copy `assets/sidekick/` to installed location
    - [ ] Dual-scope detection: warn when both user and project hooks are installed
    - [ ] CLI commands: `sidekick install --project`, `sidekick install --user`, `sidekick uninstall`
  - [ ] **9.2 Config Migration**
    - [ ] Legacy `.conf` → YAML converter: parse bash-style key=value, emit domain YAML files
    - [ ] `sidekick.config` support: unified override file with dot-notation (per docs/design/CONFIG-SYSTEM.md §4.2)
    - [ ] Migration reporting: show what was converted, warn on unrecognized keys
  - [ ] **9.3 Distribution Options**
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

- [ ] **Phase 10: Documentation & Polish**
  - [ ] Objectives
    - [ ] Finalize user-facing documentation
    - [ ] Clean up development artifacts
    - [ ] Prepare for release
  - [ ] **10.1 Documentation**
    - [ ] Update README.md for TypeScript runtime (replace bash-focused content)
    - [ ] User guide: installation, configuration, troubleshooting
    - [ ] Developer guide: architecture overview, contributing
    - [ ] Ensure all LLDs are current with implementation
    - [ ] Ensure all source code documentation is up-to-date (not in conflict with requirements or implementation), clean and lean (not over-documenting), and remove all references to implementation phases (how we planned the work should be irrelevant to code documentation).
  - [ ] **10.2 Cleanup**
    - [ ] Remove or archive stale files (benchmark-next/, legacy scripts)
    - [ ] Verify all `// TODO` and `// FIXME` comments addressed
    - [ ] Final lint/typecheck/test pass
  - [ ] **10.3 Release Preparation**
    - [ ] Version bump and changelog
    - [ ] npm publish dry-run
    - [ ] Final dual-scope verification
  - [ ] Acceptance criteria
    - [ ] README accurately reflects TypeScript runtime
    - [ ] No stale/orphaned files in repository
    - [ ] All tests passing, zero lint warnings
    - [ ] Package ready for npm publish
