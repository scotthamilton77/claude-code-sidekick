# Sidekick UI — Implementation Spec

> Produced from REQUIREMENTS.md + PHASE2-AUDIT.md.
> Each section corresponds to a child task of epic sidekick-bf3bcd19.

## 1. [TBD — Overview/Scope]
<!-- Placeholder: produced by another task -->

## 2. Unified Event Contract

> **Design decision:** No adapter layer. One canonical event vocabulary in `@sidekick/types`, consumed by both emitters (CLI, daemon) and the UI. See `docs/plans/2026-03-08-unified-event-contract-design.md` for rationale.

### 2.1 Design Decision: No Adapter Layer

PHASE2-AUDIT §4.3 recommended restoring an archived `event-adapter.ts` pattern to translate between 28+ logging event types and 16 UI event types. This spec **rejects that approach** in favor of a unified event vocabulary.

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

**Categories:** `reminder`, `session-summary`, `snarky-message`, `resume-message`, `persona`, `statusline`, `decision`, `hook`, `event`, `daemon`, `ipc`, `config`, `session`, `transcript`, `error`

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
| `log` | Log viewer panel only (REQUIREMENTS.md G-8) — internal machinery | `daemon:started`, `config:watcher-started`, `summary:skipped` |
| `both` | Both timeline and log viewer | `hook:received`, `hook:completed`, `error` |

The visibility is part of the type definition in `@sidekick/types`. The UI reads this field to decide where to render — no conditional filter logic needed.

### 2.4 Canonical Event Table

Every event type in the unified vocabulary, organized by category. The **Emitter** column indicates which process writes the event to its log file. The **Status** column indicates whether this is an existing event being renamed or a new event the emitter must start producing.

#### Timeline Events (user-visible state changes)

| # | Canonical Name | Visibility | Emitter | Status | Current Source | Payload (key fields) |
|---|---------------|------------|---------|--------|---------------|---------------------|
| 1 | `reminder:staged` | `timeline` | daemon | **rename** | `ReminderStaged` | `reminderName`, `hookName`, `blocking`, `priority`, `persistent` |
| 2 | `reminder:unstaged` | `timeline` | daemon | **new** | _(no event — `ctx.staging.deleteReminder()` is silent)_ | `reminderName`, `hookName`, `reason` |
| 3 | `reminder:consumed` | `timeline` | cli | **rename** | `ReminderConsumed` | `reminderName`, `reminderReturned`, `blocking`, `priority`, `persistent` |
| 4 | `reminder:cleared` | `timeline` | daemon | **rename** | `RemindersCleared` | `clearedCount`, `hookNames`, `reason` |
| 5 | `decision` | `timeline` | daemon | **new** | _(logger.info calls with `decision` field, not structured events)_ | `category`, `decision`, `reason`, `detail` |
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
| 16 | `statusline:rendered` | `timeline` | cli | **rename** | `StatuslineRendered` | `displayMode`, `staleData`, `model`, `tokens`, `durationMs` |

#### Log-Only Events (internal machinery)

| # | Canonical Name | Visibility | Emitter | Status | Current Source | Payload (key fields) |
|---|---------------|------------|---------|--------|---------------|---------------------|
| 17 | `hook:received` | `both` | cli | **rename** | `HookReceived` | `hook`, `cwd`, `mode` |
| 18 | `hook:completed` | `both` | cli | **rename** | `HookCompleted` | `hook`, `durationMs`, `reminderReturned`, `responseType` |
| 19 | `event:received` | `log` | daemon | **rename** | `EventReceived` | `eventKind`, `eventType`, `hook` |
| 20 | `event:processed` | `log` | daemon | **rename** | `EventProcessed` | `handlerId`, `success`, `durationMs`, `error` |
| 21 | `daemon:starting` | `log` | daemon | **rename** | `DaemonStarting` | `projectDir`, `pid` |
| 22 | `daemon:started` | `log` | daemon | **rename** | `DaemonStarted` | `startupDurationMs` |
| 23 | `ipc:started` | `log` | daemon | **rename** | `IpcServerStarted` | `socketPath` |
| 24 | `config:watcher-started` | `log` | daemon | **rename** | `ConfigWatcherStarted` | `projectDir`, `watchedFiles` |
| 25 | `session:eviction-started` | `log` | daemon | **rename** | `SessionEvictionStarted` | `intervalMs` |
| 26 | `summary:skipped` | `log` | daemon | **rename** | `SummarySkipped` | `countdown`, `countdown_threshold`, `reason` |
| 27 | `resume:skipped` | `log` | daemon | **rename** | `ResumeSkipped` | `title_confidence`, `intent_confidence`, `min_confidence`, `reason` |
| 28 | `statusline:error` | `both` | cli | **rename** | `StatuslineError` | `reason`, `file`, `fallbackUsed`, `error` |
| 29 | `transcript:emitted` | `log` | transcript | **rename** | `TranscriptEventEmitted` | `eventType`, `lineNumber`, `uuid`, `toolName` |
| 30 | `transcript:pre-compact` | `log` | transcript | **rename** | `PreCompactCaptured` | `snapshotPath`, `lineCount` |
| 31 | `error` | `both` | both | **new** | _(replaces UI-local `log-error`)_ | `errorMessage`, `errorStack`, `source` |

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

