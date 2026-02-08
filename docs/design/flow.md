# Event Model & Hook Flow Low-Level Design

## 1. Overview

This document defines the event model, CLI/Daemon interaction patterns, and complete hook flows for the Sidekick system. It establishes how the CLI and Daemon communicate asynchronously while supporting synchronous hook responses required by Claude Code.

## 2. Core Architecture

### 2.1 CLI/Daemon Relationship

The CLI and Daemon operate asynchronously:

- **CLI**: Handles synchronous hook responses to Claude Code. Reads staged files, logs events locally.
- **Daemon**: Performs async background work (LLM calls, transcript analysis). Stages files for CLI consumption. Logs events locally.
- **Communication**: CLI sends events to Daemon via IPC. Daemon "responds" by staging files that CLI reads on subsequent hook invocations.
- **Log Aggregation**: CLI and Daemon each maintain their own log files. The Monitoring UI aggregates both for unified time-travel debugging.

### 2.2 Staging Pattern

The Daemon prepares future CLI actions by staging files. This decouples async Daemon work from sync CLI responses.

**Staging Directory**: `.sidekick/sessions/{session_id}/stage/{hook_name}/`

**Example Structure**:

```
.sidekick/sessions/{session_id}/
└── stage/
    ├── UserPromptSubmit/
    │   └── UserPromptSubmitReminder.json
    ├── PreToolUse/
    │   └── AreYouStuckReminder.json
    └── Stop/
        └── VerifyCompletionReminder.json
```

### 2.3 Handler Registration

Both CLI and Daemon register handlers via a unified `HandlerRegistry`:

- **Default handler**: No-op (debug log only)
- **Feature handlers**: Register with explicit priority for execution ordering
- **Execution priority**: Determines handler invocation order (higher priority runs first)
- **Consumption priority**: Stored in staged reminder files; determines which reminder the CLI returns when multiple are staged

**Handler Registration API**:

```typescript
interface HandlerRegistry {
  register(options: {
    id: string // Unique handler identifier
    priority: number // Higher runs first
    filter: HandlerFilter // Which events to handle
    handler: EventHandler // The callback function
  }): void
}

type HandlerFilter =
  | { kind: 'hook'; hooks: HookName[] } // Specific hook events
  | { kind: 'transcript'; eventTypes: TranscriptEventType[] } // Specific transcript events
  | { kind: 'all' } // Both hook and transcript events

type EventHandler = (event: SidekickEvent, ctx: HandlerContext) => Promise<HandlerResult | void>

interface HandlerResult {
  response?: HookResponse // For hook events that need responses
  stop?: boolean // If true, skip remaining handlers
}
```

**Processing Model**:

- **Hook events**: Handlers execute sequentially (must produce single response to CLI)
- **Transcript events**: Handlers for a single event run concurrently via `Promise.all`; callers serialize across events (each line settles before the next)

Handlers are responsible for their own error handling via internal try/catch. Unhandled exceptions are logged by the framework, and execution continues to the next handler.

## 3. Event Taxonomy

### 3.1 Event Types

| Type                  | Source                       | Examples                                               | Behavior                       |
| --------------------- | ---------------------------- | ------------------------------------------------------ | ------------------------------ |
| **Hook Events**       | Claude Code (external)       | `SessionStart`, `PostToolUse`, `Stop`                  | Trigger handler chains         |
| **Transcript Events** | TranscriptService (internal) | `UserPrompt`, `ToolCall`, `ToolResult`                 | Trigger handler chains (async) |
| **Internal Events**   | Handlers                     | `ReminderStaged`, `ReminderConsumed`, `SummaryUpdated` | Logged only (non-recursive)    |

**Note**: Hook events arrive via IPC from CLI; transcript events are emitted by TranscriptService when it detects new entries in the transcript file. Both event types flow through the same handler dispatch system.

**Internal Events Extensibility**: Domain-specific LLDs may define additional internal event types (e.g., `HookReceived` in docs/design/CLI.md, `StatuslineRendered` in docs/design/FEATURE-STATUSLINE.md). These must conform to the `SidekickEvent` schema defined in §3.2.

