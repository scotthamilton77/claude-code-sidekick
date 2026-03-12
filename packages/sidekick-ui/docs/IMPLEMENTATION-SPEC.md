# Sidekick UI — Implementation Spec

> Produced from REQUIREMENTS.md + PHASE2-AUDIT.md.
> Each section corresponds to a child task of epic sidekick-bf3bcd19.

## 1. [TBD — Overview/Scope]
<!-- Placeholder: produced by another task -->

## 2. Unified Event Contract

> **Design decision:** No adapter layer. One canonical event vocabulary in `@sidekick/types`, consumed by both emitters (CLI, daemon) and the UI. See [`docs/plans/2026-03-08-unified-event-contract-design.md`](/docs/plans/2026-03-08-unified-event-contract-design.md) for rationale.

### 2.1 Design Decision: No Adapter Layer

PHASE2-AUDIT §4 (specifically the event adapter strategy recommendation) recommended restoring an archived `event-adapter.ts` pattern to translate between 28+ logging event types and 16 UI event types. This spec **rejects that approach** in favor of a unified event vocabulary.

**Why:**
- An adapter layer adds a translation surface that must be maintained as either side evolves
- The mismatches between logging events and UI events represent real gaps in daemon observability, not a presentation problem
- The daemon already knows about these state transitions — it's just not announcing them

**What changes:**
- A new canonical `UIEventType` union is defined in `@sidekick/types` (the shared types package)
- The CLI and daemon emit canonical events to their respective log files using this shared vocabulary
- The UI reads log files and consumes events directly — no translation step
- The current UI-local `SidekickEventType` (packages/sidekick-ui/src/types.ts) is deprecated and replaced by the canonical type

**What does NOT change:**
- `HookEvent` types (input events from Claude Code) — unchanged
- `TranscriptEvent` types (from file watching) — unchanged
- `LoggingEventBase` structure — internal logging events continue for detailed observability
- Log file locations — `cli.log` and `sidekickd.log` stay where they are
- Pino NDJSON record format — canonical events are additional structured fields within log records

### 2.2 Naming Convention

Canonical event names use `category:action` format. This replaces the current kebab-case UI types (`reminder-staged`) and PascalCase logging types (`ReminderStaged`).

**Categories:** `reminder`, `session-summary`, `session-title`, `intent`, `snarky-message`, `resume-message`, `persona`, `statusline`, `decision`, `hook`, `event`, `daemon`, `ipc`, `config`, `session`, `transcript`, `error`

**Examples:** `reminder:staged`, `session-summary:start`, `persona:selected`, `hook:received`

### 2.3 Event Visibility

Every canonical event carries a `visibility` field defined in the type contract:

```typescript
/** Where this event appears in the UI. */
type EventVisibility = 'timeline' | 'log' | 'both'
```

| Value | Meaning | Examples |
|-------|---------|---------|
| `timeline` | Main event timeline — user-visible state changes | `reminder:staged`, `session-summary:finish`, `persona:selected` |
| `log` | Log viewer panel only (REQUIREMENTS.md G-8) — internal machinery | `daemon:started`, `config:watcher-started`, `session-summary:skipped` |
| `both` | Both timeline and log viewer | `hook:received`, `hook:completed`, `error:occurred` |

The visibility is part of the type definition in `@sidekick/types`. The UI reads this field to decide where to render — no conditional filter logic needed.

### 2.4 Canonical Event Table

Every event type in the unified vocabulary, organized by category. The **Emitter** column indicates which process writes the event to its log file. The **Status** column indicates whether this is an existing event being renamed or a new event the emitter must start producing.

> **Payload structure:** Canonical event payloads are **flat** — all fields live directly under `payload`, not nested in `state`/`metadata` sub-objects. This is a deliberate simplification from the current `LoggingEventBase` structure, which nests fields under `payload.state` and `payload.metadata`. The flattening happens at the canonical event boundary; existing `LoggingEvent` types retain their nested structure until deprecated.
>
> **Optional fields:** Fields suffixed with `?` in the payload column are optional. All other fields are required.

#### Timeline Events (user-visible state changes)

| # | Canonical Name | Visibility | Emitter | Status | Current Source | Payload (key fields) |
|---|---------------|------------|---------|--------|---------------|---------------------|
| 1 | `reminder:staged` | `timeline` | daemon | **rename** | `ReminderStaged` | `reminderName`, `hookName`, `blocking`, `priority`, `persistent` |
| 2 | `reminder:unstaged` | `timeline` | daemon | **new** | _(no event — `ctx.staging.deleteReminder()` is silent)_ | `reminderName`, `hookName`, `reason` |
| 3 | `reminder:consumed` | `timeline` | cli | **rename** | `ReminderConsumed` | `reminderName`, `reminderReturned`, `blocking?`, `priority?`, `persistent?` |
| 4 | `reminder:cleared` | `timeline` | daemon | **rename** | `RemindersCleared` | `clearedCount`, `hookNames?`, `reason` |
| 5 | `decision:recorded` | `timeline` | daemon | **new** | _(logger.info calls with `decision` field, not structured events)_ | `decision`, `reason`, `detail` |
| 6 | `session-summary:start` | `timeline` | daemon | **new** | _(implicit — LLM call begins)_ | `reason`, `countdown` |
| 7 | `session-summary:finish` | `timeline` | daemon | **rename+split** | `SummaryUpdated` | `session_title`, `session_title_confidence`, `latest_intent`, `latest_intent_confidence`, `processing_time_ms`, `pivot_detected` |
| 8 | `session-title:changed` | `timeline` | daemon | **new (extracted)** | _(buried in `SummaryUpdated.metadata.old_title`)_ | `previousValue`, `newValue`, `confidence` |
| 9 | `intent:changed` | `timeline` | daemon | **new (extracted)** | _(buried in `SummaryUpdated.metadata.old_intent`)_ | `previousValue`, `newValue`, `confidence` |
| 10 | `snarky-message:start` | `timeline` | daemon | **new** | _(implicit — task begins)_ | `sessionId` |
| 11 | `snarky-message:finish` | `timeline` | daemon | **new** | _(state file written, no event)_ | `generatedMessage` |
| 12 | `resume-message:start` | `timeline` | daemon | **rename** | `ResumeGenerating` | `title_confidence`, `intent_confidence` |
| 13 | `resume-message:finish` | `timeline` | daemon | **rename** | `ResumeUpdated` | `snarky_comment`, `timestamp` |
| 14 | `persona:selected` | `timeline` | daemon | **new** | _(state file written via `summaryState.sessionPersona.write()`)_ | `personaId`, `selectionMethod` (`pinned` \| `handoff` \| `random`), `poolSize` |
| 15 | `persona:changed` | `timeline` | daemon | **new** | _(persona reminders staged, no discrete event)_ | `personaFrom`, `personaTo`, `reason` |
| 16 | `statusline:rendered` | `timeline` | cli | **rename** | `StatuslineRendered` | `displayMode`, `staleData`, `model?`, `tokens?`, `durationMs` |

#### Log-Only Events (internal machinery)

