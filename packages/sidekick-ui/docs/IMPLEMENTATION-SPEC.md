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

> **Persona definitions**: The UI needs `PersonaDefinition` (from `@sidekick/types`, services/persona.ts) to display persona details beyond the ID stored in `SessionPersonaState`. Persona definitions are loaded from YAML asset files (`assets/sidekick/personas/*.yaml`), not from session state. The backend serves them via `GET /api/projects/:projectId/personas` (Tier 2, Section 4.5.2).

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

> **Design decision:** Green-field targets — neither REQUIREMENTS.md nor PHASE2-AUDIT.md define concrete performance metrics. Targets below are derived from observed data volumes (PHASE2-AUDIT §2.4), UX expectations for a local dev tool, and the architectural constraints established in §4 (file-based data source, SSE push, Vite middleware). See [`docs/plans/2026-03-13-performance-requirements-design.md`](/docs/plans/2026-03-13-performance-requirements-design.md) for rationale.

### 5.1 Design Principles

Three principles govern performance work in the UI:

1. **Measure, don't guess** — `performance.mark()` / `performance.measure()` at key boundaries. No premature optimization without profiling data.
2. **Rotation is the regulator** — The log rotation policy (10MB × 5 files, PHASE2-AUDIT §2.4) is the natural bound on data volume. Performance targets are derived from this ceiling, not from unbounded growth assumptions.
3. **Single-session model** — One session is hydrated at a time. When the user navigates to a different session, the previous session's parsed data is released. No multi-session caching.

### 5.2 Virtual Scrolling

**Threshold:** 200 events — below this, native DOM rendering; at or above, virtual scrolling activates.

**Library:** TanStack Virtual (formerly react-virtual) — zero-dependency, ~3KB gzipped, framework-agnostic.

**Why 200:**
At ~300 bytes/event, 200 events is ~60KB of data — trivially renderable with native DOM. Beyond 200, DOM node count causes measurable layout thrash. The known pain point (1000+ events noted in epic sidekick-n4lx) is well above this threshold.

**Why buy, not build:**
TanStack Virtual is mature, actively maintained, and smaller than any custom implementation would be. The virtualizer handles variable-height rows (event detail expansion) out of the box.

**Risk:** None identified at this threshold. TanStack Virtual handles 100K+ rows efficiently.

### 5.3 Live Mode Polling

**Interval:** 1,000ms (1 second) frontend refetch cycle after SSE notification.

**Architecture:** Backend pushes SSE change notifications via chokidar file watching (§4.2, 50ms write-finish stabilization). Frontend coalesces multiple SSE notifications within a 1s window into a single data fetch.

**Why 1 second:**
Balances perceptible real-time feel against unnecessary re-renders. The debounce prevents render storms during burst writes (e.g., rapid hook execution producing many events in quick succession).

**Risk:** If events arrive faster than 1/sec sustained, the UI batches them — the user sees slight "catch-up" but no data loss. Acceptable for a dev monitoring tool.

**Reference:** REQUIREMENTS.md F-9 (live mode auto-follow).

### 5.4 Rendering Budget

**Target:** 16ms per frame (60fps).

**Strategy:** React 18 `startTransition` for non-urgent timeline updates. Only auto-follow scroll-to-bottom in live mode is treated as urgent. Event list re-renders are low-priority transitions that React can interrupt without dropping frames.

**Rule:** If a single render pass exceeds 16ms, that is a bug to be profiled and fixed — not a trigger for architectural changes. The virtualizer + React concurrent features should keep well within budget for expected data volumes.

### 5.5 Log File Ingestion

**Max file size:** 10MB per file — matching the log rotation cap (PHASE2-AUDIT §2.4). The constant `DEFAULT_ROTATE_SIZE_BYTES` is defined in `packages/sidekick-core/src/structured-logging.ts`.

**Parsing strategy:** Backend (Vite middleware, §4.1) parses NDJSON server-side and serves typed JSON arrays to the frontend. The browser never touches raw log files directly.

**No streaming parser needed:** At 10MB max and ~300–500 bytes/event, worst case is ~33,000 events from a single file. Line-split + `JSON.parse` per line handles this in under 100ms. Streaming parsers add complexity without measurable benefit at this scale.

**Multi-file reconstruction:** For sessions spanning multiple rotated log files, the backend reads all relevant files (up to 5 × 10MB = 50MB) and merges by timestamp (§2.7 log file contract).

### 5.6 Initial Load Time

**Target:** Under 1 second from session selection to fully rendered timeline.

**Budget breakdown** (typical session, ~500 events):

| Phase | Budget |
|---|---|
| Backend file read + NDJSON parse | ~50ms |
| Network transfer (localhost) | ~10ms (negligible, same machine) |
| React render + virtualized list mount | ~100ms |
| Headroom | ~840ms |

**Why this is achievable:** Local dev tool — no network latency, no CDN, no cold starts. Data is on the same filesystem. Budget math suggests actual load times will be well under this target for typical sessions.

**Measurement:** `performance.mark()` / `performance.measure()` at session load boundaries. No external APM required for a local tool.

### 5.7 Memory Budget

**Target:** 256MB maximum browser heap for a single fully-loaded session.

**Budget breakdown** (worst case — session spanning all 5 rotated log files):

| Component | Estimate |
|---|---|
| JSON response payload (backend serves typed arrays, not raw NDJSON) | up to 50MB (5 × 10MB rotation cap) |
| Parsed JS objects (~2–5× serialized size) | 100–250MB |
| React component tree + virtualizer state | ~5MB |
| String interning overhead | ~5MB |

**Context:** Claude Code's default model now uses 1M-token context windows (up from 240K). At ~4 bytes/token, sessions can generate substantially more events than previously expected. A single long-running session may span all 5 rotated log files.

**Eviction policy:** None. The log rotation policy (50MB total per stream) bounds the theoretical maximum. When the user navigates to a different session, the previous session's data is released (single-session model, §5.1).

**Diagnostic threshold:** If `performance.memory.usedJSHeapSize` exceeds 256MB, this indicates a memory leak — not normal operation. Even worst-case hydration should remain under 256MB. Note: this API is Chrome-only (non-standard). Since the target audience uses Chrome DevTools for development, this is acceptable; for non-Chromium browsers, fall back to `performance.measureUserAgentSpecificMemory()` (standards-track, async).

**Why 256MB:** Modern dev machines have 16–64GB RAM. 256MB for a dev tool tab is within normal Chrome tab operating parameters (200–500MB typical).

### 5.8 Performance Targets Summary

| Area | Target | Bound By | Measurement |
|---|---|---|---|
| Virtual scrolling threshold | 200 events | DOM layout performance | Component renders below/above threshold |
| Live mode polling | 1s refetch cycle | UX responsiveness vs CPU | SSE notification → render complete |
| Rendering budget | 16ms/frame (60fps) | Browser refresh rate | React Profiler + `requestAnimationFrame` frame-time sampling (Long Task API is 50ms threshold — too coarse for 16ms detection) |
| Log file ingestion | 10MB/file, 50MB total | Log rotation policy | Backend parse time |
| Initial load time | < 1 second | User perception | `performance.measure()` |
| Memory budget | 256MB browser heap | Log rotation × JS overhead | `performance.memory.usedJSHeapSize` |