### 3.2 Event Schema

Events use a discriminated union pattern for type-safe handler dispatch.

**Logging Attributes**: When events are logged, Pino adds standard fields (`level`, `time`, `pid`, `hostname`, `name`, `msg`). See **docs/design/STRUCTURED-LOGGING.md §3.3** for the complete log record format.

```typescript
// Base context shared by all events
interface EventContext {
  sessionId: string // Required: correlates all events in a session
  timestamp: number // Unix timestamp (ms)
  scope?: 'project' | 'user' // Which scope this event occurred in
  correlationId?: string // Unique ID for the CLI command execution
  traceId?: string // Optional: links causally-related events
}

// Transcript event types (from file watching)
type TranscriptEventType =
  | 'UserPrompt' // User message added
  | 'AssistantMessage' // Assistant response complete
  | 'ToolCall' // Tool invocation recorded
  | 'ToolResult' // Tool result recorded
  | 'Compact' // Transcript was compacted

// Hook events - discriminated union by hook name
// Each hook type has a specific payload shape
//
// Raw Claude Code input mapping:
// - session_id → context.sessionId
// - hook_event_name → hook (used for discrimination)
// - Other fields → payload (camelCased)
//
// Common fields across most hooks: transcriptPath, permissionMode

interface SessionStartHookEvent {
  kind: 'hook'
  hook: 'SessionStart'
  context: EventContext
  payload: {
    startType: 'startup' | 'resume' | 'clear' | 'compact'
    transcriptPath: string
  }
}

interface SessionEndHookEvent {
  kind: 'hook'
  hook: 'SessionEnd'
  context: EventContext
  payload: {
    endReason: 'clear' | 'logout' | 'prompt_input_exit' | 'other'
  }
}

interface UserPromptSubmitHookEvent {
  kind: 'hook'
  hook: 'UserPromptSubmit'
  context: EventContext
  payload: {
    prompt: string // User's prompt text
    transcriptPath: string // Path to transcript file
    cwd: string // Current working directory
    permissionMode: string // e.g., "default"
  }
}

interface PreToolUseHookEvent {
  kind: 'hook'
  hook: 'PreToolUse'
  context: EventContext
  payload: {
    toolName: string
    toolInput: Record<string, unknown>
  }
}

interface PostToolUseHookEvent {
  kind: 'hook'
  hook: 'PostToolUse'
  context: EventContext
  payload: {
    toolName: string
    toolInput: Record<string, unknown>
    toolResult: unknown
  }
}

interface StopHookEvent {
  kind: 'hook'
  hook: 'Stop'
  context: EventContext
  payload: {
    transcriptPath: string // Path to transcript file
    permissionMode: string // e.g., "default"
    stopHookActive: boolean // Whether stop hook is active
  }
}

interface PreCompactHookEvent {
  kind: 'hook'
  hook: 'PreCompact'
  context: EventContext
  payload: {
    transcriptPath: string // Path to current transcript
    transcriptSnapshotPath: string // Path where CLI copied snapshot
  }
}

// Union of all hook event types
type HookEvent =
  | SessionStartHookEvent
  | SessionEndHookEvent
  | UserPromptSubmitHookEvent
  | PreToolUseHookEvent
  | PostToolUseHookEvent
  | StopHookEvent
  | PreCompactHookEvent

// Convenience type for hook names (derived from union)
type HookName = HookEvent['hook']

// Transcript events - emitted by TranscriptService
// Note: TranscriptService updates its internal state BEFORE emitting events,
// ensuring the embedded metrics reflect the current state including this event.
interface TranscriptEvent {
  kind: 'transcript'
  eventType: TranscriptEventType
  context: EventContext
  payload: {
    lineNumber: number // Line in transcript file
    entry: TranscriptEntry // Raw JSONL entry
    content?: string // Parsed content
    toolName?: string // For ToolCall/ToolResult
  }
  metadata: {
    transcriptPath: string // Absolute path to transcript file
    metrics: TranscriptMetrics // Snapshot of current metrics (after this event)
  }
}

// Metrics snapshot embedded in TranscriptEvent (subset for event payload)
// See docs/design/TRANSCRIPT-PROCESSING.md §3.1 for full TranscriptMetrics schema
interface TranscriptMetrics {
  turnCount: number // Total user prompts in session
  toolCount: number // Total tool invocations in session
  toolsThisTurn: number // Tools since last UserPrompt
  totalTokens: number // Estimated total tokens in transcript
}

// Unified event type - discriminated union
type SidekickEvent = HookEvent | TranscriptEvent

// Type guards - top level
function isHookEvent(event: SidekickEvent): event is HookEvent {
  return event.kind === 'hook'
}

function isTranscriptEvent(event: SidekickEvent): event is TranscriptEvent {
  return event.kind === 'transcript'
}

// Type guards - hook-specific (for use after isHookEvent check)
function isSessionStartEvent(event: HookEvent): event is SessionStartHookEvent {
  return event.hook === 'SessionStart'
}

function isPreToolUseEvent(event: HookEvent): event is PreToolUseHookEvent {
  return event.hook === 'PreToolUse'
}

function isPostToolUseEvent(event: HookEvent): event is PostToolUseHookEvent {
  return event.hook === 'PostToolUse'
}

// ... similar guards for other hook types
```