| # | Canonical Name | Visibility | Emitter | Status | Current Source | Payload (key fields) |
|---|---------------|------------|---------|--------|---------------|---------------------|
| 17 | `hook:received` | `both` | cli | **rename** | `HookReceived` | `hook`†, `cwd?`, `mode?` |
| 18 | `hook:completed` | `both` | cli | **rename** | `HookCompleted` | `hook`†, `durationMs`, `reminderReturned?`, `responseType?` |
| 19 | `event:received` | `log` | daemon | **rename** | `EventReceived` | `eventKind`, `eventType`, `hook` |
| 20 | `event:processed` | `log` | daemon | **rename** | `EventProcessed` | `handlerId`, `success`, `durationMs`, `error?` |
| 21 | `daemon:starting` | `log` | daemon | **rename** | `DaemonStarting` | `projectDir`, `pid` |
| 22 | `daemon:started` | `log` | daemon | **rename** | `DaemonStarted` | `startupDurationMs` |
| 23 | `ipc:started` | `log` | daemon | **rename** | `IpcServerStarted` | `socketPath` |
| 24 | `config:watcher-started` | `log` | daemon | **rename** | `ConfigWatcherStarted` | `projectDir`, `watchedFiles` |
| 25 | `session:eviction-started` | `log` | daemon | **rename** | `SessionEvictionStarted` | `intervalMs` |
| 26 | `session-summary:skipped` | `log` | daemon | **rename** | `SummarySkipped` | `countdown`, `countdown_threshold`, `reason` |
| 27 | `resume-message:skipped` | `log` | daemon | **rename** | `ResumeSkipped` | `title_confidence`, `intent_confidence`, `min_confidence`, `reason` |
| 28 | `statusline:error` | `both` | cli | **rename** | `StatuslineError` | `reason`, `file?`, `fallbackUsed`, `error?` |
| 29 | `transcript:emitted` | `log` | transcript | **rename** | `TranscriptEventEmitted` | `eventType`, `lineNumber`, `uuid?`, `toolName?` |
| 30 | `transcript:pre-compact` | `log` | transcript | **rename** | `PreCompactCaptured` | `snapshotPath`, `lineCount` |
| 31 | `error:occurred` | `both` | both | **new** | _(replaces UI-local `log-error`)_ | `errorMessage`, `errorStack?`, `source` |

> **†** `hook` is currently stored in `EventLogContext` (the `context` object), not in `payload`. Canonical events flatten this into the payload for consistency — the `hook` field moves from `context.hook` to `payload.hook`.

### 2.5 Naming Mismatch Resolution (PHASE2-AUDIT §2.5)

| # | Audit Mismatch | Resolution | Canonical Name(s) |
|---|---------------|------------|-------------------|
| 1 | UI expects `session-summary-start/finish` pair; daemon logs single `SummaryUpdated` | Daemon emits real start/finish pair. `SummaryUpdated` splits into `session-summary:start` (emitted when LLM call begins) and `session-summary:finish` (emitted on completion). Title/intent changes extracted as discrete events. | `session-summary:start`, `session-summary:finish`, `session-title:changed`, `intent:changed` |
| 2 | UI expects `persona-selected/changed`; daemon emits nothing | Daemon emits new events at the points where it already writes persona state files and stages persona reminders. | `persona:selected`, `persona:changed` |
| 3 | UI expects `statusline-rendered`; daemon doesn't emit (CLI-only) | No change needed — CLI already emits `StatuslineRendered` to `cli.log`, which the UI reads. Rename to canonical format. | `statusline:rendered` |
| 4 | UI `reminder-staged` vs daemon `ReminderStaged` (different payload schema) | Align payload schema to canonical contract. The daemon's `ReminderStaged` payload is the source of truth; the UI's `TranscriptLine` fields (`reminderId`, `reminderBlocking`) map to `reminderName` and `blocking`. | `reminder:staged` |

### 2.6 Start/Finish Pairs

The daemon emits real start/finish pairs for async LLM-driven operations. These pairs are genuine state transitions — the daemon already tracks task lifecycle via the task registry.

| Operation | Start Event | Finish Event | Daemon Source |
|-----------|------------|--------------|---------------|
| Session summary | `session-summary:start` | `session-summary:finish` | `update-summary.ts` — emits start before LLM call, finish after state write |
| Snarky message | `snarky-message:start` | `snarky-message:finish` | Snarky generation task — emits start before LLM call, finish after `snarky-message.json` write |
| Resume message | `resume-message:start` | `resume-message:finish` | Resume generation task — already emits `ResumeGenerating` (renamed to start) and `ResumeUpdated` (renamed to finish) |

**Error case:** If an LLM call fails between start and finish, the finish event includes an `error` field and `success: false`. The UI can show a failed state rather than an infinite spinner.

```typescript
/** Start event payload (common shape for all LLM operations). */
interface LLMOperationStartPayload {
  sessionId: string
  reason: string
}

/** Finish event payload (common shape). */
interface LLMOperationFinishPayload {
  sessionId: string
  success: boolean
  durationMs: number
  error?: string
  // Operation-specific fields follow (see §2.4 table)
}
```

### 2.7 Log File Contract

The UI's data sources are NDJSON log files:

| File | Writer | Content |
|------|--------|---------|
| `.sidekick/logs/cli.log` | CLI hook process | `hook:*`, `reminder:consumed`, `statusline:*` events |
| `.sidekick/logs/sidekickd.log` | Daemon process | All other events (daemon lifecycle, summary, persona, reminders staged, etc.) |
| `.sidekick/logs/transcript-events.log` | Transcript service | `transcript:emitted`, `transcript:pre-compact` events |

All files use identical event schema. The UI merges records from all files by `time` field (Unix ms) to produce a unified timeline. The primary merge is `cli.log` + `sidekickd.log` for the main event stream; `transcript-events.log` feeds the log viewer panel only (its events all have `visibility: 'log'`).

**Schema alignment requirement:** Both CLI and daemon must emit canonical events using the same `UIEventType` discriminator and payload structure defined in `@sidekick/types`. The Pino log record wraps the canonical event:

```typescript
// What a canonical event looks like in NDJSON (Pino record with structured fields)
{
  "level": 30,
  "time": 1741500000000,
  "pid": 12345,
  "name": "sidekickd",
  "msg": "reminder:staged",
  // --- Canonical event fields ---
  "type": "reminder:staged",
  "visibility": "timeline",
  "source": "daemon",
  "context": {
    "sessionId": "abc-123",
    "correlationId": "...",
    "traceId": "..."
  },
  "payload": {
    "reminderName": "verify-completion",
    "hookName": "Stop",
    "blocking": true,
    "priority": 0,
    "persistent": false
  }
}
```

### 2.8 Deprecation List

| Current Type | Location | Action |
|-------------|----------|--------|
| `SidekickEventType` (16 values) | `packages/sidekick-ui/src/types.ts` | **Delete.** Replace with `UIEventType` from `@sidekick/types`. |
| `SidekickEvent` interface | `packages/sidekick-ui/src/types.ts` | **Delete.** Replace with canonical type from `@sidekick/types`. |
| `SIDEKICK_EVENT_TO_FILTER` map | `packages/sidekick-ui/src/types.ts` | **Migrate.** Move to `@sidekick/types`. Filter groups derive from the `type` field's category prefix (the part before `:`). For example, `reminder:staged` → category `reminder`. No separate `category` field needed — it's encoded in the naming convention. |
| `TranscriptLine.type: SidekickEventType` | `packages/sidekick-ui/src/types.ts` | **Update.** Use `UIEventType` from `@sidekick/types`. |
| PascalCase logging event types | `packages/types/src/events.ts` | **Replace.** Single-user project — no backward compatibility needed. PascalCase `LoggingEvent` types, unions, and type guards are replaced by canonical `category:action` types. Factory functions (`LogEvents.*`, `SessionSummaryEvents.*`, `ReminderEvents.*`) updated to emit canonical names. **Special case — `SummaryUpdated`:** Splits into `session-summary:finish` + conditionally `session-title:changed` and `intent:changed`. |

### 2.9 Requirements Backlog (Changes Needed in CLI/Daemon)

This section catalogs the implementation work required to make the CLI and daemon emit the canonical event vocabulary. Each item becomes a separate bead.

#### R1: Define canonical `UIEventType` in `@sidekick/types`

Add the `UIEventType` union, `EventVisibility` type, and per-event payload interfaces to `packages/types/src/events.ts`. This is the foundation — all other changes depend on it.

#### R2: Daemon — emit start/finish pairs for LLM operations

Modify `update-summary.ts`, snarky message handler, and resume handler to emit `session-summary:start/finish`, `snarky-message:start/finish`, and `resume-message:start/finish` events. Resume already emits `ResumeGenerating`/`ResumeUpdated` — rename and align payload.