### 5.9 Risks and Fallback Strategies

| Risk | Trigger | Fallback |
|---|---|---|
| Event count exceeds virtualizer's practical limit | > 100,000 events in a single session | Unlikely given rotation cap (~50MB / ~500 bytes = ~100K max). If hit, paginate at the API level (§4.5.2 offset pagination) |
| Log parse time exceeds 1s budget | Files approach 50MB total for one session | Backend streams partial results; frontend renders incrementally as chunks arrive |
| Memory exceeds 256MB | Memory leak or unexpectedly large event payloads | Profile with Chrome DevTools; likely cause is retained references, not data volume |
| Live mode causes sustained high CPU | Rapid event bursts (>10 events/sec sustained) | Increase debounce window dynamically; cap refetch rate |

### 5.10 Requirements Traceability

| Requirement | Section | How Addressed |
|---|---|---|
| REQUIREMENTS.md F-9 (live mode) | §5.3 | 1s polling interval with SSE notification coalescing |
| PHASE2-AUDIT §2.4 (log rotation) | §5.5, §5.7 | Rotation caps (10MB/file, 5 files) used as natural performance bounds |
| §4.2 (chokidar file watching) | §5.3 | 50ms stabilization feeds SSE push; frontend debounces at 1s |
| §2.7 (log file contract) | §5.5 | NDJSON format and timestamp-based merge used as ingestion pipeline input |
| sidekick-n4lx epic (1000+ event lag) | §5.2 | Virtual scrolling at 200-event threshold via TanStack Virtual |

## 6. Component-to-Type Wiring

Section 6 maps each v2 prototype React component to its target `@sidekick/types` data source, identifies transformation functions needed, and flags gaps where no canonical type exists yet.

> **Scope**: This section defines the wiring spec. Transformation function implementations belong to the implementation epic (sidekick-43a8b12e).

### 6.1 Component Inventory & Type Mapping

The v2 prototype contains 19 React components organized by panel. Each row identifies the canonical `@sidekick/types` type(s) that will feed the component's props and whether a transformation function is needed to bridge the backend data shape to the component's prop interface.

**Import path conventions:**
- `@sidekick/types` — barrel re-export (types.ts in `packages/sidekick-ui/src/types.ts`, to be replaced by canonical imports)
- `@sidekick/types/events` — `TranscriptLine`, `SidekickEvent`, `LEDState`, `StateSnapshot`, `Session`, `Project`, `TimelineFilter`, `NavigationState`
- `@sidekick/types/services/state` — `SessionStateSnapshot`, `SessionSummaryState`, `SessionPersonaState`, and all 20 state file types (§3.3)

#### Session Selector Panel

| # | Component | Panel | Target Type(s) | Import Path | Transform Needed |
|---|-----------|-------|----------------|-------------|-----------------|
| 1 | `SessionSelector` | Session Selector | `SessionListResponse`, `Session`, `Project` | `@sidekick/types` | Yes |

#### Summary Strip

| # | Component | Panel | Target Type(s) | Import Path | Transform Needed |
|---|-----------|-------|----------------|-------------|-----------------|
| 2 | `SummaryStrip` | Summary Strip | `Session` | `@sidekick/types` | No |

#### Transcript Panel

| # | Component | Panel | Target Type(s) | Import Path | Transform Needed |
|---|-----------|-------|----------------|-------------|-----------------|
| 3 | `Transcript` | Transcript | `TranscriptLine[]`, `Map<string, LEDState>` | `@sidekick/types` | Yes |
| 4 | `TranscriptLineCard` | Transcript | `TranscriptLine` | `@sidekick/types` | Yes |
| 5 | `LEDGutter` | Transcript | `LEDState` | `@sidekick/types` | Yes |
| 6 | `LEDColorKey` | Transcript | _(none — static UI)_ | — | No |
| 7 | `SearchFilterBar` | Transcript | `NavigationState` | `@sidekick/types` | No |

#### Timeline Panel

| # | Component | Panel | Target Type(s) | Import Path | Transform Needed |
|---|-----------|-------|----------------|-------------|-----------------|
| 8 | `Timeline` | Timeline | `SidekickEvent[]`, `TimelineFilter` | `@sidekick/types` | Yes |
| 9 | `TimelineEventItem` | Timeline | `SidekickEvent` | `@sidekick/types` | No |
| 10 | `TimelineFilterBar` | Timeline | `TimelineFilter`, `NavigationState` | `@sidekick/types` | No |

#### Detail Panel

| # | Component | Panel | Target Type(s) | Import Path | Transform Needed |
|---|-----------|-------|----------------|-------------|-----------------|
| 11 | `DetailPanel` | Detail | `TranscriptLine`, `TranscriptLine[]`, `StateSnapshot` | `@sidekick/types` | Yes |
| 12 | `DetailHeader` | Detail | `TranscriptLine` | `@sidekick/types` | No |
| 13 | `ToolDetail` | Detail | `TranscriptLine` | `@sidekick/types` | No |
| 14 | `DecisionDetail` | Detail | `TranscriptLine` | `@sidekick/types` | No |
| 15 | `ReminderDetail` | Detail | `TranscriptLine` | `@sidekick/types` | No |
| 16 | `ErrorDetail` | Detail | `TranscriptLine` | `@sidekick/types` | No |
| 17 | `StateTab` | Detail | `SessionStateSnapshot` (§3.7) | `@sidekick/types` | Yes |

#### Shared / Layout

| # | Component | Panel | Target Type(s) | Import Path | Transform Needed |
|---|-----------|-------|----------------|-------------|-----------------|
| 18 | `PanelHeader` | Shared | _(none — UI-only)_ | — | No |
| 19 | `CompressedLabel` | Shared | _(none — UI-only)_ | — | No |

> **Verification**: 19 components total. Every `.tsx` file under `packages/sidekick-ui/src/components/` (excluding `App.tsx` and `main.tsx`) is represented.

### 6.2 Props Interface Definitions

Each component's props are categorized by alignment with `@sidekick/types`:
- **Aligned** — props already match a canonical type; one-liner reference
- **Needs new interface** — props require a new or modified interface; defined inline
- **Needs type extension** — canonical type exists but is missing fields; references §3.7 and §6.4
- **UI-only** — no backend data dependency; pure presentation

#### UI-Only Components (no backend data)

**CompressedLabel** — UI-only. Props: `{ text: string; onClick?: () => void }`. Pure presentation helper for collapsed panel labels.

**PanelHeader** — UI-only. Props: `{ title: string; expanded: boolean; onToggle: () => void; collapseDirection: 'left' | 'right'; children?: ReactNode }`. Layout chrome with no data dependency.

**LEDColorKey** — UI-only. No props. Static legend for LED indicator colors; all data is hardcoded in the component.

#### Aligned Components (props match canonical types directly)