**Usage in handlers**:

```typescript
context.handlers.register({
  id: 'example:session-start',
  filter: { kind: 'hook', hooks: ['SessionStart'] },
  handler: async (event, ctx) => {
    if (!isHookEvent(event) || !isSessionStartEvent(event)) return
    // TypeScript now knows: event.payload.startType and event.payload.transcriptPath
    console.log(`Session started: ${event.payload.startType}`)
  },
})
```

### 3.3 Non-Recursive Event Processing

Events posted by handlers are logged but do not trigger further handlers. This prevents infinite loops and keeps the system predictable.

## 4. Reminder System

This section describes the reminder system in general, but does not go into detail about specifically what components are responsible for which actions. Keep in mind that, under the covers, there are a series of registered handlers that fire on specific events (e.g. hook events), and some of these handlers will trigger the staging of reminders, some will find and inject ready/staged reminders, etc. There is no monolithic reminder system that knows about all the reminder details.

### 4.1 Reminder File Schema

**Location**: `.sidekick/sessions/{session_id}/stage/{hook_name}/{reminder_name}.json`

Per **docs/design/FEATURE-REMINDERS.md §3.3**, staged reminders use typed text fields:

```typescript
interface StagedReminder {
  name: string // Unique identifier (e.g., "AreYouStuckReminder")
  blocking: boolean // Whether to block the action
  priority: number // Higher = consumed first when multiple staged
  persistent: boolean // If true, file is not deleted on consumption
  // Text fields (all optional, pre-interpolated from YAML template)
  userMessage?: string // Shown to user in chat UI
  additionalContext?: string // Injected as system context
  reason?: string // Used as blocking reason
}
```

| Field               | Type    | Description                                            |
| ------------------- | ------- | ------------------------------------------------------ |
| `name`              | string  | Unique identifier for this reminder type               |
| `blocking`          | boolean | Whether or not this reminder should block an action    |
| `priority`          | number  | Higher = consumed first when multiple reminders staged |
| `persistent`        | boolean | If true, file is not deleted on consumption            |
| `userMessage`       | string? | Text shown to user in chat UI                          |
| `additionalContext` | string? | Text injected as system context                        |
| `reason`        | string? | Text used as blocking reason                           |

### 4.2 Reminder Personalities

| Type           | Example                  | `persistent` | Behavior                           |
| -------------- | ------------------------ | ------------ | ---------------------------------- |
| **Persistent** | UserPromptSubmitReminder | `true`       | Always fires, never deleted        |
| **One-shot**   | PauseAndReflectReminder  | `false`      | Fires once, deleted on consumption |
| **One-shot**   | VerifyCompletionReminder | `false`      | Fires once, deleted on consumption |

