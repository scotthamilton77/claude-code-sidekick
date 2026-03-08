# Sidekick UI — Phase 2 Architecture Audit

> Consolidated from Phase 2 analysis (sidekick-n4lx.5, sidekick-n4lx.6, sidekick-n4lx.7).
> Companion to REQUIREMENTS.md (Phase 1 output).
> Status: **Draft** (date: 2026-03-08)

## 1. Type Inventory: @sidekick/types vs UI

### 1.1 Types Defined in @sidekick/types

**Hook Event Types** (packages/types/src/events.ts):
- SessionStartHookEvent, SessionEndHookEvent, UserPromptSubmitHookEvent, PreToolUseHookEvent, PostToolUseHookEvent, StopHookEvent, PreCompactHookEvent

**Transcript Event Types** (packages/types/src/events.ts):
- TranscriptEvent with TranscriptEventType discriminator: 'UserPrompt', 'AssistantMessage', 'ToolCall', 'ToolResult', 'Compact', 'BulkProcessingComplete'

**Logging Event Types** (packages/types/src/events.ts — 28+ types):

CLI Logging Events:
- HookReceivedEvent, ReminderConsumedEvent, HookCompletedEvent, StatuslineRenderedEvent, StatuslineErrorEvent

Daemon Logging Events:
- EventReceivedEvent, EventProcessedEvent, ReminderStagedEvent, DaemonStartingEvent, DaemonStartedEvent, IpcServerStartedEvent, ConfigWatcherStartedEvent, SessionEvictionStartedEvent, SummaryUpdatedEvent, SummarySkippedEvent, ResumeGeneratingEvent, ResumeUpdatedEvent, ResumeSkippedEvent, RemindersClearedEvent

Transcript Logging Events:
- TranscriptEventEmittedEvent, PreCompactCapturedEvent

**State Types** (packages/types/src/services/state.ts — 18 types):
- SessionSummaryState, SessionPersonaState, LastStagedPersona, SummaryCountdownState, SnarkyMessageState, ResumeMessageState, TranscriptMetricsState, LogMetricsState, PRBaselineState, VCUnverifiedState, VerificationToolsState, ReminderThrottleState, CompactionHistoryState, BaseTokenMetricsState, ProjectContextMetrics, SessionContextMetrics, LLMMetricsState, SessionStateSnapshot

**Service Types** (packages/types/src/services/):
- PersonaDefinition (persona.ts)
- StagedReminder, StagingMetrics (staging.ts)
- TranscriptMetrics, TokenUsageMetrics, CanonicalTranscriptEntry, Transcript, CompactionEntry (transcript.ts)
- DaemonStatus, DaemonMemoryMetrics, DaemonQueueMetrics, ActiveTaskInfo (daemon-status.ts)
- UserProfile (user-profile.ts)
- ReminderCoordinator, ReminderRef, CoordinationMetrics (reminder-coordinator.ts)

**Task Types** (packages/types/src/tasks.ts):
- SessionSummaryPayload, ResumeGenerationPayload, CleanupPayload, MetricsPersistPayload, TrackedTask, TaskRegistryState

### 1.2 Types Handled by UI

Current UI event types (packages/sidekick-ui/src/types.ts — 16 Sidekick event types):
1. 'reminder-staged' — ReminderDetail component
2. 'reminder-unstaged' — ReminderDetail component
3. 'reminder-consumed' — ReminderDetail component
4. 'decision' — DecisionDetail component
5. 'session-summary-start' — inline rendering
6. 'session-summary-finish' — inline rendering
7. 'session-title-changed' — DetailPanel
8. 'intent-changed' — DetailPanel
9. 'snarky-message-start' — inline rendering
10. 'snarky-message-finish' — DetailPanel
11. 'resume-message-start' — inline rendering
12. 'resume-message-finish' — DetailPanel
13. 'persona-selected' — DetailPanel
14. 'persona-changed' — DetailPanel
15. 'statusline-rendered' — DetailPanel
16. 'log-error' — ErrorDetail component

