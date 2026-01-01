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

### Phase 5: Supervisor & Background Tasks - COMPLETE 2025-12-04

Built supervisor process with IPC socket, task engine, and CLI integration. Key outcomes:

**5.1 Core Supervisor Process**: Entry point, signal handlers, IPC socket (Unix domain), version handshake, token auth, heartbeat mechanism

**5.2 Task Engine & State Manager**: Single-writer atomic JSON updates, task queue with priority ordering, worker pool, orphan prevention via TaskRegistry

**5.3 TranscriptService Integration**: Initialize on SessionStart, stop on SessionEnd, HandlerRegistryImpl with invokeHook() and emitTranscriptEvent()

**5.4 Handler Event Dispatch & Staging**: Sequential hook handler execution, concurrent transcript handlers, staging directory management

**5.5 CLI Integration & Graceful Fallback**: `sidekick supervisor start/stop/status` commands, auto-start on first hook, connection pooling, graceful degradation

**5.6 UI Integration**: System Health dashboard (uptime, memory, queue depth), offline detection, session state file reading

### Phase 6: Feature Enablement & Integration - COMPLETE 2025-12-13

Implemented feature packages using unified handler model. Key outcomes:

**6.1 Reminders Feature**: ReminderUtils module, staging handlers (Supervisor), consumption handlers (CLI), suppression pattern

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

---

## Pending Phases