**Note**: Reminders can also be unstaged (deleted before consumption) when context changes—for example, `VerifyCompletionReminder` is unstaged on UserPromptSubmit (new prompt = task complete) or when `PauseAndReflectReminder` is staged (prevents cascade where blocking triggers Stop hook prematurely).

### 4.3 CLI Consumption Logic

When a hook fires, the CLI:

1. Scan `.sidekick/sessions/{session_id}/stage/{hook_name}/*.json`
2. Sort by `priority` (descending)
3. Take highest priority reminder
4. If `persistent: false` → delete file
5. If `persistent: true` → leave file
6. Log `ReminderConsumed` event to CLI log
7. Return reminder fields in hook response (`blocking`, `reason`, `additionalContext`, etc.)

### 4.4 Daemon Staging Logic

When conditions are met to stage a reminder:

1. Create/overwrite `.sidekick/sessions/{session_id}/stage/{hook_name}/{reminder_name}.json`
2. Log `ReminderStaged` event to Daemon log

### 4.5 Daemon Unstaging Logic

When context changes require removing a staged reminder:

1. Delete `.sidekick/sessions/{session_id}/stage/{hook_name}/{reminder_name}.json` if exists
2. Log `ReminderUnstaged` event to Daemon log

**Example**: `UnstageVerifyCompletion` handler deletes `VerifyCompletionReminder` on `UserPromptSubmit` event, since a new prompt includes its own reminders to compensate for Claude Code's forgetfulness.

## 5. Complete Hook Flows

### 5.1 SessionStart

**Trigger**: Session begins (type: `startup` | `resume` | `clear` | `compact`)

**Sidekick Effects**:

- Statusline shows resume message if found (else summary-empty default)
- Session state initialized
- TranscriptService begins watching transcript file

**Call Chain**:

```
[Claude Code] Call sidekick-hook.sh
  ├─[sidekick-hook.sh] Call sidekick.cli --hook SessionStart $type $transcript_path
  │   ├─[CLI] Start daemon (if not running)
  │   ├─[CLI] Send SessionStart event to daemon (with type, transcript_path)
  │   │   └─[Daemon] Invoke SessionStart handlers
  │   │       ├─[InitSessionState] Init daemon session state
  │   │       │   ├─ startup|clear: clean slate
  │   │       │   └─ startup|clear: delete all files in `.sidekick/sessions/{session_id}/` recursively
  │   │       ├─[InitTranscriptService] Register transcript with TranscriptService
  │   │       │   ├─ Start watching transcript file
  │   │       │   ├─ startup|clear: reset metrics to zero
  │   │       │   ├─ resume: load persisted metrics, scan for gaps
  │   │       │   └─ compact: full recompute from truncated transcript
  │   │       ├─[CreateFirstSessionSummary] Create placeholder session summary
  │   │       └─[StageDefaultUserPromptReminder] Stage default UserPromptSubmit reminder
  │   ├─[CLI] Invoke SessionStart handlers
  │   │   └─[CLI] No-op (no handlers registered)
  │   └─[CLI] Return result: {}
  └─[sidekick-hook.sh] Format and return CC hook result

[TranscriptService] Now watching transcript file for changes
  ├─ Emits TranscriptEvents as new entries appear
  └─ Note: File watcher must NOT prevent Daemon shutdown (use unref() or equivalent)

[statusline.sh] Show resume message if found, else empty-summary default
```

### 5.2 UserPromptSubmit

**Trigger**: User submits a prompt

**Sidekick Effects**:

- UserPromptSubmit reminder issued (if staged and pending)
- Statusline shows updated summary if available

**Call Chain**:

```
[Claude Code] Call sidekick-hook.sh
  ├─[sidekick-hook.sh] Call sidekick.cli --hook UserPromptSubmit
  │   ├─[CLI] If command (clear|compact): return {}
  │   ├─[CLI] Send UserPromptSubmit event to daemon
  │   │   └─[Daemon] Invoke UserPromptSubmit handlers
  │   │       ├─[UpdateSessionSummary] Initiate async summary calculation
  │   │       │   └─ Initiates snarky message generation
  │   │       └─[UnstageVerifyCompletion] Delete Stop/VerifyCompletionReminder if exists
  │   │           └─ New prompt means previous task is complete
  │   ├─[CLI] Invoke UserPromptSubmit handlers
  │   │   └─[InjectUserPromptSubmitReminders] Check staged reminders, select highest-priority
  │   │       ├─[CLI] Pick highest-priority pending reminder
  │   │       └─[CLI] Delete consumed reminder (if not persistent)
  │   └─[CLI] Return result: { "showReminder": "..." } or {}
  └─[sidekick-hook.sh] Format and return CC hook result

[TranscriptService] (parallel) Detects UserPrompt entry in transcript
  ├─ Increments turnCount metric, resets toolsThisTurn to 0
  └─ Emits TranscriptEvent { kind: 'transcript', eventType: 'UserPrompt',
       metadata: { transcriptPath: "...", metrics: { turnCount: 2, toolCount: 0, toolsThisTurn: 0, totalTokens: 150 } } }

[statusline.sh] Show session summary if found
```

**Note**: Turn counting is now handled by TranscriptService when it detects `UserPrompt` entries in the transcript file, not by hook handlers. This provides a single source of truth derived from the actual transcript.

### 5.3 PreToolUse

**Trigger**: Before a tool executes

**Sidekick Effects**:

- PauseAndReflect blocking reminder issued (if staged)

**Call Chain**:

```
[Claude Code] Call sidekick-hook.sh
  ├─[sidekick-hook.sh] Call sidekick.cli --hook PreToolUse
  │   ├─[CLI] Send PreToolUse event to daemon
  │   │   └─[Daemon] Invoke PreToolUse handlers
  │   │       └─[Daemon] No-op (no handlers registered)
  │   ├─[CLI] Invoke PreToolUse handlers
  │   │   └─[InjectPreToolUseReminders] Check staged reminders, select highest-priority
  │   │       ├─[CLI] Pick highest-priority pending reminder
  │   │       └─[CLI] Delete consumed reminder (if not persistent)
  │   └─[CLI] Return result: { "blocking": true, "reason": "..." } or {}
  └─[sidekick-hook.sh] Format and return CC hook result

[statusline.sh] Show session summary if found
```

### 5.4 PostToolUse

**Trigger**: After a tool completes

**Sidekick Effects**:

- Reminders staged for future hooks (based on metrics from TranscriptService)

**Call Chain**:

```
[Claude Code] Call sidekick-hook.sh
  ├─[sidekick-hook.sh] Call sidekick.cli --hook PostToolUse
  │   ├─[CLI] Send PostToolUse event to daemon
  │   │   └─[Daemon] Invoke PostToolUse handlers
  │   │       ├─[UpdateSessionSummary] Re-evaluate summary if cadence met
  │   │       │   ├─ Reads metrics from TranscriptService.getMetrics()
  │   │       │   ├─ Initiates snarky message generation
  │   │       │   └─ Initiates resume message if significant title change
  │   │       ├─[StagePauseAndReflect] Stage if threshold met
  │   │       │   └─ Reads toolsThisTurn from TranscriptService.getMetrics()
  │   │       └─[StageStopReminders] Stage based on tool type (e.g., file edit)
  │   ├─[CLI] Invoke PostToolUse handlers
  │   │   └─[InjectPostToolUseReminders] Check staged reminders, select highest-priority
  │   │       ├─[CLI] Pick highest-priority pending reminder
  │   │       └─[CLI] Delete consumed reminder (if not persistent)
  │   └─[CLI] Return result: { "blocking": true, "reason": "..." } or {}
  └─[sidekick-hook.sh] Format and return CC hook result

[TranscriptService] (parallel) Detects ToolResult entry in transcript
  ├─ Increments toolCount and toolsThisTurn metrics
  └─ Emits TranscriptEvent { kind: 'transcript', eventType: 'ToolResult',
       metadata: { transcriptPath: "...", metrics: { turnCount: 2, toolCount: 5, toolsThisTurn: 3, totalTokens: 2500 } } }

[statusline.sh] Show session summary if found
```