#### R3: Daemon — emit `persona:selected` and `persona:changed`

Modify `persona-selection.ts` to emit `persona:selected` after writing `session-persona.json`. Modify `stage-persona-reminders.ts` to emit `persona:changed` when persona changes mid-session.

#### R4: Daemon — emit `decision:recorded` events

Promote the current `logger.info('LLM call: ..., { decision }')` calls in `update-summary.ts` (and similar handlers) to structured `decision:recorded` events with decision value and reasoning.

#### R5: Daemon — emit `reminder:unstaged`

Modify `ctx.staging.deleteReminder()` call sites (e.g., `unstage-verify-completion.ts`, `stage-persona-reminders.ts`) to emit `reminder:unstaged` events when reminders are removed.

#### R6: Daemon — emit `session-title:changed` and `intent:changed`

Extract discrete events from `SummaryUpdated` by comparing `old_title`/`old_intent` metadata fields with current values. Emit `session-title:changed` and/or `intent:changed` only when values actually differ.

#### R7: CLI/Daemon — align `ReminderStaged` payload with canonical contract

Ensure the daemon's `ReminderStaged` event payload matches the canonical `reminder:staged` schema. Current payload already has the right fields; this is primarily a naming alignment.

#### R8: Daemon — emit `error:occurred` events

Add a structured `error:occurred` event type for daemon-level errors that should appear on the UI timeline (replacing the UI-local `log-error` concept).

### 2.10 Cross-Reference Updates

Section 3.4 (Log Stream Response) references "the event adapter (see Section 2)" for narrowing `PinoLogRecord` to typed events. Under the unified contract, this narrowing is simpler:

- Records with a `type` field matching a `UIEventType` value can be narrowed directly to the canonical event type — no adapter translation needed
- Records with a `type` field matching a `LoggingEvent` type (PascalCase) are legacy logging events — rendered in the log viewer
- Records with neither are plain Pino log lines — rendered in the log viewer as unstructured entries

## 3. Data Contracts

This section defines the TypeScript interfaces for every API response the UI backend serves to the React frontend. The UI backend reads `.sidekick/` files and serves JSON; the frontend renders it.

All types referenced below are from `@sidekick/types` unless otherwise noted. Import paths use the barrel export (`@sidekick/types`) which re-exports from submodules via `packages/types/src/index.ts`.

### 3.1 Design Principles

1. **Reuse canonical types** — All API responses reuse types from `@sidekick/types`. The UI must not redefine state types locally. The current `Record<string, unknown>` fields in the UI's `StateSnapshot` (PHASE2-AUDIT §1.3) are a type safety regression that this spec corrects (see §3.7).

2. **Validate at the boundary** — Zod schemas validate data at the backend boundary (when reading files from disk), not at the frontend. The frontend receives pre-validated, typed JSON from the backend. This keeps the React bundle free of Zod and ensures a single validation point.

3. **Thin response wrappers** — API response types add only transport-level metadata around canonical types. The wrapper fields are:
   - `timestamp` — Unix ms when the response was assembled (present on **all** responses)
   - `source` — Data provenance (`'file'`, `'derived'`, `'cached'`) (present on all responses)
   - `stale` — Boolean indicating whether the source file's mtime is older than an acceptable threshold (present only on **file-backed single-resource** responses such as `StateFileResponse<T>` and `DaemonStatusResponse`; omitted from aggregation endpoints like `SessionListResponse`, `LogStreamResponse`, `StagedRemindersResponse`, and `SessionStateResponse`)

#### 3.1.1 Standard Response Envelope

All API endpoints include `timestamp` and `source` in success responses. File-backed single-resource responses additionally include `stale`. For error responses, all endpoints return a standard error envelope:

```typescript
/** Standard error response for all API endpoints. */
interface ApiErrorResponse {
  timestamp: number
  error: {
    code: string
    message: string
    /** Optional details (e.g., Zod validation errors) */
    details?: unknown
  }
}
```

### 3.2 Session List Response

**Endpoint**: `GET /api/projects/:projectId/sessions`
**Data source**: `{project}/.sidekick/sessions/` directory listing
**Requirement**: REQUIREMENTS.md §3 (Navigation Model — session selector)

```typescript
import type { SessionStateSnapshot } from '@sidekick/types'

/** Single session entry in the listing. */
interface SessionListEntry {
  /** Session identifier (directory name) */
  id: string
  /** Absolute path to session directory */
  path: string
  /** Last modification time (Unix ms) of the session directory */
  lastModified: number
  /** Whether `.../state/` subdirectory exists and contains at least one file */
  hasState: boolean
}

/** Response for GET /api/projects/:projectId/sessions */
interface SessionListResponse {
  timestamp: number
  source: 'file'
  sessions: SessionListEntry[]
  /** Total count of sessions found */
  totalCount: number
}
```

### 3.3 State File Responses

Each state file has a canonical type in `@sidekick/types` and (where available) a Zod schema for backend validation. The backend reads the file, validates with the Zod schema, and returns the typed data wrapped in a standard envelope.

**Standard response envelope**:

```typescript
/** Generic wrapper for any single-file state response. */
interface StateFileResponse<T> {
  timestamp: number
  source: 'file'
  stale: boolean
  /** File modification time (Unix ms), null if file missing */
  fileMtime: number | null
  data: T | null
}
```

#### State File Reference

| # | File Path Pattern | Canonical Type | Zod Schema | Update Cadence | Requirements |
|---|---|---|---|---|---|
| 1 | `sessions/{id}/state/session-summary.json` | `SessionSummaryState` | `SessionSummaryStateSchema` | After LLM analysis | G-5, F-3 |
| 2 | `sessions/{id}/state/session-persona.json` | `SessionPersonaState` | `SessionPersonaStateSchema` | On SessionStart | G-1 |
| 3 | `sessions/{id}/state/last-staged-persona.json` | `LastStagedPersona` | `LastStagedPersonaSchema` | On persona staging | G-1 |
| 4 | `sessions/{id}/state/summary-countdown.json` | `SummaryCountdownState` | `SummaryCountdownStateSchema` | On summary cadence tick | G-5 |
| 5 | `sessions/{id}/state/transcript-metrics.json` | `TranscriptMetricsState` | `TranscriptMetricsStateSchema` | On transcript changes | G-7, F-3 |
| 6 | `sessions/{id}/state/daemon-log-metrics.json` | `LogMetricsState` | `LogMetricsStateSchema` | On warn/error/fatal | G-8, F-7 |
| 7 | `sessions/{id}/state/snarky-message.json` | `SnarkyMessageState` | `SnarkyMessageStateSchema` | After generation | G-5 |
| 8 | `sessions/{id}/state/resume-message.json` | `ResumeMessageState` | `ResumeMessageStateSchema` | After pivot detection | G-5 |
| 9 | `sessions/{id}/state/pr-baseline.json` | `PRBaselineState` | `PRBaselineStateSchema` | After VC consumption | G-6 |
| 10 | `sessions/{id}/state/vc-unverified.json` | `VCUnverifiedState` | `VCUnverifiedStateSchema` | On classification | G-6 |
| 11 | `sessions/{id}/state/verification-tools.json` | `VerificationToolsState` | `VerificationToolsStateSchema` | On tool status change | G-6 |
| 12 | `sessions/{id}/state/reminder-throttle.json` | `ReminderThrottleState` | `ReminderThrottleStateSchema` | On throttle update | G-6 |
| 13 | `sessions/{id}/state/compaction-history.json` | `CompactionHistoryState` | _(none — interface only)_ | On compaction events | F-1 |
| 14 | `sessions/{id}/state/context-metrics.json` | `SessionContextMetrics` | `SessionContextMetricsSchema` | On context analysis | G-7 |
| 15 | `sessions/{id}/state/llm-metrics.json` | `LLMMetricsState` | `LLMMetricsStateSchema` | On LLM call completion | G-3 |
| 16 | `state/daemon-status.json` | `DaemonStatus` | `DaemonStatusSchema` | Every 5s heartbeat | F-7, G-9 |
| 17 | `~/.sidekick/state/baseline-user-context-token-metrics.json` (user-scoped) | `BaseTokenMetricsState` | `BaseTokenMetricsStateSchema` | On context capture | G-7 |
| 18 | `state/baseline-project-context-token-metrics.json` | `ProjectContextMetrics` | `ProjectContextMetricsSchema` | On project analysis | G-7 |
| 19 | `state/task-registry.json` | `TaskRegistryState` | `TaskRegistryStateSchema` | On task enqueue/complete | G-2 |
| 20 | `state/daemon-global-log-metrics.json` | `LogMetricsState` | `LogMetricsStateSchema` | On warn/error/fatal | G-8, F-7 |

