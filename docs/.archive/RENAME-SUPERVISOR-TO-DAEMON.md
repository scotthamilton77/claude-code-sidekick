# Rename: supervisor → daemon

## Objective

Rename "supervisor" to "daemon" throughout the codebase for consistency with Unix conventions. The background process that handles async work (LLM calls, transcript analysis) should be called a "daemon" with binary name `sidekickd`.

**Naming Convention:**

| Component | Package | Binary | Log File | Source Discriminator |
|-----------|---------|--------|----------|---------------------|
| CLI | `@sidekick/cli` | `sidekick` | `cli.log` | `'cli'` |
| Daemon | `@sidekick/daemon` | `sidekickd` | `sidekickd.log` | `'daemon'` |

**No backward compatibility needed** - single-user project, clean rename.

---

## Checklist

### Phase 1: Package Structure
- [x] Rename `packages/sidekick-supervisor/` → `packages/sidekick-daemon/`
- [x] Update `package.json` name: `@sidekick/supervisor` → `@sidekick/daemon`
- [x] Update `package.json` bin: `sidekick-supervisor` → `sidekickd`
- [x] Update all workspace dependency references to `@sidekick/daemon`

**Verification:** `grep -r "@sidekick/supervisor" packages/` returns nothing

### Phase 2: Source File Renames
- [x] `packages/sidekick-core/src/supervisor-client.ts` → `daemon-client.ts`
- [x] `packages/types/src/services/supervisor-client.ts` → `daemon-client.ts`
- [x] `packages/types/src/services/supervisor-status.ts` → `daemon-status.ts`
- [x] `packages/sidekick-cli/src/commands/supervisor.ts` → `daemon.ts`
- [x] `packages/sidekick-daemon/src/supervisor.ts` → `daemon.ts`
- [x] `packages/sidekick-ui/server/handlers/supervisor-status.ts` → `daemon-status.ts`
- [x] `packages/sidekick-ui/src/hooks/useSupervisorStatus.ts` → `useDaemonStatus.ts`

**Verification:** `find packages -name "*supervisor*"` returns nothing

### Phase 3: Class/Interface Renames
- [x] `Supervisor` class → `Daemon`
- [x] `SupervisorClient` → `DaemonClient`
- [x] `SupervisorClientOptions` → `DaemonClientOptions`
- [x] `SupervisorStatus` → `DaemonStatus`
- [x] `SupervisorStatusWithHealth` → `DaemonStatusWithHealth`
- [x] `SupervisorMemoryMetrics` → `DaemonMemoryMetrics`
- [x] `SupervisorQueueMetrics` → `DaemonQueueMetrics`
- [x] `SupervisorContext` → `DaemonContext`
- [x] `isSupervisorContext()` → `isDaemonContext()`

**Verification:** `grep -r "class Supervisor\b" packages/` returns nothing

### Phase 4: Type Discriminators
- [x] `LogSource = 'cli' | 'supervisor' | 'transcript'` → `'cli' | 'daemon' | 'transcript'`
- [x] `role: 'supervisor'` → `role: 'daemon'`
- [x] `source: 'supervisor'` → `source: 'daemon'` in all event creation

**Verification:** `grep -r "'supervisor'" packages/types/` returns nothing (except comments)

### Phase 5: Event Types
- [x] `SupervisorStartingEvent` → `DaemonStartingEvent` (types/events.ts:498)
- [x] `SupervisorStartedEvent` → `DaemonStartedEvent` (types/events.ts:513)
- [x] `type: 'SupervisorStarting'` → `type: 'DaemonStarting'` (types/events.ts:499)
- [x] `type: 'SupervisorStarted'` → `type: 'DaemonStarted'` (types/events.ts:514)
- [x] `SupervisorLoggingEvent` → `DaemonLoggingEvent` (done)
- [x] `isSupervisorLoggingEvent()` → `isDaemonLoggingEvent()` (done)
- [x] `supervisorStarting()` factory → `daemonStarting()` (core/structured-logging.ts:795)
- [x] `supervisorStarted()` factory → `daemonStarted()` (core/structured-logging.ts:813)
- [x] Event union type still references `SupervisorStartingEvent | SupervisorStartedEvent` (types/events.ts:791-792)
- [x] Comment "Supervisor Lifecycle Events" → "Daemon Lifecycle Events" (types/events.ts:492)