**Note**: Tool counting is now handled by TranscriptService when it detects `ToolResult` entries in the transcript file. Reminder handlers read metrics from `TranscriptService.getMetrics()` to evaluate thresholds. Reminders staged in PostToolUse are consumed in the _next_ PreToolUse or Stop.

### 5.5 Stop

**Trigger**: Agent attempts to stop/complete

**Sidekick Effects**:

- Blocking stop reminder issued (if staged)

**Call Chain**:

```
[Claude Code] Call sidekick-hook.sh
  ├─[sidekick-hook.sh] Call sidekick.cli --hook Stop
  │   ├─[CLI] Send Stop event to daemon
  │   │   └─[Daemon] Invoke Stop handlers
  │   │       └─[Daemon] No-op (no handlers registered)
  │   ├─[CLI] Invoke Stop handlers
  │   │   └─[InjectStopReminders] Check staged reminders, select highest-priority
  │   │       ├─[CLI] Pick highest-priority pending reminder
  │   │       └─[CLI] Delete consumed reminder (if not persistent)
  │   └─[CLI] Return result: { "blocking": true, "reason": "..." } or {}
  └─[sidekick-hook.sh] Format and return CC hook result

[statusline.sh] Show session summary if found
```

### 5.6 PreCompact

**Trigger**: Before transcript compaction

**Sidekick Effects**:

- Full transcript copied to session state (for Monitoring UI time-travel)
- TranscriptService captures pre-compact metrics and watermarks
- Compaction history updated for timeline visualization

**Call Chain**:

```
[Claude Code] Call sidekick-hook.sh (includes transcript_path)
  ├─[sidekick-hook.sh] Call sidekick.cli --hook PreCompact $transcript_path
  │   ├─[CLI] SYNCHRONOUS: Copy transcript file
  │   │   └─ Copy to `.sidekick/sessions/{session_id}/transcripts/pre-compact-{timestamp}.jsonl`
  │   ├─[CLI] Send PreCompact event to daemon (with transcriptSnapshotPath)
  │   │   └─[Daemon] Invoke PreCompact handlers
  │   │       └─[CapturePreCompactState] Call TranscriptService.capturePreCompactState(path)
  │   │           ├─ Snapshot current metrics (turn count, tool count, tokens, watermarks)
  │   │           ├─ Record compaction point metadata
  │   │           └─ Persist to `compaction-history.json` for UI timeline
  │   ├─[CLI] Invoke PreCompact handlers
  │   │   └─[CLI] No-op (no handlers registered)
  │   └─[CLI] Return result: {}
  └─[sidekick-hook.sh] Format and return CC hook result

[Claude Code] Proceeds with compaction

[TranscriptService] Detects shortened transcript on next file change
  ├─ Triggers full metrics recompute from truncated transcript
  └─ Emits TranscriptEvent { kind: 'transcript', eventType: 'Compact',
       metadata: { transcriptPath: "...", metrics: { turnCount: 1, toolCount: 10, toolsThisTurn: 0, totalTokens: 800 } } }

[statusline.sh] Show session summary if found
```

**Why CLI copies the transcript (not Daemon)**:

- **Timing**: Claude Code compacts immediately after hook returns; Daemon is async
- **Completeness**: Monitoring UI needs full transcript content for time-travel debugging
- **UI Requirements**: Show pre-compaction events, compaction points, post-compaction continuation

**File Structure After Compaction**:

```
.sidekick/sessions/{session_id}/
├── transcripts/
│   ├── pre-compact-1699999999999.jsonl  # Full transcript before first compaction
│   └── pre-compact-1700000000000.jsonl  # Full transcript before second compaction
└── state/
    └── compaction-history.json          # Metadata for UI timeline
```