> **Note on `summary-countdown.json`**: Despite a stale comment in the Zod schema's JSDoc that says "Part of session-summary.json", this state is persisted as a separate file `summary-countdown.json`.

> **Persona definitions**: The UI needs `PersonaDefinition` (from `@sidekick/types`, services/persona.ts) to display persona details beyond the ID stored in `SessionPersonaState`. Persona definitions are loaded from YAML asset files (`assets/sidekick/personas/*.yaml`), not from session state. The backend should serve them via a dedicated endpoint (route TBD in Section 4).

**Import paths** — Types and schemas are available from the barrel export. Use `import type` for TypeScript types (erased at runtime) and a regular `import` for Zod schemas (runtime values):

```typescript
// Type-only imports (erased at runtime)
import type {
  SessionSummaryState,
  SessionPersonaState,
  LastStagedPersona,
  SummaryCountdownState,
  TranscriptMetricsState,
  LogMetricsState,
  SnarkyMessageState,
  ResumeMessageState,
  PRBaselineState,
  VCUnverifiedState,
  VerificationToolsState,
  ReminderThrottleState,
  CompactionHistoryState,
  SessionContextMetrics,
  LLMMetricsState,
  BaseTokenMetricsState,
  ProjectContextMetrics,
  DaemonStatus,
  TaskRegistryState,
} from '@sidekick/types'

// Runtime value imports (Zod schemas for validation)
import {
  SessionSummaryStateSchema,
  SessionPersonaStateSchema,
  LastStagedPersonaSchema,
  SummaryCountdownStateSchema,
  TranscriptMetricsStateSchema,
  LogMetricsStateSchema,
  SnarkyMessageStateSchema,
  ResumeMessageStateSchema,
  SessionContextMetricsSchema,
  LLMMetricsStateSchema,
  BaseTokenMetricsStateSchema,
  ProjectContextMetricsSchema,
  DaemonStatusSchema,
  TaskRegistryStateSchema,
} from '@sidekick/types'
```

**Note on `PRBaselineState` and `VCUnverifiedState`**: The TypeScript interfaces are defined in `@sidekick/types` (services/staging.ts) while their Zod schemas are defined in services/state.ts. Both are re-exported from the barrel.

**Note on `CompactionHistoryState`**: This type has no Zod schema — it is a plain TypeScript interface. The backend must perform manual validation or use a locally-defined Zod schema derived from the interface. The `CompactionEntry` type it depends on is from `@sidekick/types` (services/transcript.ts).

### 3.4 Log Stream Response

**Endpoint**: `GET /api/logs/:type`
**Data source**: `.sidekick/logs/{cli,sidekickd}.log` (NDJSON via Pino)
**Requirements**: REQUIREMENTS.md F-2 (Log-Based Replay Engine), G-8 (Structured Logging)

> **Log type-to-filename mapping**: The `:type` path parameter maps to filenames as follows: `type=cli` reads `cli.log`; `type=daemon` reads `sidekickd.log` (not `daemon.log`). See `LogSource` in `@sidekick/types` (events.ts).

Log files are NDJSON (newline-delimited JSON) written by Pino. Each line is a self-contained log record. See PHASE2-AUDIT §2.4 for the on-disk schema.

#### Parsed log record interface

```typescript
import type { LoggingEvent, LogSource, EventLogContext } from '@sidekick/types'

/**
 * Pino NDJSON log record as read from disk.
 * This is the raw shape before event-type narrowing.
 */
interface PinoLogRecord {
  /** Pino numeric log level (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal) */
  level: number
  /** Unix timestamp in ms */
  time: number
  /** Process ID */
  pid: number
  /** Logger name ('sidekickd' | 'cli') */
  name: string
  /** Human-readable message */
  msg: string

  // --- Sidekick structured fields (present on LoggingEvent records) ---
  /** Event type discriminator (e.g., 'EventProcessed', 'ReminderStaged') */
  type?: string
  /** Component source */
  source?: LogSource
  /** Correlation context */
  context?: EventLogContext
  /** Event-specific payload */
  payload?: {
    state?: Record<string, unknown>
    metadata?: Record<string, unknown>
    reason?: string
  }
}
```

Records where `type`, `source`, `context`, and `payload` are all present can be narrowed directly to typed events. Records whose `type` matches a `UIEventType` value (Section 2) narrow to the canonical event type. Records whose `type` matches a `LoggingEvent` type (PascalCase) narrow to the `LoggingEvent` discriminated union. No adapter translation is needed — the unified event contract (Section 2) ensures both emitters and the UI share the same vocabulary.

> **Note on `payload` typing**: The `Record<string, unknown>` typing on `payload` (and its nested fields) is intentional at the raw log record layer. Pino records are polymorphic — each event type has a different payload shape, and the record type represents the raw on-disk format before any narrowing. Strict typing is achieved when the UI narrows records to canonical event types via the `UIEventType` discriminator (Section 2) or to the `LoggingEvent` discriminated union from `@sidekick/types`, which provides per-event-type payload interfaces.

#### Pagination contract

```typescript
/** Request parameters for GET /api/logs/:type */
interface LogStreamRequest {
  /** Log type: 'cli' | 'daemon' */
  type: 'cli' | 'daemon'
  /** Byte offset to start reading from (0 = beginning of file) */
  offset?: number
  /** Maximum number of records to return (default: 500) */
  limit?: number
  /** Filter by session ID */
  sessionId?: string
  /** Filter by minimum log level (numeric Pino level) */
  minLevel?: number
}

/** Response for GET /api/logs/:type */
interface LogStreamResponse {
  timestamp: number
  source: 'file'
  /** Log type returned */
  logType: 'cli' | 'daemon'
  /** Parsed log records */
  records: PinoLogRecord[]
  /** Byte offset of the end of the last record returned (for next request) */
  nextOffset: number
  /** Whether more records exist beyond this batch */
  hasMore: boolean
  /** Total file size in bytes (for progress indication) */
  totalBytes: number
}
```

### 3.5 Staged Reminders Response

**Endpoint**: `GET /api/sessions/:id/reminders/staged`
**Data source**: `.sidekick/sessions/{id}/stage/{hook}/*.json`
**Requirement**: REQUIREMENTS.md G-6 (Reminder System)

The backend reads all staged reminder files across all hook directories for a session and assembles them into a `StagedRemindersSnapshot`.

```typescript
import type { StagedRemindersSnapshot, StagedReminderWithContext } from '@sidekick/types'

/** Response for GET /api/sessions/:id/reminders/staged */
interface StagedRemindersResponse {
  timestamp: number
  source: 'file'
  data: StagedRemindersSnapshot
}
```

The `StagedRemindersSnapshot` type (from `@sidekick/types`, services/state.ts) contains:

| Field | Type | Description |
|---|---|---|
| `sessionId` | `string` | Session identifier |
| `reminders` | `StagedReminderWithContext[]` | All staged reminders across all hooks |
| `totalCount` | `number` | Total count of staged reminders |
| `countByHook` | `Record<string, number>` | Count by hook name |
| `suppressedHooks` | `string[]` | Hooks that have suppression markers |

