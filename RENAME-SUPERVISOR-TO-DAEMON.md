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
- [ ] `SupervisorStartingEvent` → `DaemonStartingEvent` (types/events.ts:498)
- [ ] `SupervisorStartedEvent` → `DaemonStartedEvent` (types/events.ts:513)
- [ ] `type: 'SupervisorStarting'` → `type: 'DaemonStarting'` (types/events.ts:499)
- [ ] `type: 'SupervisorStarted'` → `type: 'DaemonStarted'` (types/events.ts:514)
- [x] `SupervisorLoggingEvent` → `DaemonLoggingEvent` (done)
- [x] `isSupervisorLoggingEvent()` → `isDaemonLoggingEvent()` (done)
- [ ] `supervisorStarting()` factory → `daemonStarting()` (core/structured-logging.ts:795)
- [ ] `supervisorStarted()` factory → `daemonStarted()` (core/structured-logging.ts:813)
- [ ] Event union type still references `SupervisorStartingEvent | SupervisorStartedEvent` (types/events.ts:791-792)
- [ ] Comment "Supervisor Lifecycle Events" → "Daemon Lifecycle Events" (types/events.ts:492)

**Verification:** `grep -r "Supervisor.*Event" packages/types/` returns nothing

### Phase 6: Runtime File Paths
- [x] `supervisor.pid` → `sidekickd.pid`
- [x] `supervisor.sock` → `sidekickd.sock`
- [x] `supervisor.token` → `sidekickd.token`
- [x] `supervisor.lock` → `sidekickd.lock`
- [x] `supervisor-status.json` → `daemon-status.json`
- [x] `supervisor.log` → `sidekickd.log`
- [x] `~/.sidekick/supervisors/` → `~/.sidekick/daemons/` (function renamed, path updated)
- [ ] Stale comment in `daemon.ts:1136` still says `supervisors/` - needs fix

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
- [ ] `src/lib/event-adapter.ts:50` - `source === 'supervisor'` → `source === 'daemon'`
- [ ] `src/lib/event-adapter.ts:499` - default source `'supervisor'` → `'daemon'`
- [ ] `src/data/mockData.ts` - all `source: 'supervisor'` → `source: 'daemon'`
- [ ] `src/lib/__tests__/filter-parser.test.ts` - test data and assertions
- [ ] `src/lib/__tests__/log-parser.test.ts` - test data, variable names, assertions
- [ ] `src/lib/__tests__/performance.test.ts` - test data
- [ ] `src/lib/__tests__/event-adapter.test.ts` - test data and descriptions
- [ ] `src/lib/__tests__/event-adapter-edge-cases.test.ts` - test data
- [ ] `src/lib/__tests__/replay-engine.test.ts` - test data, `supervisorHealth` property
- [ ] `src/types/index.ts` - check for supervisor references
- [ ] `src/hooks/useLogService.ts` - check for supervisor references
- [ ] `src/components/StateInspector.tsx` - check for supervisor references
- [ ] `src/components/Transcript.tsx` - check for supervisor references
- [ ] `server/handlers/logs.ts` - check for supervisor.log references

**Verification:** `grep -ri "supervisor" packages/sidekick-ui/src/` returns nothing

### Phase 11: Scripts
- [ ] `scripts/dev-mode.sh` - update supervisor references
- [ ] `scripts/copy-config.sh` - update supervisor references

**Verification:** `grep -r "supervisor" scripts/` returns nothing

### Phase 12: Test Files
- [ ] `daemon-heartbeat.test.ts:24` - `role: 'supervisor'` → `role: 'daemon'`
- [ ] `daemon-heartbeat.test.ts:181,218` - `supervisor-status.json` path reference
- [ ] `task-engine.test.ts:11` - `role: 'supervisor'` → `role: 'daemon'`
- [ ] `phase-4.5-integration.test.ts:587,623` - `role: 'supervisor'` assertions
- [ ] `daemon-client.test.ts:301,303,618,631` - error message "Supervisor failed" → "Daemon failed"
- [ ] `structured-logging.test.ts:822` - `name: 'sidekick:supervisor'` → `name: 'sidekick:daemon'`
- [ ] `ipc-service.test.ts` - test descriptions/comments mentioning supervisor
- [ ] `asset-resolver.test.ts:204,220` - config with `supervisor:` key
- [x] CLI tests pass
- [x] Core tests pass (excluding IPC sandbox issues)
- [x] Daemon tests pass

**Verification:** All tests pass, `grep -ri "supervisor" packages/**/*.test.ts` returns nothing (except comments about architecture)