**SummaryStrip** — Aligned. Props: `{ session: Session }`. The `Session` type from `@sidekick/types` already contains all fields the component reads (`persona`, `intent`, `intentConfidence`, `contextWindowPct`, `taskQueueCount`, `tokenCount`, `costUsd`, `durationSec`, `status`).

**TimelineEventItem** — Aligned. Props: `{ event: SidekickEvent; isSynced: boolean; isDimmed: boolean; onClick: () => void }`. The `SidekickEvent` type matches directly. `isSynced`, `isDimmed`, and `onClick` are UI interaction props derived from `NavigationState`.

**TimelineFilterBar** — Aligned. No external props; reads `NavigationState` via `useNavigation()` hook. Uses `TimelineFilter` type directly.

**SearchFilterBar** — Aligned. No external props; reads `NavigationState` via `useNavigation()` hook. Dispatches `SET_SEARCH` action.

**DetailHeader** — Aligned. Props: `{ line: TranscriptLine; currentIndex: number; totalCount: number; activeTab: 'details' | 'state'; onTabChange: (tab) => void; onPrev: () => void; onNext: () => void; onClose: () => void }`. Uses `TranscriptLine` directly; navigation props are UI-local.

**ToolDetail** — Aligned. Props: `{ line: TranscriptLine }`. Reads `toolName`, `toolDurationMs`, `toolInput` fields directly from `TranscriptLine`.

**DecisionDetail** — Aligned. Props: `{ line: TranscriptLine }`. Reads `decisionCategory`, `decisionReasoning` fields directly from `TranscriptLine`.

**ReminderDetail** — Aligned. Props: `{ line: TranscriptLine }`. Reads `reminderId`, `reminderBlocking`, `content` fields directly from `TranscriptLine`.

**ErrorDetail** — Aligned. Props: `{ line: TranscriptLine }`. Reads `errorMessage`, `errorStack` fields directly from `TranscriptLine`.

#### Components Needing Transformation (props fed by transformation functions)

**SessionSelector** — Needs transformation. Current props: `{ projects: Project[] }`. The backend serves `SessionListResponse` (§3.2), which returns flat `SessionListEntry[]` grouped by project. Transformation T-4 (§6.3) groups entries into `Project[]` with nested `Session[]`.

```typescript
/** Current props — remain unchanged after wiring */
interface SessionSelectorProps {
  projects: Project[]  // populated by T-4 from SessionListResponse (§3.2)
}
```

**Transcript** — Needs transformation. Current props: `{ lines: TranscriptLine[]; ledStates: Map<string, LEDState>; scrollToLineId: string | null }`. `TranscriptLine[]` is populated by T-1 (log parsing). `ledStates` is populated by T-2 (LED assembly).

**TranscriptLineCard** — Needs transformation. Props: `{ line: TranscriptLine; isSelected: boolean; isSynced: boolean; onClick: () => void }`. The `TranscriptLine` is produced by T-1; UI interaction props derive from `NavigationState`.

**LEDGutter** — Needs transformation. Props: `{ ledState: LEDState }`. The `LEDState` for each transcript line is assembled by T-2 from multiple state file sources.

**Timeline** — Needs transformation. Props: `{ events: SidekickEvent[] }`. `SidekickEvent[]` is derived by T-3 from canonical log events.

**DetailPanel** — Needs transformation. Props: `{ line: TranscriptLine; lines: TranscriptLine[]; stateSnapshots: StateSnapshot[] }`. `TranscriptLine[]` from T-1; `StateSnapshot[]` from T-5.

**StateTab** — Needs type extension. Props: `{ snapshots: StateSnapshot[]; currentTimestamp: number }`. The current `StateSnapshot` uses `Record<string, unknown>` for state fields. Must be replaced with `SessionStateSnapshot` from `@sidekick/types` (§3.7) once the canonical type is extended with the 8 missing fields.

```typescript
/** Updated props after canonical type extension (§3.7) */
interface StateTabProps {
  snapshots: SessionStateSnapshot[]  // replaces local StateSnapshot
  currentTimestamp: number
}
```

### 6.3 Transformation Functions

Every component marked "Transform Needed: Yes" in §6.1 requires a function to convert backend data shapes into component props. This section defines signatures and logic; implementations belong to the implementation epic.

#### T-1: Log Stream → Transcript Lines

```typescript
function parseLogToTranscriptLines(
  cliRecords: PinoLogRecord[],
  daemonRecords: PinoLogRecord[]
): TranscriptLine[]
```

**Input**: `PinoLogRecord[]` from `LogStreamResponse` (§3.4), one array per log source (`cli.log` + `sidekickd.log`).

**Output**: `TranscriptLine[]` consumed by `Transcript`, `TranscriptLineCard`, `DetailPanel`.