Each `StagedReminderWithContext` shares common fields with `StagedReminder` but is a standalone interface (not an extension). Key differences: `StagedReminder.stagedAt` is `StagingMetrics` (an object with timing details), while `StagedReminderWithContext.stagedAt` is `number` (Unix ms). Fields:
- `hookName: string` — Which hook this reminder targets
- `suppressed: boolean` — Whether the reminder is currently suppressed
- `stagedAt: number` — Unix ms timestamp when staged

> **Note on `StagedRemindersSnapshot` and `StagedReminderWithContext`**: These are plain interfaces with no Zod schemas. Validation occurs at the individual file level using `StagedReminderSchema` from `@sidekick/types`.

### 3.6 Daemon Status Response

**Endpoint**: `GET /api/daemon/status`
**Data source**: `.sidekick/state/daemon-status.json`
**Requirements**: REQUIREMENTS.md F-7 (System Health Dashboard), G-9 (Daemon Health)

```typescript
import type { DaemonStatus, DaemonStatusWithHealth } from '@sidekick/types'

/** Response for GET /api/daemon/status */
interface DaemonStatusResponse {
  timestamp: number
  source: 'file'
  stale: boolean
  data: DaemonStatusWithHealth | null
}
```

The `DaemonStatusWithHealth` type (from `@sidekick/types`, services/daemon-status.ts) extends `DaemonStatus` with:

| Field | Type | Description |
|---|---|---|
| `isOnline` | `boolean` | Whether daemon is online |
| `fileMtime?` | `number` | File modification time from filesystem (optional) |

**Health derivation rules** (computed by the backend):
- `isOnline = true` when `daemon-status.json` mtime is within 30 seconds of current time (REQUIREMENTS.md F-7: "30s mtime threshold")
- `isOnline = false` otherwise — the daemon has stopped writing heartbeats
- If `daemon-status.json` does not exist, return `data: null` (daemon has never run or state was cleaned)

The base `DaemonStatus` fields:

| Field | Type | Description |
|---|---|---|
| `timestamp` | `number` | Last heartbeat write (Unix ms) |
| `pid` | `number` | Daemon process ID |
| `version` | `string` | Sidekick version string |
| `uptimeSeconds` | `number` | Seconds since daemon started |
| `memory` | `DaemonMemoryMetrics` | `{ heapUsed, heapTotal, rss }` (bytes) |
| `queue` | `DaemonQueueMetrics` | `{ pending, active }` task counts |
| `activeTasks` | `ActiveTaskInfo[]` | `{ id, type, startTime }` per task |

### 3.7 Updated SessionStateSnapshot

**Endpoint**: `GET /api/sessions/:id/state`
**Data source**: All state files under `.sidekick/sessions/{id}/state/`
**Requirement**: REQUIREMENTS.md F-5 (State Inspector)

The current UI defines `StateSnapshot` (packages/sidekick-ui/src/types.ts) with `Record<string, unknown>` for all fields — a type safety regression identified in PHASE2-AUDIT §1.3.

**Correction**: The UI's `StateSnapshot` should be replaced with `SessionStateSnapshot` from `@sidekick/types` (services/state.ts), extended with additional fields the UI needs that the canonical type does not yet include.

#### Current canonical `SessionStateSnapshot` (from `@sidekick/types`)

```typescript
interface SessionStateSnapshot {
  sessionId: string
  timestamp: number
  summary?: SessionSummaryState
  resume?: ResumeMessageState
  metrics?: TranscriptMetricsState
  contextMetrics?: SessionContextMetrics
  stagedReminders?: StagedRemindersSnapshot
  compactionHistory?: CompactionHistoryState
  llmMetrics?: LLMMetricsState
  logMetrics?: LogMetricsState
}
```

#### Fields present in canonical type but absent from UI's `StateSnapshot`

These fields exist in `SessionStateSnapshot` but the current UI type omits them:

| Field | Type | Requirement |
|---|---|---|
| `logMetrics` | `LogMetricsState` | G-8 (Structured Logging) |
| `contextMetrics` | `SessionContextMetrics` | G-7 (Transcript Metrics) |
| `stagedReminders` | `StagedRemindersSnapshot` | G-6 (Reminder System) |
| `compactionHistory` | `CompactionHistoryState` | F-1 (Compaction-Aware Time Travel) |

#### Fields the UI needs but the canonical type is missing

The canonical `SessionStateSnapshot` is missing several state types that the UI requires for complete session inspection (REQUIREMENTS.md F-5: "all files under `.sidekick/sessions/{sessionId}/**`"):

| Field | Type | File | Requirement |
|---|---|---|---|
| `sessionPersona` | `SessionPersonaState` | `session-persona.json` | G-1 (Persona System) |
| `snarkyMessage` | `SnarkyMessageState` | `snarky-message.json` | G-5 (Session Summary) |
| `summaryCountdown` | `SummaryCountdownState` | `summary-countdown.json` | G-5 (Session Summary) |
| `verificationTools` | `VerificationToolsState` | `verification-tools.json` | G-6 (Reminder System) |
| `reminderThrottle` | `ReminderThrottleState` | `reminder-throttle.json` | G-6 (Reminder System) |
| `prBaseline` | `PRBaselineState` | `pr-baseline.json` | G-6 (Reminder System) |
| `vcUnverified` | `VCUnverifiedState` | `vc-unverified.json` | G-6 (Reminder System) |
| `lastStagedPersona` | `LastStagedPersona` | `last-staged-persona.json` | G-1 (Persona System) |

#### Proposed extended type

The canonical `SessionStateSnapshot` in `@sidekick/types` should be extended to include the missing fields. This is the single source of truth for both the backend and the UI:

```typescript
// Proposed update to @sidekick/types/services/state.ts
interface SessionStateSnapshot {
  sessionId: string
  timestamp: number

  // --- Already present ---
  summary?: SessionSummaryState
  resume?: ResumeMessageState
  metrics?: TranscriptMetricsState
  contextMetrics?: SessionContextMetrics
  stagedReminders?: StagedRemindersSnapshot
  compactionHistory?: CompactionHistoryState
  llmMetrics?: LLMMetricsState
  logMetrics?: LogMetricsState

  // --- To be added ---
  sessionPersona?: SessionPersonaState
  lastStagedPersona?: LastStagedPersona
  snarkyMessage?: SnarkyMessageState
  summaryCountdown?: SummaryCountdownState
  verificationTools?: VerificationToolsState
  reminderThrottle?: ReminderThrottleState
  prBaseline?: PRBaselineState
  vcUnverified?: VCUnverifiedState
}
```

**Migration path**: When the canonical type is updated, the UI's local `StateSnapshot` type in `packages/sidekick-ui/src/types.ts` should be deleted and replaced with a direct import of `SessionStateSnapshot` from `@sidekick/types`.

#### API response

```typescript
/** Response for session state snapshot (aggregated from all state files) */
interface SessionStateResponse {
  timestamp: number
  source: 'derived'
  data: SessionStateSnapshot
}
```

### 3.8 Deferred Endpoints

The following endpoints are anticipated but their full data contracts are deferred until the underlying features are implemented:

- **`GET /api/config`** — Resolved Sidekick configuration (REQUIREMENTS.md G-4, P4 priority). Contract TBD when G-4 is implemented.
- **`GET /api/sessions/:id/pre-compact`** — Pre-compaction transcript snapshots (REQUIREMENTS.md F-1). Serves files referenced by `CompactionHistoryState.entries[].transcriptSnapshotPath`. Contract TBD.
- **Individual state file routes (`GET /api/sessions/:id/state/:filename`)** — Follow the `StateFileResponse<T>` pattern from §3.3. Exact route enumeration deferred to Section 4 (API Layer Architecture).

### 3.9 Requirement Traceability

Every data contract in this section maps to one or more features from REQUIREMENTS.md §4-5.