**Verification:** `grep -r "Supervisor.*Event" packages/types/` returns nothing

### Phase 6: Runtime File Paths
- [x] `supervisor.pid` → `sidekickd.pid`
- [x] `supervisor.sock` → `sidekickd.sock`
- [x] `supervisor.token` → `sidekickd.token`
- [x] `supervisor.lock` → `sidekickd.lock`
- [x] `supervisor-status.json` → `daemon-status.json`
- [x] `supervisor.log` → `sidekickd.log`
- [x] `~/.sidekick/supervisors/` → `~/.sidekick/daemons/` (function renamed, path updated)
- [x] Stale comment in `daemon.ts:1136` still says `supervisors/` - needs fix

**Verification:** `grep -r "supervisor\.\(pid\|sock\|token\|lock\|log\)" packages/` returns nothing

### Phase 7: Configuration
- [x] Config schema: `supervisor:` → `daemon:`
- [x] Default config YAML: `supervisor:` → `daemon:`
- [x] Config access: `.supervisor.` → `.daemon.`

**Verification:** `grep -r "\.supervisor\." packages/` returns nothing (code access)

### Phase 8: CLI Commands
- [x] `sidekick supervisor` subcommand → `sidekick daemon`
- [x] Handler function: `handleSupervisorCommand` → `handleDaemonCommand`
- [x] Command types: `SupervisorCommandOptions` → `DaemonCommandOptions`
- [x] Command types: `SupervisorCommandResult` → `DaemonCommandResult`

**Verification:** `sidekick daemon status` works

### Phase 9: Function Renames
- [x] `killAllSupervisors()` → `killAllDaemons()`
- [x] `fetchSupervisorStatus()` → `fetchDaemonStatus()` (UI package - done)
- [x] `useSupervisorStatus()` → `useDaemonStatus()` (UI package - file renamed)

**Verification:** `grep -r "Supervisor\(" packages/` returns nothing (function calls)

### Phase 10: UI Package
- [x] `src/lib/event-adapter.ts:50` - `source === 'supervisor'` → `source === 'daemon'`
- [x] `src/lib/event-adapter.ts:499` - default source `'supervisor'` → `'daemon'`
- [x] `src/lib/log-parser.ts` - LogSource type, source parsing, variable names
- [x] `src/lib/filter-parser.ts` - FilterToken type, VALID_SOURCES
- [x] `src/lib/replay-engine.ts` - `supervisorHealth` → `daemonHealth`
- [x] `src/data/mockData.ts` - all `source: 'supervisor'` → `source: 'daemon'`
- [x] `src/types/index.ts` - UIEvent.source type updated
- [x] `src/hooks/useLogService.ts` - variable names and types updated
- [x] `src/components/StateInspector.tsx` - `supervisorHealth` → `daemonHealth`
- [x] `src/components/Transcript.tsx` - SourceBadge type and display label
- [x] `server/handlers/logs.ts` - VALID_TYPES updated to 'sidekickd'
- [x] `src/lib/__tests__/filter-parser.test.ts` - test data and assertions
- [x] `src/lib/__tests__/log-parser.test.ts` - test data, variable names, assertions
- [x] `src/lib/__tests__/performance.test.ts` - test data
- [x] `src/lib/__tests__/event-adapter.test.ts` - test data and descriptions
- [x] `src/lib/__tests__/event-adapter-edge-cases.test.ts` - test data
- [x] `src/lib/__tests__/replay-engine.test.ts` - test data, `daemonHealth` property
- [x] `src/components/__tests__/state-inspector.test.ts` - test data updated
- [x] `server/__tests__/scope-resolution.test.ts` - file references updated