Transcript line types:
- 'user-message', 'assistant-message', 'tool-use', 'tool-result', 'compaction'
- Plus all 16 SidekickEventTypes above

### 1.3 Gap Analysis

**Logging events not rendered** (28+ types, HIGH severity):
The UI handles NONE of the logging events from events.ts. These are observability events written to .sidekick/*.log but not rendered.

Key missing: HookReceivedEvent, HookCompletedEvent, EventReceivedEvent, EventProcessedEvent, ReminderStagedEvent, DaemonStartingEvent, DaemonStartedEvent, SummaryUpdatedEvent, SummarySkippedEvent, ResumeGeneratingEvent, ResumeUpdatedEvent, StatuslineRenderedEvent, StatuslineErrorEvent, etc.

**Architecture question**: Are logging events meant for UI display or purely observability? The UI's SIDEKICK_EVENT_TO_FILTER mapping suggests UI events are a separate, higher-level abstraction from logging events.

**State types without UI** (18 types, MEDIUM severity):
LLMMetricsState, VerificationToolsState, ContextMetrics, PRBaselineState, VCUnverifiedState, ReminderThrottleState, etc. have no UI components.

**Type safety regression** (MEDIUM):
StateSnapshot in UI types uses Record<string, unknown> for all fields instead of strict types from @sidekick/types/services/state.ts.

**Missing event adapter** (HIGH):
No conversion exists from logging events to UI timeline events. The archive had one (event-adapter.ts) but it's not in the current codebase.

### 1.4 UI-Only Types (Drift)

TranscriptLine in UI types is a presentation-layer aggregate combining:
- Raw transcript entries (user-message, assistant-message, tool-use, tool-result)
- Compaction entries (not in @sidekick/types events)
- Sidekick events (16 types, reconstructed from logging layer)

No canonical definition exists for how logging events map to UI timeline events.

### 1.5 Mock Data Coverage

**Present**: User messages, assistant messages, tool use/results, session summary analysis, session title changes, reminders, decisions, persona changes, verification LED states.

**Missing**: Compaction events (partial), snarky messages, resume messages, statusline rendered, log errors, intent changed, state snapshots (persona, transcript metrics, LLM metrics, context metrics), daemon health indicators.

## 2. API Handler Audit

### 2.1 Current State: No Live API

The current UI is a client-side React app with mock data only. There are NO live API handlers. The archived server implementation (.archive/server/) shows previously planned HTTP APIs.

### 2.2 Archived API Endpoints

| Route | Data Source | Status |
|-------|------------|--------|
| GET /api/logs/:type | .sidekick/logs/{cli,sidekickd}.log | Not implemented |
| GET /api/daemon/status | .sidekick/state/daemon-status.json | Not implemented |
| GET /api/sessions | .sidekick/sessions/ directory listing | Not implemented |
| GET /api/sessions/:id/metrics | .sidekick/sessions/{id}/state/transcript-metrics.json | Not implemented |
| GET /api/sessions/:id/summary | .sidekick/sessions/{id}/state/session-summary.json | Not implemented |
| GET /api/sessions/:id/reminders/staged | .sidekick/sessions/{id}/stage/{hook}/*.json | Not implemented |
| GET /api/sessions/:id/compaction | .sidekick/sessions/{id}/state/compaction-history.json | Not implemented |
| GET /api/sessions/:id/pre-compact | Pre-compaction transcript snapshots | Not implemented |
| GET /api/config | Resolved Sidekick configuration | Not implemented |

### 2.3 Critical Architecture Mismatch

The daemon is NOT an HTTP server. It uses JSON-RPC 2.0 over Unix Domain Socket (.sidekick/sidekickd.sock) for CLI communication only.

Resolution options:
1. Add HTTP server to daemon
2. Create separate UI backend service that reads files
3. Rebuild UI to read state files directly (via Vite dev server proxy or Node.js backend)

### 2.4 Daemon Output Format

**Log files**: NDJSON via Pino logger (.sidekick/logs/sidekickd.log, .sidekick/logs/cli.log). Max 10MB per file, 5 rotated files.

**Log record schema**:
```json
{
  "level": 30, "time": 1678888888888, "pid": 12345,
  "name": "sidekickd", "msg": "Event processed",
  "type": "EventProcessed", "source": "daemon",
  "context": { "sessionId": "...", "correlationId": "...", "hook": "PostToolUse" },
  "payload": { "state": { "handlerId": "...", "success": true }, "metadata": { "durationMs": 45 } }
}
```

**State files** (JSON, written atomically):

| File | Schema | Updated |
|------|--------|---------|
| daemon-status.json | DaemonStatusSchema | Every 5s heartbeat |
| transcript-metrics.json | TranscriptMetricsStateSchema | On transcript changes |
| session-summary.json | SessionSummaryStateSchema | After LLM analysis |
| snarky-message.json | SnarkyMessageStateSchema | After generation |
| resume-message.json | ResumeMessageStateSchema | After pivot detection |
| log-metrics.json | LogMetricsStateSchema | On warn/error/fatal |
| compaction-history.json | Custom | On compaction events |

### 2.5 Event Naming Mismatch

| UI Expects | Daemon Logs | Issue |
|-----------|-------------|-------|
| 'session-summary-start' + 'session-summary-finish' | SummaryUpdated (single event) | UI expects start/finish pair; daemon logs one event |
| 'persona-selected', 'persona-changed' | No explicit persona events | Persona changes are state file updates, not logged events |
| 'statusline-rendered' | StatuslineRendered (CLI-side only) | Daemon doesn't emit this; it's CLI-only |
| 'reminder-staged' | ReminderStaged (different schema) | Logging event has different payload structure than UI event |

### 2.6 Data Format Alignment

Schemas are correctly defined and serialization is consistent (Pino + Zod). If an HTTP layer existed, no format corrections would be needed for state files. The mismatch is architectural (no HTTP layer), not schema-level.

### 2.7 Missing Event Logging

| Designed Event | Source Doc | Status |
|---------------|-----------|--------|
| TaskQueued, TaskStarted, TaskCompleted, TaskFailed | DAEMON.md S4.5 | Not implemented |
| ReminderCoordinator callbacks | reminder-coordinator.ts | Defined but not wired |

## 3. New Features Needing UI Representation

### 3.1 Requirements Coverage Assessment

| Requirement | Backend | UI | Readiness |
|------------|---------|-----|-----------|
| F-1: Compaction-Aware Time Travel | Full | Partial | 95% |
| F-2: Log-Based Replay Engine | Full | Partial | 85% |
| F-3: Session Timeline | Full | Full | 100% |
| F-4: Transcript Viewer | Full | Full | 100% |
| F-5: State Inspector | Full | Partial | 90% |
| F-6: Decision Log | Full | Full | 100% |
| F-7: System Health Dashboard | Full | None | 70% |
| F-8: Search/Filter Bar | Full | Full | 100% |
| F-9: Live Mode | Full | None | 60% |
| G-1: Persona System | Full | Partial | 75% |
| G-2: Task Engine | Full | None | 40% |
| G-3: Provider/Telemetry | Full | Partial | 50% |
| G-4: Config Cascade | Full | None | 20% (P4) |
| G-5: Session Summary | Full | Partial | 80% |
| G-6: Reminder System | Full | Full | 100% |
| G-7: Transcript Metrics | Full | Partial | 85% |
| G-8: Structured Logging | Full | Partial | 70% |
| G-9: Daemon Health | Full | None | 30% |
| G-10: Statusline | Full | N/A (CLI-only) | 100% |

### 3.2 New Features Not in Requirements

**Recommended additions**:

1. **F-10: LLM Call Timeline** — Individual LLM calls as timeline events with detail drill-in (model, tokens, cost, latency, retries). Instrumented provider exists in packages/shared-providers. HIGH priority — surfaces critical cost information.

2. **G-11: Completion Classifier Detail** — Show why verify-completion reminder fired/didn't fire. Classifier exists in packages/feature-reminders/src/completion-classifier.ts. HIGH priority — validates critical decision logic.

3. **Context Window Utilization** (enhancement to G-7) — Visual bar showing context usage. ContextMetricsService exists in packages/sidekick-daemon/src/context-metrics/. HIGH priority — critical for session awareness.

**Not recommended for requirements**:
- Config watcher events (technical detail, low user value)
- Orphaned VC wrapper cleanup events (internal maintenance)

### 3.3 Priority Recommendations

**Tier 1 (Critical Gaps)**:
1. LLM Call Timeline (F-10) — 95% ready, low complexity
2. Task Queue Detail Panel (G-2 enhancement) — 90% ready, low complexity
3. Completion Classifier Detail (G-11) — 85% ready, low complexity
4. System Health Dashboard (F-7) — 80% ready, medium complexity

**Tier 2 (Important Enhancements)**:
5. Context Window Bar (G-7 enhancement) — 90% ready, low complexity
6. Log Detail Viewer (G-8 enhancement) — 85% ready, medium complexity
7. Compaction Snapshot Viewer (F-1 enhancement) — 85% ready, medium complexity
8. Confidence Visualization (G-5 enhancement) — 95% ready, low complexity

**Tier 3 (Future)**:
9. Config Cascade Inspector (G-4) — P4
10. Persona Profile Browser (G-1 enhancement) — P3
11. Live Mode Auto-Follow (F-9) — post-tier-1

## 4. Key Architectural Decisions Needed

### 4.1 Logging Events in UI?

Should the 28+ logging event types from events.ts be rendered in the UI timeline?

**Option A**: Yes — implement event adapter (logging to UI timeline events). Full visibility but noisy.
**Option B**: No — UI events remain a separate, curated abstraction. Cleaner but less forensic power.
**Option C**: Hybrid — logging events available via log viewer panel (G-8), not on main timeline.

**Recommendation**: Option C — logging events in the log viewer panel, not the main timeline. The main timeline should show high-level sidekick events only.

### 4.2 HTTP Server Architecture

How should the UI access backend data?

**Option A**: Add HTTP endpoints to daemon (alongside IPC)
**Option B**: Separate UI backend service that reads files + talks to daemon
**Option C**: UI reads state files directly via Node.js backend (Vite proxy)

**Recommendation**: Option C — simplest, file-based reads are sufficient for a forensic tool. The archived handlers already show this pattern. No daemon changes needed.

### 4.3 Event Adapter Strategy

How to bridge logging events to UI timeline events?

**Recommendation**: Restore and update the archived event-adapter.ts pattern. Define a canonical mapping from logging event types to UI SidekickEventType. This adapter lives in the UI backend, not in @sidekick/types.

### 4.4 StateSnapshot Type Safety

**Recommendation**: Replace Record<string, unknown> fields in StateSnapshot with strict types from @sidekick/types/services/state.ts. Add compile-time validation.

## 5. Gap Summary

| Gap Type | Count | Severity |
|----------|-------|----------|
| Logging events not rendered | 28+ | HIGH |
| State types without UI | 18 | MEDIUM |
| Type safety regression (StateSnapshot) | 1 | MEDIUM |
| Missing event adapter | 1 | HIGH |
| No HTTP/API server | 1 | CRITICAL |
| Event naming mismatches | 4 | MEDIUM |
| Incomplete mock data | 8+ types missing | LOW |
| Missing task lifecycle logging | 4 events | MEDIUM |
| UI-only type aggregation (TranscriptLine) | 1 | MEDIUM |

## 6. Traceability

| Source | Issue | Status |
|--------|-------|--------|
| Types inventory | sidekick-n4lx.5 | Closed |
| API handler audit | sidekick-n4lx.6 | Closed |
| New features survey | sidekick-n4lx.7 | Closed |
| Requirements (Phase 1) | sidekick-n4lx.4 | Closed |
| Next: Document MONITORING-UI.md accuracy | sidekick-n4lx.8 | Open (unblocked) |