| Data Contract | Section | Requirement(s) |
|---|---|---|
| `SessionListResponse` | §3.2 | REQUIREMENTS.md §3 (Navigation Model) |
| `SessionSummaryState` | §3.3 #1 | G-5 (Session Summary), F-3 (Session Timeline) |
| `SessionPersonaState` | §3.3 #2 | G-1 (Persona System) |
| `LastStagedPersona` | §3.3 #3 | G-1 (Persona System) |
| `SummaryCountdownState` | §3.3 #4 | G-5 (Session Summary) |
| `TranscriptMetricsState` | §3.3 #5 | G-7 (Transcript Metrics), F-3 (Session Timeline) |
| `LogMetricsState` | §3.3 #6 | G-8 (Structured Logging), F-7 (System Health) |
| `SnarkyMessageState` | §3.3 #7 | G-5 (Session Summary) |
| `ResumeMessageState` | §3.3 #8 | G-5 (Session Summary) |
| `PRBaselineState` | §3.3 #9 | G-6 (Reminder System) |
| `VCUnverifiedState` | §3.3 #10 | G-6 (Reminder System) |
| `VerificationToolsState` | §3.3 #11 | G-6 (Reminder System) |
| `ReminderThrottleState` | §3.3 #12 | G-6 (Reminder System) |
| `CompactionHistoryState` | §3.3 #13 | F-1 (Compaction-Aware Time Travel) |
| `SessionContextMetrics` | §3.3 #14 | G-7 (Transcript Metrics) |
| `LLMMetricsState` | §3.3 #15 | G-3 (Provider/Telemetry) |
| `DaemonStatus` | §3.3 #16 | F-7 (System Health), G-9 (Daemon Health) |
| `BaseTokenMetricsState` | §3.3 #17 | G-7 (Transcript Metrics) |
| `ProjectContextMetrics` | §3.3 #18 | G-7 (Transcript Metrics) |
| `TaskRegistryState` | §3.3 #19 | G-2 (Task Engine) |
| `PinoLogRecord` / `LogStreamResponse` | §3.4 | F-2 (Log-Based Replay), G-8 (Structured Logging) |
| `StagedRemindersSnapshot` | §3.5 | G-6 (Reminder System) |
| `DaemonStatusWithHealth` | §3.6 | F-7 (System Health), G-9 (Daemon Health) |
| `SessionStateSnapshot` (extended) | §3.7 | F-5 (State Inspector) |
| `LogMetricsState` (global) | §3.3 #20 | G-8 (Structured Logging), F-7 (System Health) |
| `PersonaDefinition` _(note)_ | §3.3 | G-1 (Persona System) — route TBD in Section 4 |
| Deferred: `/api/config` | §3.8 | G-4 (Configuration) |
| Deferred: `/api/sessions/:id/pre-compact` | §3.8 | F-1 (Compaction-Aware Time Travel) |
| Deferred: `/api/sessions/:id/state/:filename` | §3.8 | F-5 (State Inspector) |

## 4. API Layer Architecture

> **Design decision:** Vite dev proxy with `chokidar`-driven cache and SSE push. See [`docs/plans/2026-03-09-api-layer-architecture-design.md`](/docs/plans/2026-03-09-api-layer-architecture-design.md) for rationale and alternatives considered.

### 4.1 Backend Architecture: Vite Middleware Plugin

The UI backend runs as a Vite middleware plugin — API routes are registered as Connect middleware on the Vite dev server. No standalone HTTP server process.

**Why Vite-only:**
- Single-user local tool with no production deployment scenario
- The archived `.archive/server/api-plugin.ts` demonstrates this pattern (itty-router over Vite middleware)
- One process to manage; handlers are portable if a standalone server is ever needed
- Hot module reload for the React frontend works seamlessly alongside the API

**Entry point:** A Vite plugin exports a `configureServer` hook that registers an itty-router instance as Connect middleware. All `/api/*` requests are handled by the router; everything else falls through to Vite's default static/HMR handling.

```typescript
import type { Plugin } from 'vite'
import { Router } from 'itty-router'

export function sidekickApiPlugin(): Plugin {
  return {
    name: 'sidekick-api',
    configureServer(server) {
      const router = Router({ base: '/api' })
      // Register routes (see §4.5)
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api')) return next()
        // Route handling...
      })
    },
  }
}
```

### 4.2 File Watching and Cache Layer

The backend watches `.sidekick/` directories using `chokidar` and maintains an in-memory cache of file contents. File changes trigger cache invalidation, re-reads, and SSE notifications to the frontend.

> **Why `chokidar` over `fs.watch`:** Node's built-in `fs.watch` does not support recursive watching on Linux (only macOS and Windows). The codebase already uses `chokidar` for file watching (see `packages/sidekick-daemon/src/config-watcher.ts`), so this is consistent with the existing approach. `chokidar` provides reliable cross-platform file watching with built-in debouncing, glob filtering, and atomic write detection.

#### 4.2.1 Architecture Layers

```
┌──────────────┐     events      ┌──────────────┐    invalidate    ┌──────────────┐
│  FileWatcher │ ──────────────► │  FileCache   │ ───────────────► │  SSE Bus     │
│  (chokidar)  │  file:changed   │  (in-memory) │   push to        │  (EventSource)│
│              │  file:created   │              │   connected       │              │
│              │  file:deleted   │              │   clients         │              │
└──────────────┘                 └──────────────┘                  └──────────────┘
       ▲                                │
       │ attach/detach                  │ serve from cache
       │ (lazy, per session)            ▼
┌──────────────┐                 ┌──────────────┐
│  Session     │                 │  API Handlers│
│  Selection   │                 │  (itty-router)│
└──────────────┘                 └──────────────┘
```

#### 4.2.2 FileWatcher

Watches directories recursively via `chokidar`. Emits typed events when files change.

```typescript
/** Events emitted by the FileWatcher. */
interface FileWatcherEvent {
  type: 'file:changed' | 'file:created' | 'file:deleted'
  /** Absolute path to the affected file */
  path: string
  /** Unix ms timestamp of the event */
  timestamp: number
}
```

**Behavior:**
- Watches directories, not individual files — picks up new files automatically
- Debounces duplicate notifications (chokidar handles FSEvents batching on macOS; 50ms `awaitWriteFinish` stabilization threshold)
- Ignores dotfiles, `.tmp` files, and partial writes (files ending in `.tmp` or `~`)
- Emits `file:created` for new files, `file:changed` for modifications, `file:deleted` for removals
- On watcher error: logs, attempts re-establishment with exponential backoff (1s, 2s, 4s, max 30s). After 5 consecutive failures, falls back to polling (2s interval) for that directory.

**Lazy attachment:** Watchers are not created on server startup. They attach when the user selects a session (see §4.4) and detach when the user navigates away. This avoids watching dozens of inactive session directories.

**Watch targets per active session:**

| Directory | Purpose | Watch Depth |
|-----------|---------|-------------|
| `{project}/.sidekick/sessions/{id}/state/` | Session state files | Flat (no subdirs) |
| `{project}/.sidekick/state/` | Daemon status, task registry, global metrics | Flat |
| `{project}/.sidekick/logs/` | Log files (for rotation detection) | Flat |
| `{project}/.sidekick/sessions/{id}/stage/` | Staged reminders | Recursive (hook subdirs) |

#### 4.2.3 FileCache

In-memory cache of parsed file contents with mtime tracking.

```typescript
interface CacheEntry<T> {
  /** Parsed and validated file content */
  data: T | null
  /** File modification time (Unix ms) from fs.stat */
  mtime: number | null
  /** When this entry was last read from disk */
  lastRead: number
  /** Whether the last read failed (parse error, missing file) */
  error?: string
}
```

**Behavior:**
- On `file:changed` / `file:created`: re-read file from disk, parse JSON, validate with Zod schema (where available), update cache entry
- On `file:deleted`: set `data: null`, `mtime: null`
- API handlers read from cache, never directly from disk (except on cache miss, which triggers a synchronous read)
- Cache entries are keyed by absolute file path
- No TTL — entries are invalidated only by watcher events
- Cache is cleared entirely when the active session changes