**Logic**: Merge records from both sources by `time` field (Unix ms). For each record, inspect the `type` field: records matching a `UIEventType` value (§2.4) map to the corresponding `TranscriptLineType`; records without a canonical type (plain Pino log lines) are filtered out of the transcript view. Conversation-level events (`user-message`, `assistant-message`, `tool-use`, `tool-result`, `compaction`) are derived from transcript event log entries (§2.4 #29). Each canonical event's payload fields are mapped to `TranscriptLine` properties — for example, `reminder:staged` payload's `reminderName` maps to `TranscriptLine.reminderId` and `blocking` maps to `TranscriptLine.reminderBlocking`.

**Consumers**: `Transcript` (#3), `TranscriptLineCard` (#4), `DetailPanel` (#11)

**Contracts**: Input defined by §3.4 (`LogStreamResponse`); output defined by `TranscriptLine` in `@sidekick/types`.

#### T-2: State Files → LED State per Transcript Line

```typescript
function assembleLEDStates(
  lines: TranscriptLine[],
  stagedReminders: StagedRemindersSnapshot,
  summaryState: SessionSummaryState | null,
  verificationTools: VerificationToolsState | null
): Map<string, LEDState>
```

**Input**: Transcript lines (from T-1), staged reminders (§3.5), session summary state (§3.3 #1), and verification tools state (§3.3 #11).

**Output**: `Map<string, LEDState>` keyed by transcript line ID, consumed by `LEDGutter`.

**Logic**: For each transcript line, compute a point-in-time LED snapshot. The six boolean LEDs (`vcBuild`, `vcTypecheck`, `vcTest`, `vcLint`, `verifyCompletion`, `pauseAndReflect`) are derived from which verification-check reminders are currently staged at that point in the transcript. When a `reminder:staged` event appears with a `reminderName` matching a VC category, the corresponding LED lights up. When a `reminder:consumed` or `reminder:unstaged` event appears, it turns off. The `titleConfidence` and `titleConfidencePct` fields derive from the most recent `session-summary:finish` event's confidence value at or before each line's timestamp.

**Consumers**: `LEDGutter` (#5), `Transcript` (#3)

**Contracts**: Input: `StagedRemindersSnapshot` (§3.5), `SessionSummaryState` (§3.3 #1), `VerificationToolsState` (§3.3 #11); output: `LEDState` from `@sidekick/types`.

#### T-3: Log Events → Timeline Events

```typescript
function deriveTimelineEvents(
  lines: TranscriptLine[]
): SidekickEvent[]
```

**Input**: `TranscriptLine[]` from T-1 (already merged and sorted).

**Output**: `SidekickEvent[]` consumed by `Timeline`, `TimelineEventItem`.

**Logic**: Filter transcript lines to only those whose `type` is a `SidekickEventType` (the 16 Sidekick-specific event types from §2.4 #1-#16 — excludes conversation events like `user-message`, `tool-use`, etc.). For each matching line, construct a `SidekickEvent` with: `id` = line's id, `timestamp` = line's timestamp, `type` = line's type (narrowed to `SidekickEventType`), `label` = human-readable summary derived from the event type and payload (same logic as `DetailHeader.getLineLabel()`), `detail` = optional extra detail string, `transcriptLineId` = line's id (for scroll-sync from timeline to transcript).

**Consumers**: `Timeline` (#8), `TimelineEventItem` (#9)

**Contracts**: Input: `TranscriptLine` from `@sidekick/types`; output: `SidekickEvent` from `@sidekick/types`. Filter categories defined by `SIDEKICK_EVENT_TO_FILTER` mapping.

#### T-4: Session List → Project Groups

```typescript
function groupSessionsByProject(
  response: SessionListResponse,
  sessionStates: Map<string, SessionStateSnapshot>
): Project[]
```

**Input**: `SessionListResponse` (§3.2) providing the flat session list, plus a map of per-session state snapshots for metadata enrichment.

**Output**: `Project[]` consumed by `SessionSelector`.

**Logic**: Group `SessionListEntry` items by project ID (derived from the session directory's parent). For each session, build a `Session` object by combining `SessionListEntry` metadata (id, path, lastModified) with enrichment data from `SessionStateSnapshot` (title from `summary.session_title`, persona from `sessionPersona.persona_id`, intent from `summary.latest_intent`, confidence scores, token counts, etc.). Sessions without state are assigned default values. Group sessions into `Project` objects with name derived from the project directory basename. Sort sessions within each project by `lastModified` descending (most recent first).

**Consumers**: `SessionSelector` (#1), `SummaryStrip` (#2, via selected `Session`)

**Contracts**: Input: `SessionListResponse` (§3.2), `SessionStateSnapshot` (§3.7); output: `Project`, `Session` from `@sidekick/types`.

#### T-5: State Files → State Tab Snapshots

```typescript
function assembleStateSnapshots(
  stateResponses: Map<string, StateFileResponse<unknown>>,
  sessionId: string
): SessionStateSnapshot[]
```

**Input**: Individual `StateFileResponse<T>` results (§3.3) for each of the 20 state file types, keyed by filename.

**Output**: `SessionStateSnapshot[]` consumed by `StateTab`, `DetailPanel`.

**Logic**: Assemble a `SessionStateSnapshot` by reading each `StateFileResponse<T>.data` value and assigning it to the corresponding field on the snapshot. The snapshot timestamp is the maximum `fileMtime` across all constituent files. If the SSE push (§4.3) delivers a file change notification, the affected field is updated in the existing snapshot and a new snapshot is appended with the updated timestamp, preserving historical snapshots for time-travel (§5.2). The `StateTab` component's `findSnapshotAtTime()` helper then selects the appropriate snapshot for a given transcript line timestamp. The 7 state files currently shown in `STATE_FILE_LABELS` map (`sessionSummary`, `sessionPersona`, `snarkyMessage`, `resumeMessage`, `transcriptMetrics`, `llmMetrics`, `summaryCountdown`) expand to all 20 state file types (§3.3) after the canonical type extension (§3.7).

**Consumers**: `StateTab` (#17), `DetailPanel` (#11)

**Contracts**: Input: `StateFileResponse<T>` (§3.3); output: `SessionStateSnapshot` (§3.7, extended).

#### T-6: Log Events → Detail Component Props

```typescript
function extractDetailProps(
  line: TranscriptLine
): Record<string, unknown>
```

**Input**: A single `TranscriptLine` from T-1.

**Output**: Typed props object consumed by the appropriate detail sub-component (`ToolDetail`, `DecisionDetail`, `ReminderDetail`, `ErrorDetail`).

**Logic**: This is a thin pass-through — the `TranscriptLine` interface already carries all fields needed by each detail component as optional properties. The `DetailPanel.DetailContent` switch dispatches to the correct sub-component based on `line.type`. No data transformation is needed beyond the existing `TranscriptLine` field extraction. This entry exists for completeness: the transformation is the identity function on the `TranscriptLine` type, and the detail sub-components read fields directly. If future detail components need data beyond what `TranscriptLine` carries (e.g., linked state snapshots or cross-referenced events), T-6 would be extended to accept additional data sources.

**Consumers**: `DetailPanel` (#11), `ToolDetail` (#13), `DecisionDetail` (#14), `ReminderDetail` (#15), `ErrorDetail` (#16)

**Contracts**: Input/output: `TranscriptLine` from `@sidekick/types`.

## 7. New Feature Integration
This section specifies the UI integration for each new feature identified in PHASE2-AUDIT §3.3. Features are organized by tier (critical gaps → important enhancements → future work). Each Tier 1 and Tier 2 feature defines its data source, component placement, interaction pattern, and backend readiness.

**Layout reference:** The four-panel layout from REQUIREMENTS.md §3:
1. **Session selector** — left panel, project/session navigation
2. **Timeline** — chronological event spine (REQUIREMENTS.md F-3, DP-1)
3. **Transcript** — chat bubble view, time-synced (REQUIREMENTS.md F-4, DP-2)
4. **Detail panel** — right panel, progressive drill-down (REQUIREMENTS.md DP-4)

### 7.1 Tier 1: Critical Gaps

#### 7.1.1 LLM Call Timeline (F-10)

**Requirement**: REQUIREMENTS.md G-3 (Provider/Telemetry), PHASE2-AUDIT §3.2 item 1

LLM calls are the most expensive and opaque operations in a session. Surfacing them as first-class timeline events with cost, latency, and token data gives the developer immediate visibility into provider behavior.

**Data sources:**

| Source | Path | Type | Status |
|--------|------|------|--------|
| LLM metrics state | `sessions/{id}/state/llm-metrics.json` | `LLMMetricsState` (§3.3 #15) | Schema defined, **file not written** |
| Provider base class logs | `.sidekick/logs/sidekickd.log` | Unstructured Pino records | Logs exist but not structured events |

**Why `LLMMetricsState` alone is insufficient:** The state file provides aggregate per-provider/per-model metrics (total calls, latency percentiles, token sums) but not individual call records. The UI needs per-call timeline events to support drill-in. This requires new structured events.

**New canonical events required:**

```typescript
/** Emitted by the provider base class when an LLM call begins. */
// Canonical name: 'llm:call-start'
// Visibility: 'timeline'
// Emitter: daemon
interface LLMCallStartPayload {
  callId: string            // Unique identifier for this call
  provider: string          // e.g., 'anthropic', 'openai'
  model: string             // e.g., 'claude-sonnet-4-20250514'
  purpose: string           // e.g., 'session-summary', 'snarky-message', 'resume-message', 'completion-classification'
  inputTokens?: number      // Estimated input tokens (if known before call)
}

/** Emitted by the provider base class when an LLM call completes. */
// Canonical name: 'llm:call-finish'
// Visibility: 'timeline'
// Emitter: daemon
interface LLMCallFinishPayload {
  callId: string
  provider: string
  model: string
  purpose: string
  success: boolean
  durationMs: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
  costUsd?: number          // Calculated from token counts + model pricing
  retryCount: number        // 0 if no retries
  error?: string            // Present when success=false
}
```

**Component placement:**

| Panel | Rendering |
|-------|-----------|
| **Timeline** | LLM call events appear as timeline entries with a distinctive icon (chip/sparkle). Start/finish pairs render as a duration span. Color-coded by purpose (summary=blue, snarky=purple, resume=green, classification=amber). Cost displayed inline when available. |
| **Detail panel** | Drill-in shows full call details: provider, model, token breakdown (input/output), latency, cost, retry history, error details. If the call was for session-summary, links to the corresponding `session-summary:finish` event. |
| **Session selector** | No representation — LLM calls are session-level detail. |
| **Transcript** | No direct representation — LLM calls are sidekick-internal, not part of the Claude Code transcript. |

**Interaction pattern:**
1. User sees LLM call events interleaved in the timeline (DP-1)
2. Focus filter (REQUIREMENTS.md DP-3) "LLM Calls" highlights only `llm:call-start`/`llm:call-finish` pairs
3. Clicking a call event opens the detail panel with full call metadata
4. Duration spans visually connect start/finish pairs, making slow calls immediately visible

**Backend readiness: 95% → 60% (revised)**

The readiness score in PHASE2-AUDIT §3.3 assumed the existing provider base class logging was sufficient. It is not — structured events must be added. The `LLMMetricsState` schema and provider infrastructure exist, but the daemon does not:
- Write `llm-metrics.json` (no task/handler for it)
- Emit structured LLM call events (only unstructured Pino logs)
- Track per-call cost or retry counts
- Expose an LLM call tracking service

See §7.4 (Prerequisite Tasks) items P-1 through P-4.

#### 7.1.2 Task Queue Detail Panel (G-2 enhancement)

**Requirement**: REQUIREMENTS.md G-2 (Task Engine), PHASE2-AUDIT §3.3 item 2

The task engine orchestrates all background work (summary generation, resume messages, cleanup, metrics persistence). The UI needs visibility into what's queued, what's running, and what failed.

**Data sources:**

| Source | Path | Type | Status |
|--------|------|------|--------|
| Task registry state | `.sidekick/state/task-registry.json` | `TaskRegistryState` (§3.3 #19) | Written on startup, shutdown, and orphan cleanup — but **not** on each enqueue/complete |
| Daemon status | `.sidekick/state/daemon-status.json` | `DaemonStatus` (§3.3 #16) | Written every 5s, includes `queue` and `activeTasks` |

**Why two sources:** `DaemonStatus.activeTasks` provides a real-time snapshot of currently running tasks (updated every 5s via heartbeat). `TaskRegistryState` provides the registry of known task types but is only written on startup, shutdown, and orphan cleanup — it lacks per-enqueue/per-complete updates, runtime queue metrics, and task history.

**New canonical events required:**

```typescript
/** Emitted when a task is enqueued. */
// Canonical name: 'task:queued'
// Visibility: 'both'
// Emitter: daemon
interface TaskQueuedPayload {
  taskId: string
  taskType: TaskType            // 'session_summary' | 'resume_generation' | 'cleanup' | 'metrics_persist' (from @sidekick/types)
  sessionId?: string        // Present for session-scoped tasks
  priority: number
}

/** Emitted when a task begins execution. */
// Canonical name: 'task:started'
// Visibility: 'log'
// Emitter: daemon
interface TaskStartedPayload {
  taskId: string
  taskType: string
  sessionId?: string
}

/** Emitted when a task completes successfully. */
// Canonical name: 'task:completed'
// Visibility: 'both'
// Emitter: daemon
interface TaskCompletedPayload {
  taskId: string
  taskType: string
  sessionId?: string
  durationMs: number
}

/** Emitted when a task fails. */
// Canonical name: 'task:failed'
// Visibility: 'both'
// Emitter: daemon
interface TaskFailedPayload {
  taskId: string
  taskType: string
  sessionId?: string
  durationMs: number
  error: string
  retryable: boolean
}
```

> **Note:** These events were already identified as missing in PHASE2-AUDIT §2.7 ("DAEMON.md S4.5 — Not implemented").

**Component placement:**

| Panel | Rendering |
|-------|-----------|
| **Session selector** | Global task queue count badge at the project level (derived from `DaemonStatus.queue.pending + DaemonStatus.queue.active`). **Note:** `DaemonStatus.queue` is daemon-global, not per-session. Per-session task counts become available once `task:queued` events (P-5) are implemented — at that point, the badge can filter by `sessionId` for per-session display. |
| **Timeline** | `task:queued` and `task:completed`/`task:failed` events appear as timeline entries. Duration spans connect queued→completed pairs. Failed tasks render with error styling (red). |
| **Detail panel** | Task detail view shows: task type, session, priority, duration, error details (if failed). Lists all tasks for the session with sortable columns. |
| **Transcript** | No direct representation. |

**Interaction pattern:**
1. Session selector shows a badge with active+pending task count (summary indicator per REQUIREMENTS.md DP-4)
2. Timeline shows task lifecycle events interleaved with other events
3. Focus filter "Tasks" highlights task events
4. Clicking a task event opens the detail panel with full task metadata
5. Detail panel provides a task list view: all tasks for this session, sortable by type/status/time

**Backend readiness: 90% → 70% (revised)**

The task engine infrastructure is solid (`TrackedTask`, `TaskRegistryState`, abort controllers, running counter). However:
- `task-registry.json` is only written on startup/shutdown, not on each enqueue/complete
- No `task:queued`/`task:started`/`task:completed`/`task:failed` events emitted
- No persistent task history (completed tasks are lost on daemon restart)

See §7.4 items P-5 through P-7.

#### 7.1.3 Completion Classifier Detail (G-11)

**Requirement**: PHASE2-AUDIT §3.2 item 2, relates to REQUIREMENTS.md G-6 (Reminder System)

The completion classifier determines whether the LLM's response indicates task completion, triggering the verify-completion reminder. Misclassification is the most common user-reported issue with sidekick reminders. Surfacing the classifier's reasoning makes debugging straightforward.

**Data sources:**

| Source | Path | Type | Status |
|--------|------|------|--------|
| Classifier implementation | `packages/feature-reminders/src/completion-classifier.ts` | Runtime only | Classification runs but emits no events |
| Classifier result type | `packages/types/` | `CompletionClassification` | Type defined: `{ category, confidence, reasoning }` |
| Confidence settings | Config | `confidence_threshold`, LLM profiles | Available at runtime |

**New canonical event required:**

```typescript
/** Emitted after the completion classifier runs. */
// Canonical name: 'classifier:completion-result'
// Visibility: 'timeline'
// Emitter: daemon
interface CompletionClassifierResultPayload {
  sessionId: string
  category: 'CLAIMING_COMPLETION' | 'ASKING_QUESTION' | 'ANSWERING_QUESTION' | 'OTHER'
  confidence: number         // 0-1
  reasoning: string          // LLM's explanation
  thresholdUsed: number      // confidence_threshold from config
  thresholdMet: boolean      // confidence >= thresholdUsed
  reminderTriggered: boolean // Whether verify-completion reminder was staged as a result
  durationMs: number         // Classification LLM call duration
  model: string              // Which model performed classification
}
```

**Component placement:**

| Panel | Rendering |
|-------|-----------|
| **Timeline** | Classification events appear after the assistant message that triggered them. Icon indicates category (checkmark for CLAIMING_COMPLETION, question mark for ASKING_QUESTION, etc.). Confidence displayed as a percentage badge with color coding (green >=0.8, amber 0.5-0.8, red <0.5). |
| **Detail panel** | Full classifier output: category, confidence (with threshold comparison), reasoning text, whether the reminder fired, model used, latency. Links to the assistant message that was classified and the resulting `reminder:staged` event (if any). |
| **Transcript** | Subtle indicator on the assistant message that was classified — a small badge showing the classification category. Clicking opens the detail panel. |
| **Session selector** | No representation. |

**Interaction pattern:**
1. User sees classification events on the timeline after assistant messages
2. Confidence badge provides at-a-glance signal quality (DP-5)
3. Clicking opens detail panel with full reasoning
4. From the detail panel, user can navigate to the triggering assistant message in the transcript (DP-2) and to the resulting reminder event (if staged)

**Backend readiness: 85% → 65% (revised)**

The classifier exists and produces `CompletionClassification` results, but:
- No `classifier:completion-result` event is emitted
- No persistent classification history
- No accuracy metrics or false-positive tracking

See §7.4 items P-8 and P-9.

#### 7.1.4 System Health Dashboard (F-7)

**Requirement**: REQUIREMENTS.md F-7 (System Health Dashboard), G-9 (Daemon Health)

A persistent panel showing daemon vitals: uptime, memory, queue depth, online/offline status. This is the only feature that renders at the project level (not session level) since the daemon serves all sessions.

**Data sources:**

| Source | Path | Type | Status |
|--------|------|------|--------|
| Daemon status heartbeat | `.sidekick/state/daemon-status.json` | `DaemonStatus` (§3.3 #16) | **Written every 5s** — fully operational |
| Global log metrics | `.sidekick/state/daemon-global-log-metrics.json` | `LogMetricsState` (§3.3 #20) | Written on warn/error/fatal |
| Task registry | `.sidekick/state/task-registry.json` | `TaskRegistryState` (§3.3 #19) | Written on startup/shutdown |

**Component placement:**

| Panel | Rendering |
|-------|-----------|
| **Session selector** | Daemon status indicator (green dot = online, red dot = offline) at the project level, above the session list. Compact: shows uptime and memory in a single line. |
| **Timeline** | `daemon:started`, `daemon:starting` events appear when scrubbing. Offline periods render as a gap/shading on the timeline. |
| **Detail panel** | Full health dashboard: memory sparklines (heap/RSS over time, derived from heartbeat history), queue depth chart, active task list, error/warning counts from `LogMetricsState`, restart history (derived from `daemon:started` events in log). |
| **Transcript** | No representation. |

**Why sparklines from heartbeat history:** The daemon writes `daemon-status.json` every 5s with current memory metrics. The backend accumulates these snapshots over the session lifetime to produce a time series. No additional daemon instrumentation needed for the basic memory chart.

**Interaction pattern:**
1. Daemon status indicator is always visible in the session selector (project level)
2. Clicking the indicator opens the full health dashboard in the detail panel
3. Health dashboard auto-refreshes via SSE (file watcher on `daemon-status.json`)
4. Offline detection: if `daemon-status.json` mtime exceeds 30s (REQUIREMENTS.md F-7), the indicator turns red and the dashboard shows "Daemon offline since {timestamp}"

**Backend readiness: 80% (confirmed)**

The `DaemonStatus` heartbeat provides the core data. Missing elements are nice-to-have for Tier 2:
- No CPU usage tracking
- No event queue size/lag metrics
- No handler execution time histograms
- No error rate calculation (available via `LogMetricsState` but not aggregated over time)
- No IPC health metrics
- No restart history (derivable from log events)

See §7.4 items P-10 and P-11.

### 7.2 Tier 2: Important Enhancements

#### 7.2.1 Context Window Bar (G-7 enhancement)

**Requirement**: REQUIREMENTS.md G-7 (Transcript Metrics), PHASE2-AUDIT §3.2 item 3

A visual bar showing how much of Claude Code's context window is consumed by sidekick overhead (system prompt tokens, MCP tools, memory files, agents, auto-compact buffer). Critical for understanding when sessions approach context limits.

**Data sources:**

| Source | Path | Type | Status |
|--------|------|------|--------|
| User-level baseline | `~/.sidekick/state/baseline-user-context-token-metrics.json` | `BaseTokenMetricsState` (§3.3 #17) | Written on context capture |
| Project-level metrics | `.sidekick/state/baseline-project-context-token-metrics.json` | `ProjectContextMetrics` (§3.3 #18) | Written on project analysis |
| Session-level metrics | `sessions/{id}/state/context-metrics.json` | `SessionContextMetrics` (§3.3 #14) | Written on context analysis |

**Component placement:**

| Panel | Rendering |
|-------|-----------|
| **Session selector** | Context usage percentage badge on each session entry (e.g., "67%"). |
| **Timeline** | Not directly on the timeline. Context metrics update on session events, not as discrete events. |
| **Detail panel** | Stacked bar chart showing context breakdown: system prompt, tools, memory files, agents, auto-compact buffer, remaining capacity. Three layers (user → project → session) shown as nested bars. |
| **Transcript** | Subtle context percentage indicator in the transcript header area. |

**Interaction pattern:**
1. Session entry shows context usage percentage
2. Clicking opens the detail panel with full context breakdown
3. Bar chart segments are labeled with token counts and percentages
4. Three-level comparison: user baseline vs project vs session overhead

**Backend readiness: 90% (confirmed)**

The three-level `ContextMetricsService` is fully implemented. Missing:
- No per-turn context usage tracking (would require new events)
- No growth timeline (would require accumulating snapshots)
- No compact-impact metrics (before/after context size on compaction)

These are Tier 3 enhancements — the current static snapshot is sufficient for Tier 2.

#### 7.2.2 Log Detail Viewer (G-8 enhancement)

**Requirement**: REQUIREMENTS.md G-8 (Structured Logging), PHASE2-AUDIT §4.1 Option C

A dedicated log viewer panel showing daemon and CLI log records. Time-correlated with the timeline per DP-2 — scrolling the log viewer syncs the timeline and transcript, and vice versa.

**Data sources:**

| Source | Path | Type | Status |
|--------|------|------|--------|
| CLI log | `.sidekick/logs/cli.log` | NDJSON (Pino) | Fully operational |
| Daemon log | `.sidekick/logs/sidekickd.log` | NDJSON (Pino) | Fully operational |
| Transcript events log | `.sidekick/logs/transcript-events.log` | NDJSON (Pino) | Fully operational — **not yet exposed via `LogStreamRequest`** (§3.4 only supports `cli` and `daemon`; requires API contract extension to add `transcript` log type) |
| Log metrics | `sessions/{id}/state/daemon-log-metrics.json` | `LogMetricsState` (§3.3 #6) | Written on warn/error/fatal |

**Component placement:**

| Panel | Rendering |
|-------|-----------|
| **Detail panel** | Full log viewer with filters: log level (trace→fatal), source (cli/daemon — transcript logs require §3.4 API extension), session ID, text search. Records rendered as a virtual-scrolled table with timestamp, level (color-coded), source, message, and expandable payload. |
| **Timeline** | `error:occurred` and `statusline:error` events appear on the timeline (visibility `both`). Other log events are log-panel-only (visibility `log`). |
| **Session selector** | Error/warning count badge (from `LogMetricsState`). |
| **Transcript** | No representation. |

**Interaction pattern:**
1. Log viewer opens as a detail panel (accessible from a toolbar button or keyboard shortcut)
2. Level filter defaults to `info` and above (hides trace/debug)
3. Scrolling the log viewer updates the timeline cursor position (DP-2)
4. Clicking a timeline event scrolls the log viewer to the corresponding timestamp
5. Error records are highlighted and expandable to show stack traces

**Backend readiness: 85% (confirmed)**

Log files exist and are well-structured NDJSON. The `LogStreamResponse` API (§3.4) with offset pagination handles incremental reads. Missing:
- No server-side search/filter (client-side filtering is acceptable for Tier 2 given log file size limits of 10MB)
- No performance histogram aggregation

#### 7.2.3 Compaction Snapshot Viewer (F-1 enhancement)

**Requirement**: REQUIREMENTS.md F-1 (Compaction-Aware Time Travel)

View pre-compaction transcript snapshots to understand what context was lost during auto-compaction. The compaction history provides the timeline; snapshots provide the content.

**Data sources:**

| Source | Path | Type | Status |
|--------|------|------|--------|
| Compaction history | `sessions/{id}/state/compaction-history.json` | `CompactionHistoryState` (§3.3 #13) | Written on compaction events |
| Pre-compact snapshots | Path referenced by `CompactionHistoryState.entries[].transcriptSnapshotPath` | Raw transcript text | Saved to disk on compaction |
| Compaction metrics | Within `CompactionHistoryState.entries[].metricsAtCompaction` | Inline metrics | Available per entry |

**Component placement:**

| Panel | Rendering |
|-------|-----------|
| **Timeline** | Compaction boundaries marked with scissors icon (already specified in REQUIREMENTS.md F-1). Clicking opens the snapshot viewer. |
| **Detail panel** | Snapshot viewer: shows the pre-compact transcript content alongside post-compact metrics. Diff view comparing what was compacted away vs what was retained. Metrics: token counts before/after, lines removed, compaction reason. |
| **Session selector** | Compaction count badge on session entries (number of compaction points). |
| **Transcript** | Compaction markers between transcript segments. Segment navigation at compaction boundaries. |

**Interaction pattern:**
1. Scissors icons on the timeline mark compaction boundaries
2. Clicking a scissors icon opens the snapshot viewer in the detail panel
3. Snapshot viewer shows the full pre-compact transcript as read-only text
4. Toggle between "full snapshot" and "diff" view (what was removed)
5. Metrics sidebar shows token counts, line counts, and compaction reason

**Backend readiness: 85% (confirmed)**

All data is available on disk. The deferred endpoint `GET /api/projects/:projectId/sessions/:sessionId/pre-compact/:timestamp` (§3.8, §4.5.2 Tier 3) must be implemented to serve snapshot files. No new daemon instrumentation required.

#### 7.2.4 Confidence Visualization (G-5 enhancement)

**Requirement**: REQUIREMENTS.md G-5 (Session Summary Enhancements), DP-5 (Confidence as Visual Signal)

Display session summary confidence directly on timeline events. Confidence scores (0-1) for both `session_title_confidence` and `latest_intent_confidence` are already emitted in `session-summary:finish` events.

**Data sources:**

| Source | Path | Type | Status |
|--------|------|------|--------|
| Session summary state | `sessions/{id}/state/session-summary.json` | `SessionSummaryState` (§3.3 #1) | Includes `session_title_confidence`, `latest_intent_confidence` |
| Summary finish events | `.sidekick/logs/sidekickd.log` | `session-summary:finish` (§2.4 #7) | Includes confidence in payload |
| Resume message state | `sessions/{id}/state/resume-message.json` | `ResumeMessageState` (§3.3 #8) | Gates on `min_confidence` |

**Component placement:**

| Panel | Rendering |
|-------|-----------|
| **Timeline** | `session-summary:finish` events show a confidence indicator: color-coded badge (green >=0.8, amber 0.5-0.8, red <0.5). Both title and intent confidence displayed as a dual badge (e.g., "T:0.92 I:0.75"). |
| **Detail panel** | Summary detail view shows full confidence data: title confidence, intent confidence, key phrases, pivot detection flag, processing time. Visual comparison of title/intent confidence against the `min_confidence` threshold used by the resume system. |
| **Session selector** | Current session title with confidence indicator (from latest `SessionSummaryState`). |
| **Transcript** | No representation — confidence is a sidekick-internal metric. |

**Interaction pattern:**
1. Confidence badges on timeline events provide at-a-glance quality signal (DP-5)
2. Low-confidence events are visually distinct (amber/red), drawing attention to potentially unreliable summaries
3. Clicking a summary event opens the detail panel with full confidence breakdown
4. Detail panel shows whether confidence was sufficient to trigger resume message generation

**Backend readiness: 95% (confirmed)**

All data exists. `SessionSummaryState` includes both confidence scores. `session-summary:finish` events (once implemented per §2.4) carry confidence in the payload. No new instrumentation needed — this is purely a UI rendering task.

Missing for future work:
- No confidence history/timeline (would require accumulating per-summary confidence values)
- No confidence decay tracking over session lifetime

### 7.3 Tier 3: Future Work

| Feature | Scope | Priority | Blocker |
|---------|-------|----------|---------|
| **Config Cascade Inspector** (G-4) | Inspector showing resolved config with layer attribution (which of 7 config layers each value came from). Requires config cascade resolution API. | P4 | Config resolution not exposed as API; tracked as `sidekick-dqw5` |
| **Persona Profile Browser** (G-1 enhancement) | Browse all 20 persona definitions with trait details, voice samples, and personality profiles. Force persona change on active session (requires UI write capability — see REQUIREMENTS.md §7 non-goal). | P3 | Read-only constraint blocks write operations; persona YAML assets accessible but no in-session change API |
| **Live Mode Auto-Follow** (F-9) | Auto-scroll timeline and transcript as new events arrive in real-time. Requires SSE push (§4.2.4) and efficient DOM update strategy for high-frequency events. | Post-Tier-1 | SSE infrastructure from §4.2.4 is prerequisite; interaction design TBD (pause/resume, scroll-to-bottom behavior) |

### 7.4 Prerequisite Tasks: Missing Backend Instrumentation

All Tier 1 features and some Tier 2 features depend on backend changes. This table consolidates every missing instrumentation item. Each row becomes a separate implementation bead.

| ID | Feature | Prerequisite | Package | Complexity | Blocks |
|----|---------|-------------|---------|------------|--------|
| **P-1** | F-10 | Emit `llm:call-start` and `llm:call-finish` canonical events from provider base class | `@sidekick/shared-providers` | Medium | F-10 timeline rendering |
| **P-2** | F-10 | Create LLM call tracking service that writes `llm-metrics.json` | `@sidekick/sidekick-daemon` | Medium | F-10 aggregate metrics |
| **P-3** | F-10 | Add cost calculation based on model pricing tables | `@sidekick/shared-providers` | Low | F-10 cost display (optional — can ship without) |
| **P-4** | F-10 | Add retry tracking to provider base class | `@sidekick/shared-providers` | Low | F-10 retry count display |
| **P-5** | G-2 | Emit `task:queued`, `task:started`, `task:completed`, `task:failed` events from task engine | `@sidekick/sidekick-daemon` | Low | G-2 timeline events |
| **P-6** | G-2 | Write `task-registry.json` on each enqueue/complete (not just startup/shutdown) | `@sidekick/sidekick-daemon` | Low | G-2 real-time state |
| **P-7** | G-2 | Add persistent task history (completed tasks survive daemon restart) | `@sidekick/sidekick-daemon` | Medium | G-2 history view |
| **P-8** | G-11 | Emit `classifier:completion-result` event from completion classifier | `@sidekick/feature-reminders` | Low | G-11 timeline rendering |
| **P-9** | G-11 | Add persistent classification history (accumulate results in state file) | `@sidekick/feature-reminders` | Medium | G-11 history view |
| **P-10** | F-7 | Accumulate daemon heartbeat snapshots for memory sparkline time series | `@sidekick/sidekick-ui` (backend) | Low | F-7 sparklines |
| **P-11** | F-7 | Derive restart history from `daemon:started` events in log | `@sidekick/sidekick-ui` (backend) | Low | F-7 restart timeline |
| **P-12** | F-1 | Implement `GET /api/projects/:projectId/sessions/:sessionId/pre-compact/:timestamp` endpoint (§3.8) | `@sidekick/sidekick-ui` (backend) | Low | F-1 snapshot viewer |

**Dependency graph:**

```
P-1 ──┐
P-2 ──┼──► F-10 (LLM Call Timeline)
P-3 ──┤    (P-3, P-4 optional for MVP)
P-4 ──┘

P-5 ──┐
P-6 ──┼──► G-2 (Task Queue Detail)
P-7 ──┘    (P-7 optional for MVP)

P-8 ──┬──► G-11 (Completion Classifier Detail)
P-9 ──┘    (P-9 optional for MVP)

P-10 ─┬──► F-7 (System Health Dashboard)
P-11 ─┘    (both optional — basic dashboard works from DaemonStatus alone)

P-12 ────► F-1 (Compaction Snapshot Viewer)
```

### 7.5 New Canonical Events Summary

Events introduced by this section that must be added to the canonical event table (§2.4):

| # | Canonical Name | Visibility | Emitter | Category | Feature |
|---|---------------|------------|---------|----------|---------|
| 32 | `llm:call-start` | `timeline` | daemon | Provider/Telemetry | F-10 |
| 33 | `llm:call-finish` | `timeline` | daemon | Provider/Telemetry | F-10 |
| 34 | `task:queued` | `both` | daemon | Task Engine | G-2 |
| 35 | `task:started` | `log` | daemon | Task Engine | G-2 |
| 36 | `task:completed` | `both` | daemon | Task Engine | G-2 |
| 37 | `task:failed` | `both` | daemon | Task Engine | G-2 |
| 38 | `classifier:completion-result` | `timeline` | daemon | Reminder System | G-11 |

> **Note:** These events follow the `category:action` naming convention established in §2.2. When the prerequisite tasks (§7.4) are implemented, the following spec updates are required:
> - Add events #32–#38 to the canonical event table in §2.4
> - Add three new categories to the §2.2 categories list: `llm`, `task`, `classifier`
> - Add corresponding types to the `UIEventType` union in `@sidekick/types`
>
> These updates are **not included in this section** — they belong to the §2 (Unified Event Contract) scope and should be applied when the prerequisite tasks land.

### 7.6 Requirements Traceability

| Requirement | Feature | Section | How Addressed |
|-------------|---------|---------|---------------|
| REQUIREMENTS.md G-3 (Provider/Telemetry) | F-10 | §7.1.1 | LLM calls as timeline events with drill-in detail panel |
| REQUIREMENTS.md G-2 (Task Engine) | G-2 enhancement | §7.1.2 | Task queue badge + timeline events + task list detail panel |
| REQUIREMENTS.md G-6 (Reminder System) | G-11 | §7.1.3 | Classifier result events on timeline with reasoning detail |
| REQUIREMENTS.md F-7 (System Health) | F-7 | §7.1.4 | Daemon status indicator + health dashboard detail panel |
| REQUIREMENTS.md G-9 (Daemon Health) | F-7 | §7.1.4 | Memory sparklines, restart history, error counts |
| REQUIREMENTS.md G-7 (Transcript Metrics) | G-7 enhancement | §7.2.1 | Context window stacked bar chart in detail panel |
| REQUIREMENTS.md G-8 (Structured Logging) | G-8 enhancement | §7.2.2 | Log viewer detail panel with filters and time correlation |
| REQUIREMENTS.md F-1 (Compaction Time Travel) | F-1 enhancement | §7.2.3 | Snapshot viewer with diff view in detail panel |
| REQUIREMENTS.md G-5 (Session Summary) | G-5 enhancement | §7.2.4 | Confidence badges on timeline + threshold comparison in detail |
| REQUIREMENTS.md DP-5 (Confidence as Visual Signal) | G-5 enhancement | §7.2.4 | Color-coded confidence badges directly on timeline events |
| PHASE2-AUDIT §3.2 item 1 (F-10) | F-10 | §7.1.1 | New feature fully specified |
| PHASE2-AUDIT §3.2 item 2 (G-11) | G-11 | §7.1.3 | New feature fully specified |
| PHASE2-AUDIT §3.3 tiers | All | §7.1-7.3 | All tiers documented per priority |
| PHASE2-AUDIT §2.7 (missing task lifecycle events) | G-2 enhancement | §7.1.2 | Task events specified as prerequisite P-5 |