**Verification:** `grep -ri "supervisor" packages/sidekick-ui/src/` returns nothing

### Phase 11: Scripts
- [x] `scripts/dev-mode.sh` - update supervisor references
- [x] `scripts/copy-config.sh` - update supervisor references

**Verification:** `grep -r "supervisor" scripts/` returns nothing

### Phase 12: Test Files
- [x] `daemon-heartbeat.test.ts:24` - `role: 'supervisor'` → `role: 'daemon'`
- [x] `daemon-heartbeat.test.ts:181,218` - `supervisor-status.json` path reference
- [x] `task-engine.test.ts:11` - `role: 'supervisor'` → `role: 'daemon'`
- [x] `transcript-handler-integration.test.ts:587,623` - `role: 'supervisor'` assertions (not found - may have been done earlier)
- [x] `daemon-client.test.ts:301,303,618,631` - error message (not found - may have been done earlier)
- [x] `structured-logging.test.ts:822` - `name: 'sidekick:supervisor'` → `name: 'sidekick:daemon'`
- [x] `ipc-service.test.ts` - test descriptions/comments mentioning supervisor
- [x] `asset-resolver.test.ts:204,220` - config with `supervisor:` key
- [x] `eviction-timer.test.ts` - comments and descriptions (bonus)
- [x] CLI tests pass
- [x] Core tests pass (excluding IPC sandbox issues)
- [x] Daemon tests pass

**Verification:** All tests pass, `grep -ri "supervisor" packages/**/*.test.ts` returns nothing (except comments about architecture)

### Phase 13: Documentation
- [x] `docs/ARCHITECTURE.md` - full update
- [x] `docs/design/SUPERVISOR.md` - renamed to `DAEMON.md` and updated
- [x] `docs/design/CLI.md` - updated
- [x] `docs/design/STRUCTURED-LOGGING.md` - updated
- [x] `docs/design/CORE-RUNTIME.md` - updated
- [x] `docs/design/FEATURE-STATUSLINE.md` - updated
- [x] `docs/design/FEATURE-SESSION-SUMMARY.md` - updated
- [x] `docs/design/FEATURE-RESUME.md` - updated
- [x] `docs/design/TRANSCRIPT-PROCESSING.md` - updated
- [x] `docs/design/TRANSCRIPT_METRICS.md` - updated
- [x] `docs/design/LLM-PROVIDERS.md` - updated
- [x] `docs/design/LLM_PROFILES.md` - updated
- [x] `docs/design/CONFIG-SYSTEM.md` - updated
- [x] `docs/design/SCHEMA-CONTRACTS.md` - updated
- [x] `docs/design/TEST-FIXTURES.md` - updated
- [x] `docs/design/flow.md` - updated
- [x] `docs/testing/TEST-REMINDERS.md` - updated
- [x] `packages/AGENTS.md` - updated
- [x] `packages/sidekick-ui/docs/MONITORING-UI.md` - updated (Phase 14)
- [x] `assets/sidekick/defaults/README.md` - updated
- [x] `README.md` - updated
- [x] `AGENTS.md` (root) - updated
- [x] `docs/ROADMAP.md` - updated
- [x] `docs/ROADMAP-COMPLETED.md` - **LEFT AS-IS** (preserved history)
- [x] `docs/.archive/*.md` - updated (bonus)

**Verification:** `grep -ri "supervisor" docs/ README.md AGENTS.md` only matches ROADMAP-COMPLETED.md

### Phase 14: State File Names in Code
- [x] `daemon.ts:1300` - `'supervisor-status'` → `'daemon-status'` (done in Phase 12)
- [x] `daemon.ts:1318` - `supervisor-log-metrics.json` → `daemon-log-metrics.json`
- [x] `daemon.ts:1346` - `supervisor-log-metrics.json` → `daemon-log-metrics.json`
- [x] `daemon.ts:1375` - `'supervisor-global-log-metrics'` → `'daemon-global-log-metrics'`
- [x] `types/state.ts:176-177` - doc comments reference old file names
- [x] `feature-statusline/src/state-reader.ts` - variable names (bonus find)