#### 4.2.4 SSE Push (Server-Sent Events)

One SSE endpoint pushes file change notifications to the frontend. The frontend uses these to know which data to re-fetch.

**Endpoint:** `GET /api/events`

**Connection lifecycle:**
- One SSE connection at a time per browser tab
- When the user selects a session, the frontend opens an SSE connection (or the existing connection is re-scoped)
- When the user switches sessions, the backend tears down old watchers and spins up new ones; the SSE connection stays open but begins emitting events for the new session
- Standard SSE reconnection via `EventSource` API (browser handles retry automatically)

**Event format:**

```typescript
/** SSE data payload for file change events. */
interface FileChangeSSEEvent {
  /** Change type */
  type: 'file:changed' | 'file:created' | 'file:deleted'
  /** Relative path within .sidekick/ (e.g., 'sessions/abc/state/session-summary.json') */
  path: string
  /** Unix ms timestamp */
  timestamp: number
}

/** SSE data payload for session lifecycle events. */
interface SessionChangeSSEEvent {
  /** Lifecycle type */
  type: 'session:activated' | 'session:deactivated'
  /** Session ID */
  sessionId: string
  /** Project ID (base64url-encoded path) */
  projectId: string
  timestamp: number
}
```

**Wire format** (standard SSE):
```
event: file:changed
data: {"type":"file:changed","path":"sessions/abc/state/session-summary.json","timestamp":1741500000000}

event: session:activated
data: {"type":"session:activated","sessionId":"abc","projectId":"L1VzZXJzL3Njb3R0L3NyYy9wcm9qZWN0cy9mb28","timestamp":1741500001000}
```

**Design note:** SSE carries notifications only, not data. The frontend receives a change event and re-fetches the affected resource via the REST API. This avoids duplicating validation/transformation logic in the SSE path and keeps SSE payloads minimal.

### 4.3 Error Handling

#### 4.3.1 Missing Files

A state file that doesn't exist yet is **normal** — the session just started or the feature hasn't triggered. This is not an error condition.

**Response:** Return `data: null` with `fileMtime: null` in the `StateFileResponse<T>` envelope. The frontend renders a placeholder or "waiting for data" state. No error toast, no log noise.

#### 4.3.2 Locked or Busy Files

The daemon uses atomic write-to-temp-then-rename for all state files, so true file locks are extremely unlikely. A file is either fully written (readable) or not yet renamed into place (invisible to readers).

**Response:** On `EACCES` or `EBUSY`, retry once after 100ms. If retry fails, serve stale cached data (if available) with `stale: true` in the response envelope. If no cached data exists, return `data: null` with error details.

#### 4.3.3 Corrupt JSON

`JSON.parse` failures or Zod validation failures when reading a state file.

**Response:** Log the error (file path, error message, raw content preview). Return `data: null` with error details in the response. The server continues serving other files normally. One bad file does not crash the backend or affect other endpoints.

```typescript
/** Error detail included when a file fails validation. */
interface FileReadError {
  /** Error category */
  code: 'PARSE_ERROR' | 'VALIDATION_ERROR' | 'READ_ERROR'
  /** Human-readable message */
  message: string
  /** File path that failed */
  filePath: string
}
```

#### 4.3.4 Log Rotation Mid-Read

The log handler tracks byte offsets for incremental reads (§3.4). Log rotation is detected when the current file size is smaller than the last known offset.

**Response:** Reset offset to zero, re-read from the beginning. Include `rotationDetected: true` in the `LogStreamResponse` so the frontend knows to clear its log buffer and rebuild from the fresh data.

```typescript
// Addition to LogStreamResponse (extends §3.4)
interface LogStreamResponse {
  // ... existing fields from §3.4 ...
  /** True if log rotation was detected (file truncated or replaced) */
  rotationDetected: boolean
}
```

#### 4.3.5 Watcher Errors

`chokidar` can emit errors due to permissions, exceeding the OS file descriptor limit, or unmounted volumes.

**Response:** Log the error with the affected directory path. Attempt to re-establish the watch with exponential backoff (1s → 2s → 4s → 8s → 16s → 30s cap). After 5 consecutive failures for the same directory, fall back to polling (2s interval) for that directory only. Emit a `watcher:degraded` SSE event so the frontend can display a subtle indicator that updates may be delayed.

```typescript
/** SSE event when a watcher falls back to polling. */
interface WatcherDegradedSSEEvent {
  type: 'watcher:degraded'
  /** Directory that fell back to polling */
  directory: string
  /** Polling interval in ms */
  pollingIntervalMs: number
  timestamp: number
}
```

### 4.4 Scope Resolution: Navigation Funnel

The UI follows a navigation funnel from projects → sessions → active session. Each level reads from a different scope.

```
┌─────────────────────────────────────────────────────────────┐
│ 1. Startup: read ~/.sidekick/                               │
│    → Discover known projects (project registry)             │
│    → Load user-level config/preferences                     │
├─────────────────────────────────────────────────────────────┤
│ 2. Project selected: read {projectPath}/.sidekick/          │
│    → List sessions from sessions/ directory                 │
│    → Read daemon status from state/daemon-status.json       │
├─────────────────────────────────────────────────────────────┤
│ 3. Session selected: attach watchers to                     │
│    {projectPath}/.sidekick/sessions/{id}/state/              │
│    {projectPath}/.sidekick/sessions/{id}/stage/              │
│    {projectPath}/.sidekick/state/                            │
│    {projectPath}/.sidekick/logs/                             │
│    → SSE begins pushing file change events                  │
│    → Cache populates with initial file reads                │
└─────────────────────────────────────────────────────────────┘
```

**Key properties:**

- **`~/.sidekick/`** serves global navigation data only (project registry, user config). No watchers here — this data changes infrequently and is read on demand.
- **Project `.sidekick/`** is read on demand for session listing and daemon status. No persistent watchers at this level.
- **Session `.sidekick/sessions/{id}/`** is the active workspace. Watchers, cache, and SSE all attach here when the user selects a session.
- **Session switching** tears down all watchers and clears the cache before attaching to the new session. The SSE connection stays open and begins emitting events for the new session.

#### 4.4.1 Project Discovery

On startup, the backend reads `~/.sidekick/` to find a registry of known projects. This registry maps project IDs to filesystem paths and basic metadata.

> **Dependency:** The project registry feature does not yet exist. See `claude-code-sidekick-099` (P1, blocked by this spec). Until implemented, the UI can fall back to a startup parameter (e.g., `--project-dir`) or discover the project from the current working directory.

#### 4.4.2 Session Discovery

Given a project path, the backend reads `{projectPath}/.sidekick/sessions/` to list available sessions. Each subdirectory is a session. The `SessionListEntry` type (§3.2) provides the ID, path, last-modified time, and whether the session has state data.

### 4.5 API Route Design

Routes follow the navigation funnel: global → project → session. All routes return JSON with the response envelopes defined in Section 3.

#### 4.5.1 Project ID Encoding

Project identifiers use **base64url** encoding of the absolute project path. This provides lossless round-tripping for any valid filesystem path, including paths containing hyphens or non-ASCII characters.

| Project Path | Project ID |
|---|---|
| `/Users/scott/src/projects/claude-code-sidekick` | `L1VzZXJzL3Njb3R0L3NyYy9wcm9qZWN0cy9jbGF1ZGUtY29kZS1zaWRla2ljaw` |
| `/Users/scott/src/oss/beads` | `L1VzZXJzL3Njb3R0L3NyYy9vc3MvYmVhZHM` |

**Encoding:** `Buffer.from(path).toString('base64url')` — standard base64url (RFC 4648 §5), no padding.
**Decoding:** `Buffer.from(projectId, 'base64url').toString('utf8')`.