### Phase 13: Documentation
- [ ] `docs/ARCHITECTURE.md` - full update
- [ ] `docs/design/SUPERVISOR.md` - rename to `DAEMON.md` and update content
- [ ] `docs/design/CLI.md` - update references
- [ ] `docs/design/STRUCTURED-LOGGING.md` - update source field docs
- [ ] `docs/design/CORE-RUNTIME.md` - update context type docs
- [ ] `docs/design/FEATURE-STATUSLINE.md` - update references
- [ ] `docs/design/FEATURE-SESSION-SUMMARY.md` - update references
- [ ] `docs/design/FEATURE-RESUME.md` - update references
- [ ] `docs/design/TRANSCRIPT-PROCESSING.md` - update references
- [ ] `docs/design/TRANSCRIPT_METRICS.md` - update references
- [ ] `docs/design/LLM-PROVIDERS.md` - update references
- [ ] `docs/design/LLM_PROFILES.md` - update references
- [ ] `docs/design/CONFIG-SYSTEM.md` - update references
- [ ] `docs/design/SCHEMA-CONTRACTS.md` - update references
- [ ] `docs/design/TEST-FIXTURES.md` - update references
- [ ] `docs/design/flow.md` - update references
- [ ] `docs/testing/TEST-REMINDERS.md` - update references
- [ ] `packages/AGENTS.md` - update references
- [ ] `packages/sidekick-ui/docs/MONITORING-UI.md` - update references
- [ ] `assets/sidekick/defaults/README.md` - update references
- [ ] `README.md` - update references
- [ ] `AGENTS.md` (root) - update references
- [ ] `docs/ROADMAP.md` - update references
- [ ] `docs/ROADMAP-COMPLETED.md` - **LEAVE AS-IS** (preserve accurate history)

**Verification:** `grep -ri "supervisor" docs/ README.md AGENTS.md` only matches ROADMAP-COMPLETED.md

### Phase 14: State File Names in Code
- [ ] `daemon.ts:1300` - `'supervisor-status'` → `'daemon-status'`
- [ ] `daemon.ts:1318` - `supervisor-log-metrics.json` → `daemon-log-metrics.json`
- [ ] `daemon.ts:1346` - `supervisor-log-metrics.json` → `daemon-log-metrics.json`
- [ ] `daemon.ts:1375` - `'supervisor-global-log-metrics'` → `'daemon-global-log-metrics'`
- [ ] `types/state.ts:176-177` - doc comments reference old file names

**Verification:** `grep -r "supervisor-.*\.json\|supervisor-log\|supervisor-global" packages/` returns nothing

### Phase 15: Source Code Comments
Many source files still have "supervisor" in comments. These should be updated:
- [ ] `daemon.ts` - ~40 comment references to "Supervisor"
- [ ] `task-engine.ts` - references to `design/SUPERVISOR.md`
- [ ] `task-registry.ts` - references to supervisor
- [ ] `task-handlers.ts` - references to supervisor
- [ ] `state-manager.ts` - references to `design/SUPERVISOR.md`
- [ ] `config-watcher.ts` - references to `design/SUPERVISOR.md`
- [ ] `ipc-service.ts` - references to supervisor
- [ ] `ipc/client.ts` - references to supervisor
- [ ] `ipc/server.ts` - reference to Supervisor
- [ ] `staging-service.ts` - reference to Supervisor
- [ ] `file-utils.ts` - reference to Supervisor-side
- [ ] `hookable-logger.ts` - reference to Supervisor
- [ ] `service-factory.ts` - reference to supervisor
- [ ] `transcript-service.ts` - reference to Supervisor
- [ ] `types/tasks.ts` - references to SUPERVISOR.md and supervisor
- [ ] `types/services/*.ts` - references to Supervisor

**Verification:** `grep -ri "supervisor" packages/*/src/*.ts packages/types/src/*.ts` returns nothing (source files)

### Phase 16: Variable Names in Source
- [ ] `daemon.ts:1056` - variable `supervisorContext` → `daemonContext`
- [ ] `daemon.ts:1087` - `supervisorContext as unknown` reference
- [ ] `task-engine.ts:171,175` - variable `supervisorContext` → `daemonContext`
- [ ] `structured-logging.ts` - variable `supervisorLogPath` in tests

**Verification:** `grep -r "supervisorContext\|supervisorLog" packages/` returns nothing

### Phase 17: Vitest Config
- [ ] `vitest.config.ts` - update any supervisor references
- [ ] `vitest.workspace.ts` - update any supervisor references
- [ ] `packages/sidekick-daemon/vitest.config.ts` - update references

**Verification:** `grep -r "supervisor" vitest*.ts packages/*/vitest*.ts` returns nothing

### Phase 18: Logger Names
- [ ] `name: 'sidekick:supervisor'` → `name: 'sidekick:daemon'` throughout codebase

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