### 5.7 SessionEnd

**Trigger**: Session terminates (reason: `clear` | `logout` | `prompt_input_exit` | `other`)

**Sidekick Effects**:

- TranscriptService stops watching the transcript file

**Call Chain**:

```
[Claude Code] Call sidekick-hook.sh
  ├─[sidekick-hook.sh] Call sidekick.cli --hook SessionEnd $reason
  │   ├─[CLI] Send SessionEnd event to daemon (with reason)
  │   │   └─[Daemon] Invoke SessionEnd handlers
  │   │       └─[StopTranscriptService] Stop file watcher for this session
  │   │           └─ Release file watcher resources
  │   ├─[CLI] Invoke SessionEnd handlers
  │   │   └─[CLI] No-op (no handlers registered)
  │   └─[CLI] Return result: {}
  └─[sidekick-hook.sh] Format and return CC hook result

[statusline.sh] Show session summary if found
```

## 6. Error Handling

### 6.1 Daemon Down

When CLI detects daemon is not running:

1. Attempt to restart daemon
2. If restart fails: log error, return empty/default hook response
3. No side effects—CLI degrades gracefully

### 6.2 Handler Exceptions

Handlers implement internal try/catch for graceful degradation:

- Handler catches exception → logs error → returns fallback result
- Unhandled exception → framework logs error → continues to next handler
- One failing handler does not block subsequent handlers

### 6.3 Staging Failures

If file write fails during staging:

1. Log error with context
2. Reminder is not staged (CLI won't find it)
3. System continues—missing reminder is acceptable degradation

## 7. Logging Events

### 7.1 CLI-Logged Events

| Event              | When                          |
| ------------------ | ----------------------------- |
| `HookReceived`     | Hook invocation starts        |
| `ReminderConsumed` | CLI returns a staged reminder |
| `HookCompleted`    | Hook invocation ends          |

### 7.2 Daemon-Logged Events

| Event                      | When                                        |
| -------------------------- | ------------------------------------------- |
| `EventReceived`            | IPC event arrives from CLI                  |
| `HandlerExecuted`          | Handler completes (success or failure)      |
| `ReminderStaged`           | Reminder file created/updated               |
| `SummaryUpdated`           | Session summary recalculated                |
| `RemindersCleared`         | Stage directory cleaned (SessionStart)      |
| `TranscriptEventEmitted`   | TranscriptService emits a transcript event  |
| `TranscriptMetricsUpdated` | TranscriptService updates derived metrics   |
| `PreCompactCaptured`       | Pre-compact snapshot persisted              |
| `CompactionDetected`       | Transcript shortened, full recompute starts |

## 8. Configuration

### 8.1 Reminder Configuration

Reminder thresholds (turn cadence, tool cadence, stuck threshold) are configured per-reminder type in the Reminders feature. See **docs/design/FEATURE-REMINDERS.md §8** for configuration schema.

### 8.2 Handler Priorities

Handler priorities are specified at registration time via the `priority` field (§2.3). Higher values execute first. Example priorities:

- **100**: Infrastructure handlers (session state init, TranscriptService)
- **80**: Feature handlers (session summary)
- **70**: Staging handlers (reminders)
- **50**: Consumption handlers (CLI reminder injection)

### 8.3 Transcript Configuration

See **docs/design/CONFIG-SYSTEM.md** for the full transcript configuration schema. Key settings:

```yaml
# .sidekick/transcript.yaml
transcript:
  watchDebounceMs: 100 # Debounce interval for file change events
```

## 9. Future Considerations

### 9.1 Not In Scope (V1)

- **Notification hook**: No current use case
- **Recursive event handling**: Events posted by handlers don't trigger handlers
- **Log aggregation**: UI reads both log files directly; no server-side aggregation

### 9.2 Potential Enhancements

- **Reminder templates**: Parameterized reminder content with variable substitution
- **Conditional reminders**: Reminders with evaluation predicates beyond simple staging
- **Handler dependencies**: Explicit DAG for handler execution (beyond priority ordering)