> **Why not dash-encoding (Claude Code convention)?** Claude Code's `~/.claude/projects/` directory uses `/` → `-` substitution, but this encoding is lossy — it cannot round-trip paths that contain hyphens (e.g., `/home/my-user/my-project`). Since the UI needs to decode project IDs back to filesystem paths for file reads, lossless encoding is required. The backend can still cross-reference against Claude Code's dash-encoded directory names for project discovery.

#### 4.5.2 Route Table

##### Tier 1: Global

| Method | Route | Response Type | Source |
|--------|-------|--------------|--------|
| `GET` | `/api/projects` | `ProjectListResponse` | `~/.sidekick/` registry |
| `GET` | `/api/config` | _Deferred (§3.8)_ | `~/.sidekick/config/` |
| `GET` | `/api/state/baseline-user-context-token-metrics` | `StateFileResponse<BaseTokenMetricsState>` (§3.3 #17) | `~/.sidekick/state/baseline-user-context-token-metrics.json` |

```typescript
/** Single project entry in the listing. */
interface ProjectListEntry {
  /** Base64url-encoded project path (§4.5.1) */
  id: string
  /** Absolute filesystem path to the project root */
  path: string
  /** Human-readable project name (directory basename) */
  name: string
  /** Whether {path}/.sidekick/ exists and is accessible */
  accessible: boolean
  /** Last modification time of the .sidekick/ directory (Unix ms) */
  lastModified: number | null
}

/** Response for GET /api/projects */
interface ProjectListResponse {
  timestamp: number
  source: 'file'
  projects: ProjectListEntry[]
  totalCount: number
}
```

##### Tier 2: Project

| Method | Route | Response Type | Source |
|--------|-------|--------------|--------|
| `GET` | `/api/projects/:projectId/sessions` | `SessionListResponse` (§3.2) | `{project}/.sidekick/sessions/` |
| `GET` | `/api/projects/:projectId/daemon/status` | `DaemonStatusResponse` (§3.6) | `{project}/.sidekick/state/daemon-status.json` |
| `GET` | `/api/projects/:projectId/state/baseline-project-context-token-metrics` | `StateFileResponse<ProjectContextMetrics>` (§3.3 #18) | `{project}/.sidekick/state/baseline-project-context-token-metrics.json` |
| `GET` | `/api/projects/:projectId/state/task-registry` | `StateFileResponse<TaskRegistryState>` (§3.3 #19) | `{project}/.sidekick/state/task-registry.json` |
| `GET` | `/api/projects/:projectId/state/daemon-global-log-metrics` | `StateFileResponse<LogMetricsState>` (§3.3 #20) | `{project}/.sidekick/state/daemon-global-log-metrics.json` |
| `GET` | `/api/projects/:projectId/personas` | `PersonaListResponse` | Persona YAML assets |

##### Tier 3: Session

| Method | Route | Response Type | Source |
|--------|-------|--------------|--------|
| `GET` | `/api/projects/:projectId/sessions/:sessionId/state` | `SessionStateResponse` (§3.7) | All state files aggregated |
| `GET` | `/api/projects/:projectId/sessions/:sessionId/state/:filename` | `StateFileResponse<T>` (§3.3) | Individual state file |
| `GET` | `/api/projects/:projectId/sessions/:sessionId/logs/:type` | `LogStreamResponse` (§3.4) | `cli.log` or `sidekickd.log` |
| `GET` | `/api/projects/:projectId/sessions/:sessionId/pre-compact/:timestamp` | _Deferred (§3.8)_ | Pre-compaction snapshot |
| `GET` | `/api/projects/:projectId/sessions/:sessionId/reminders/staged` | `StagedRemindersResponse` (§3.5) | `stage/{hook}/*.json` |

##### SSE

| Method | Route | Response Type | Purpose |
|--------|-------|--------------|---------|
| `GET` | `/api/events` | SSE stream | File change + session lifecycle notifications |

##### State File Routes

The `:filename` parameter in `/api/projects/:projectId/sessions/:sessionId/state/:filename` maps to files under `.sidekick/sessions/{id}/state/`. The filename is the JSON file's basename without extension.

| `:filename` Value | File | Response Type |
|---|---|---|
| `session-summary` | `session-summary.json` | `StateFileResponse<SessionSummaryState>` |
| `session-persona` | `session-persona.json` | `StateFileResponse<SessionPersonaState>` |
| `last-staged-persona` | `last-staged-persona.json` | `StateFileResponse<LastStagedPersona>` |
| `summary-countdown` | `summary-countdown.json` | `StateFileResponse<SummaryCountdownState>` |
| `transcript-metrics` | `transcript-metrics.json` | `StateFileResponse<TranscriptMetricsState>` |
| `daemon-log-metrics` | `daemon-log-metrics.json` | `StateFileResponse<LogMetricsState>` |
| `snarky-message` | `snarky-message.json` | `StateFileResponse<SnarkyMessageState>` |
| `resume-message` | `resume-message.json` | `StateFileResponse<ResumeMessageState>` |
| `pr-baseline` | `pr-baseline.json` | `StateFileResponse<PRBaselineState>` |
| `vc-unverified` | `vc-unverified.json` | `StateFileResponse<VCUnverifiedState>` |
| `verification-tools` | `verification-tools.json` | `StateFileResponse<VerificationToolsState>` |
| `reminder-throttle` | `reminder-throttle.json` | `StateFileResponse<ReminderThrottleState>` |
| `compaction-history` | `compaction-history.json` | `StateFileResponse<CompactionHistoryState>` |
| `context-metrics` | `context-metrics.json` | `StateFileResponse<SessionContextMetrics>` |
| `llm-metrics` | `llm-metrics.json` | `StateFileResponse<LLMMetricsState>` |

### 4.6 Cross-References

- **Section 2** (Unified Event Contract) defines the canonical events that appear in log files read by the `/api/.../logs/:type` endpoint
- **Section 3** (Data Contracts) defines the response types for every endpoint listed in §4.5.2
- **§3.4** (`LogStreamResponse`) is extended in §4.3.4 with `rotationDetected`
- **§3.8** (Deferred Endpoints) lists contracts not yet specified: `/api/config` and `/api/.../pre-compact/:timestamp`
- **`claude-code-sidekick-099`** tracks the project registry feature required by §4.4.1

### 4.7 Requirements Traceability

| Requirement | Section | How Addressed |
|---|---|---|
| REQUIREMENTS.md §6 (file-based data source) | §4.1, §4.2 | Backend reads `.sidekick/` files via Vite middleware; no daemon modification |
| REQUIREMENTS.md §7 (no WebSocket) | §4.2.4 | SSE (plain HTTP) used for push notifications instead of WebSocket |
| PHASE2-AUDIT §4.2 (Option C: file-based reads) | §4.1 | Vite middleware plugin reads state files directly |
| PHASE2-AUDIT §2.4 (state file inventory) | §4.5.2 | All 20 state files from §3.3 exposed via REST endpoints — session-scoped (#1-#16) via Tier 3 `state/:filename`, project-scoped (#18-#20) via Tier 2, user-scoped (#17) via Tier 1 |
| REQUIREMENTS.md §3 (navigation model) | §4.4 | Navigation funnel: projects → sessions → active session |
| REQUIREMENTS.md F-5 (state inspector) | §4.5.2 | Aggregated and individual state file endpoints |
| REQUIREMENTS.md F-2 (log-based replay) | §4.5.2 | Log stream endpoint with offset pagination |
| REQUIREMENTS.md F-7 (system health) | §4.5.2 | Daemon status endpoint with 30s offline threshold |
| REQUIREMENTS.md G-6 (reminder system) | §4.5.2 | Staged reminders endpoint |
| REQUIREMENTS.md F-1 (compaction time travel) | §4.5.2 | Compaction history and pre-compact snapshot endpoints |

## 5. Performance Requirements
<!-- Placeholder: sidekick-35ddf68f -->

## 6. Component-to-Type Wiring
<!-- Placeholder: sidekick-e4374d53 -->

## 7. New Feature Integration
<!-- Placeholder: sidekick-a8437ed4 -->