- [ ] **Phase 8: CLI→Supervisor Event Dispatch**\
  - [x] Objectives
    - [x] Wire CLI hook commands to dispatch events to Supervisor via IPC
    - [x] Enable handler execution for hook events (SessionStart, UserPromptSubmit, etc.)
    - [x] Complete the event flow: CLI → IpcService → Supervisor → HandlerRegistry → Handlers
  - [x] Relevant documents/sections
    - [x] `{project_root_dir}/docs/design/flow.md` (§5 Complete Hook Flows) — **CLI/Supervisor event dispatch patterns**
    - [x] `{project_root_dir}/docs/design/CLI.md` (§4 Supervisor Interaction)
    - [x] `{project_root_dir}/docs/design/SUPERVISOR.md` (§3 Communication Layer, §4.3 IPC Protocol)
  - [x] Background
    - Phase 5 implemented supervisor lifecycle (start/stop/status) and IPC infrastructure
    - Phase 6 implemented feature handlers that register with HandlerRegistry
    - **Gap identified**: CLI starts supervisor but never sends hook events via IPC
    - Result: Handlers are registered but never invoked; session data is never written
  - [x] **8.1 CLI Event Dispatch Integration** - COMPLETE 2025-12-14
    - [x] Import `IpcService` in CLI hook command path
    - [x] Build `HookEvent` from parsed CLI arguments and stdin JSON
    - [x] Call `ipc.send('hook.invoke', { hook, event })` for each hook command
    - [x] Handle supervisor response (reminders, blocking status, errors)
    - [x] Remove "Node runtime skeleton ready" placeholder message
  - [x] **8.2 Hook-Specific Event Construction** - COMPLETE 2025-12-14
    - [x] `SessionStart`: Extract `sessionId`, `transcriptPath`, `startupType` from stdin
    - [x] `UserPromptSubmit`: Extract `prompt`, `sessionId` from stdin
    - [x] `PreToolUse` / `PostToolUse`: Extract `toolName`, `toolInput`, `toolResult` from stdin
    - [x] `Stop`: Extract `stopReason`, `sessionId` from stdin
    - [x] `SessionEnd`: Extract `sessionId`, `endReason` from stdin
  - [x] **8.3 Response Handling & Output** - COMPLETE 2025-12-14
    - [x] Parse `HookResponse` from supervisor (reminders, additionalContext, blocking)
    - [x] Format CLI output per Claude Code hook contract (JSON to stdout)
    - [x] Handle `blocking: true` responses appropriately
    - [x] Log handler execution results via structured logging
  - [x] **8.4 Graceful Degradation** - COMPLETE 2025-12-14
    - [x] When supervisor unavailable: proceed with sync-only path (existing behavior)
    - [x] Log warning when falling back to sync path
    - [x] Ensure CLI never blocks indefinitely on supervisor communication
  - [x] Testing
    - [x] Unit tests for event construction from stdin JSON (17 tests in hook.test.ts)
    - [x] Integration tests for CLI → Supervisor → Handler flow
    - [x] Graceful degradation tests (supervisor unavailable scenarios)
    - [x] End-to-end tests with recorded transcript data
  - [ ] Acceptance criteria
    - [x] Hook commands dispatch events to supervisor via `hook.invoke` IPC
    - [x] Registered handlers execute and write session state files
    - [x] `.sidekick/sessions/{sessionId}/state/` contains handler output
    - [x] Graceful degradation when supervisor unavailable (warns, doesn't crash)
    - [x] All existing tests pass; no regressions (45 CLI tests, 218+ total)
    - [x] **Verification gate**: `pnpm build && pnpm lint && pnpm typecheck && pnpm test`
    - [ ] Live testing in dev-mode shows session state files being written
    - [ ] No errors/warnings in the logs
  - [x] **8.5 Refactoring** - Code review follow-up tasks - COMPLETE 2025-12-20
    - [x] **8.5.1 Fix or Remove normalizeHookName()** - COMPLETE 2025-12-20
      - [x] Removed `normalizeHookName()`, split into `validateHookName()` + `getHookName()`
      - [x] `validateHookName()`: validates PascalCase from stdin's `hookEventName`
      - [x] `getHookName()`: maps kebab-case CLI commands → PascalCase HookName
      - [x] Removed all snake_case mappings
      - [x] Files: `packages/sidekick-cli/src/commands/hook.ts`
    - [x] **8.5.2 Refactor buildHookEvent() into Smaller Methods** - COMPLETE 2025-12-20
      - [x] Extract `buildSessionStartEvent()`
      - [x] Extract `buildSessionEndEvent()`
      - [x] Extract `buildUserPromptSubmitEvent()`
      - [x] Extract `buildPreToolUseEvent()`
      - [x] Extract `buildPostToolUseEvent()`
      - [x] Extract `buildStopEvent()`
      - [x] Extract `buildPreCompactEvent()`
      - [x] Files: `packages/sidekick-cli/src/commands/hook.ts`
    - [x] **8.5.3 Refactor cli.ts runCli() into Smaller Methods** - COMPLETE 2025-12-20
      - [x] Extract `initializeRuntime()` - bootstrap, dual-install check
      - [x] Extract `initializeSession()` - session directory creation
      - [x] Extract `ensureSupervisor()` - auto-start logic
      - [x] Extract `routeCommand()` - command routing switch
      - [x] Files: `packages/sidekick-cli/src/cli.ts`
    - [x] **8.5.4 Wire Reminder Consumption Handlers in CLI** - COMPLETE 2025-12-20
      - [x] Created `context.ts` with `buildCLIContext()` factory and `registerCLIFeatures()`
      - [x] CLI invokes handlers via HandlerRegistry after IPC response
      - [x] `mergeHookResponses()` merges CLI and Supervisor responses (CLI takes precedence)
      - [x] Context wiring internalized in factory (fixes leaky abstraction)
      - [x] Added `@sidekick/feature-reminders` dependency to CLI
      - [x] Files: `packages/sidekick-cli/src/context.ts`, `packages/sidekick-cli/src/commands/hook.ts`
    - [x] **8.5.5 Simplify Hook Response Format** - COMPLETE 2025-12-20
      - [x] Removed `ClaudeCodeHookOutput` interface from hook.ts
      - [x] Removed `formatClaudeCodeOutput()` function from hook.ts
      - [x] CLI outputs internal `HookResponse`: `{ blocking?, reason?, additionalContext?, userMessage? }`
      - [x] Shell scripts translate to hook-specific Claude Code format using jq:
        - `userMessage` → `systemMessage` (common field, shown to user)
        - `additionalContext` → `hookSpecificOutput.additionalContext` (most hooks)
        - `additionalContext` → `hookSpecificOutput.permissionDecisionReason` (PreToolUse)
        - `additionalContext` → appended to `reason` (Stop, no hookSpecificOutput)
        - `blocking`/`reason` → hook-specific blocking mechanism
      - [x] Hook-specific blocking formats:
        - PreToolUse: `hookSpecificOutput.permissionDecision: "deny"`, `permissionDecisionReason`
        - PostToolUse: `decision: "block"`, `reason`
        - Stop: `decision: "block"`, `reason`
        - UserPromptSubmit: `decision: "block"`, `reason`
        - SessionStart/PreCompact: `continue: false`, `stopReason`
        - SessionEnd: passthrough (cannot block)
      - [x] Graceful fallback when jq unavailable (passthrough)
      - [x] Files: `packages/sidekick-cli/src/commands/hook.ts`, `scripts/dev-hooks/*`

- [ ] **Phase Insertion Placeholder** to go through the code to analyze modularity, correct responsibilities (SOLID), DRY, TODOs and FIXMEs, @deprecated usage
  - FIRST get test coverage to an acceptable state!
  - code documentation updates (file, method, key data structures)
  - Refactoring opportunity: several files contain implementation blocks for all hooks or all features together in the same file. this is a smell.  Ideally we keep all feature and hook logic separate from each other and register handlers centrally.
  - Refactoring opportunity: configuration defaults in both files and code - DRY!!
  - Redesign opportunity: supervisor and CLI sometimes need the same files (e.g. supervisor writes metrics files, CLI reads them, supervisor stages reminders, CLI reads and renames them).  I want to make sure that where these points of coupling exist, there should be domain-specific code, e.g. the feature owns both the supervisor and CLI domain-specific behaviors.  The actual supervisor core and CLI core should NOT be coupled on domain-specific nuances.

- [ ] **Phase 9: Feature Parity and Legacy Cleanup**
  - [ ] Objectives
    - [ ] Audit legacy implementations against TypeScript rewrite for feature parity
    - [ ] Port remaining functionality not obsolete or in conflict with new designs; document intentional omissions
    - [ ] Clean up or archive legacy code
  - [ ] Relevant documents/sections
    - [ ] `{project_root_dir}/docs/ARCHITECTURE.md` (§1 Guiding Principles)
    - [ ] `{project_root_dir}/docs/design/flow.md` (complete hook flows as feature reference)
  - [ ] **9.1 Legacy Audit**
    - [ ] Audit `benchmark-next/` for unported features (early TypeScript exploration, largely stale)
    - [ ] Audit `src/sidekick/` (bash runtime) for behaviors not yet in TypeScript packages
    - [ ] Audit `scripts/` for analysis tools that should migrate (e.g., `analyze-session-at-line.sh`, `simulate-session.py`)
    - [ ] Audit transcript processing logic
    - [ ] Document feature gaps and create tasks for each
  - [ ] **9.2 Migration Tasks** (populated by audit)
    - [ ] Placeholder: Tasks added based on audit findings
  - [ ] **9.3 Legacy Cleanup**
    - [ ] Archive `benchmark-next/` (mark as superseded in README)
    - [ ] Decide: retain bash runtime as fallback or deprecate entirely
    - [ ] Update `AGENTS.md` to reflect final state
  - [ ] Acceptance criteria
    - [ ] TypeScript rewrite has feature parity with legacy (documented exceptions allowed)
    - [ ] Legacy code is archived/deprecated with clear migration notes
    - [ ] Code complexity is kept low using stated architecture principles and guidelines
    - [ ] All new and modified files are documented

- [ ] **Phase 10: Installation & Distribution Hardening**
  - [ ] Objectives
    - [ ] Evaluate Claude Code Plugins as potential distribution mechanism
    - [ ] Finalize installer scripts for bash wrappers, assets, and dual-scope support
    - [ ] Implement migration utilities (legacy bash `.conf` → YAML domain files)
  - [ ] Relevant documents/sections
    - [ ] `{project_root_dir}/docs/ARCHITECTURE.md` (§4 Installation & Distribution)
    - [ ] `{project_root_dir}/docs/design/CLI.md` (§3 Hook Wrapper Layer, §6 Scope Resolution)
    - [ ] `{project_root_dir}/docs/design/CONFIG-SYSTEM.md` (§3 Configuration Domains, §4 Configuration Cascade) — **YAML format spec**
  - [ ] **10.1 Installer Implementation**
    - [ ] Hook wrapper generation: bash scripts that invoke `npx @sidekick/cli` or global install
    - [ ] Asset bundling: copy `assets/sidekick/` to installed location
    - [ ] Dual-scope detection: warn when both user and project hooks are installed
    - [ ] CLI commands: `sidekick install --project`, `sidekick install --user`, `sidekick uninstall`
  - [ ] **10.2 Config Migration**
    - [ ] Legacy `.conf` → YAML converter: parse bash-style key=value, emit domain YAML files
    - [ ] `sidekick.config` support: unified override file with dot-notation (per docs/design/CONFIG-SYSTEM.md §4.2)
    - [ ] Migration reporting: show what was converted, warn on unrecognized keys
  - [ ] **10.3 Distribution Options**
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

- [ ] **Phase 12: Documentation & Polish**
  - [ ] Objectives
    - [ ] Finalize user-facing documentation
    - [ ] Clean up development artifacts
    - [ ] Prepare for release
  - [ ] **11.1 Documentation**
    - [ ] Update README.md for TypeScript runtime (replace bash-focused content)
    - [ ] User guide: installation, configuration, troubleshooting
    - [ ] Developer guide: architecture overview, contributing
    - [ ] Ensure all LLDs are current with implementation
    - [ ] Ensure all source code documentation is up-to-date (not in conflict with requirements or implementation), clean and lean (not over-documenting), and remove all references to implementation phases (how we planned the work should be irrelevant to code documentation).
  - [ ] **11.2 Cleanup**
    - [ ] Remove or archive stale files (benchmark-next/, legacy scripts)
    - [ ] Verify all `// TODO` and `// FIXME` comments addressed
    - [ ] Final lint/typecheck/test pass
  - [ ] **11.3 Release Preparation**
    - [ ] Version bump and changelog
    - [ ] npm publish dry-run
    - [ ] Final dual-scope verification
  - [ ] Acceptance criteria
    - [ ] README accurately reflects TypeScript runtime
    - [ ] No stale/orphaned files in repository
    - [ ] All tests passing, zero lint warnings
    - [ ] Package ready for npm publish