### 2.7 Two-File Contract

The UI's data source is two NDJSON log files:

| File | Writer | Content |
|------|--------|---------|
| `.sidekick/logs/cli.log` | CLI hook process | `hook:*`, `reminder:consumed`, `statusline:*` events |
| `.sidekick/logs/sidekickd.log` | Daemon process | All other events (daemon lifecycle, summary, persona, reminders staged, etc.) |

Both files use identical event schema. The UI merges records from both files by `time` field (Unix ms) to produce a unified timeline.

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
| `SIDEKICK_EVENT_TO_FILTER` map | `packages/sidekick-ui/src/types.ts` | **Migrate.** Move to `@sidekick/types` using `visibility` field and a `category` field for filter groups. |
| `TranscriptLine.type: SidekickEventType` | `packages/sidekick-ui/src/types.ts` | **Update.** Use `UIEventType` from `@sidekick/types`. |
| PascalCase logging event types | `packages/types/src/events.ts` | **Keep but supplement.** `LoggingEvent` types remain for backward compatibility. New canonical events with `category:action` names are emitted alongside. Migration path: once all consumers adopt canonical names, PascalCase types can be removed. |

### 2.9 Requirements Backlog (Changes Needed in CLI/Daemon)

This section catalogs the implementation work required to make the CLI and daemon emit the canonical event vocabulary. Each item becomes a separate bead.

#### R1: Define canonical `UIEventType` in `@sidekick/types`

Add the `UIEventType` union, `EventVisibility` type, and per-event payload interfaces to `packages/types/src/events.ts`. This is the foundation — all other changes depend on it.

#### R2: Daemon — emit start/finish pairs for LLM operations

Modify `update-summary.ts`, snarky message handler, and resume handler to emit `session-summary:start/finish`, `snarky-message:start/finish`, and `resume-message:start/finish` events. Resume already emits `ResumeGenerating`/`ResumeUpdated` — rename and align payload.

#### R3: Daemon — emit `persona:selected` and `persona:changed`

Modify `persona-selection.ts` to emit `persona:selected` after writing `session-persona.json`. Modify `stage-persona-reminders.ts` to emit `persona:changed` when persona changes mid-session.

#### R4: Daemon — emit `decision` events

Promote the current `logger.info('LLM call: ..., { decision }')` calls in `update-summary.ts` (and similar handlers) to structured `decision` events with category, decision value, and reasoning.

#### R5: Daemon — emit `reminder:unstaged`

Modify `ctx.staging.deleteReminder()` call sites (e.g., `unstage-verify-completion.ts`, `stage-persona-reminders.ts`) to emit `reminder:unstaged` events when reminders are removed.

#### R6: Daemon — emit `session-title:changed` and `intent:changed`

Extract discrete events from `SummaryUpdated` by comparing `old_title`/`old_intent` metadata fields with current values. Emit `session-title:changed` and/or `intent:changed` only when values actually differ.

#### R7: CLI/Daemon — align `ReminderStaged` payload with canonical contract

Ensure the daemon's `ReminderStaged` event payload matches the canonical `reminder:staged` schema. Current payload already has the right fields; this is primarily a naming alignment.

#### R8: Daemon — emit `error` events

Add a structured `error` event type for daemon-level errors that should appear on the UI timeline (replacing the UI-local `log-error` concept).

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

**Endpoint**: `GET /api/sessions`
**Data source**: `.sidekick/sessions/` directory listing
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

/** Response for GET /api/sessions */
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
<!-- Placeholder: sidekick-4385facb -->

## 5. Performance Requirements
<!-- Placeholder: sidekick-35ddf68f -->

## 6. Component-to-Type Wiring
<!-- Placeholder: sidekick-e4374d53 -->

## 7. New Feature Integration
<!-- Placeholder: sidekick-a8437ed4 -->