**Verification:** `grep -r "supervisor-.*\.json\|supervisor-log\|supervisor-global" packages/` returns nothing

### Phase 15: Source Code Comments
Many source files still have "supervisor" in comments. These should be updated:
- [x] `daemon.ts` - 27 comment updates
- [x] `task-engine.ts` - 6 updates, `design/SUPERVISOR.md` → `design/DAEMON.md`
- [x] `task-registry.ts` - 5 updates
- [x] `task-handlers.ts` - 3 updates
- [x] `state-manager.ts` - 2 updates
- [x] `config-watcher.ts` - 1 update
- [x] `ipc-service.ts` - 7 updates
- [x] `ipc/client.ts` - 2 updates
- [x] `ipc/server.ts` - 1 update
- [x] `staging-service.ts` - 1 update
- [x] `file-utils.ts` - 1 update
- [x] `hookable-logger.ts` - 1 update
- [x] `service-factory.ts` - 1 update
- [x] `transcript-service.ts` - 1 update
- [x] `types/tasks.ts` - 4 updates
- [x] `types/context.ts`, `types/events.ts` - 4 updates
- [x] `feature-*/src/*.ts` - 9 updates across 5 files
- [x] `cli.ts` - 4 updates + `ensureSupervisor` → `ensureDaemon`

**Verification:** `grep -ri "supervisor" packages/*/src/*.ts packages/types/src/*.ts` returns nothing (source files)

### Phase 16: Variable Names in Source
- [x] `daemon.ts:1056` - variable `supervisorContext` → `daemonContext` (done in Phase 15)
- [x] `daemon.ts:1087` - `supervisorContext as unknown` reference (done in Phase 15)
- [x] `task-engine.ts:171,175` - variable `supervisorContext` → `daemonContext` (done in Phase 15)
- [x] `structured-logging.ts` - variable `daemonLogPath` (done in Phase 12)
- [x] `hook.ts` - `supervisorResponse` → `daemonResponse` + comments

**Verification:** `grep -r "supervisorContext\|supervisorLog" packages/` returns nothing

### Phase 17: Vitest Config
- [x] `vitest.config.ts` - updated paths to `sidekick-daemon`
- [x] `vitest.workspace.ts` - updated workspace entry
- [x] `packages/sidekick-daemon/vitest.config.ts` - updated exclusion path

**Verification:** `grep -r "supervisor" vitest*.ts packages/*/vitest*.ts` returns nothing

### Phase 18: Logger Names
- [x] `name: 'sidekick:supervisor'` → `name: 'sidekick:daemon'` (already done in earlier phases)

**Verification:** `grep -r "sidekick:supervisor" packages/` returns nothing

---

## Final Verification

```bash
# Should return ONLY:
# - docs/ROADMAP-COMPLETED.md (historical record)
# - RENAME-SUPERVISOR-TO-DAEMON.md (this plan file)
# - docs/.archive/* (archived docs, low priority)
grep -ri "supervisor" . --include="*.ts" --include="*.tsx" --include="*.js" \
  --include="*.json" --include="*.yaml" --include="*.yml" --include="*.md" \
  --include="*.sh" | grep -v node_modules | grep -v dist \
  | grep -v ROADMAP-COMPLETED | grep -v RENAME-SUPERVISOR-TO-DAEMON | grep -v "docs/.archive"
```

```bash
# Build and tests pass
pnpm build && pnpm typecheck
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
pnpm --filter @sidekick/cli test
pnpm --filter @sidekick/daemon test
```

```bash
# Manual verification
sidekick daemon start   # Starts daemon
ls .sidekick/sidekickd.pid  # PID file exists
ls .sidekick/logs/sidekickd.log  # Log file created
sidekick daemon status  # Returns status JSON
sidekick daemon stop    # Clean shutdown
```
