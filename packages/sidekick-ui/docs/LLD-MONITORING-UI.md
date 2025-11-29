# Monitoring UI Low-Level Design

## 1. Overview

The Sidekick Monitoring UI is a developer tool designed to provide visibility into the internal state, decision-making process, and evolution of a Sidekick session. It enables "Time Travel" debugging by reconstructing past states from structured logs, allowing developers to understand *why* the system behaved in a certain way.

**Related Documents**:
- `LLD-flow.md`: Event model, PreCompact flow with transcript snapshot
- `LLD-TRANSCRIPT-PROCESSING.md`: TranscriptService, compaction history management
- `LLD-SUPERVISOR.md`: Event emission, TranscriptService integration
- `LLD-STRUCTURED-LOGGING.md`: Entity-lifecycle event schema

## 2. Architecture

### 2.1 Tech Stack
- **Type**: Local Web Application (SPA).
- **Framework**: React + Vite + TypeScript.
- **Styling**: TailwindCSS (for rapid, modern UI development).
- **Runtime**: Node.js (served via `npx @sidekick/ui` or similar).
- **Communication**: Polling / WebSocket (future) to read local files.

### 2.2 Data Flow
The UI runs locally and reads files from global logs, session-specific state directories, and the Claude Code transcript file.

```mermaid
graph TD
    UI[Monitoring UI (React)] -->|Reads| SupervisorLog[.sidekick/logs/supervisor.log]
    UI -->|Reads| CliLog[.sidekick/logs/cli.log]
    UI -->|Reads| Transcript[$transcript_path - Claude Code transcript]
    UI -->|Reads| SessionState[.sidekick/sessions/{sessionId}/state/*.json]
    UI -->|Reads| StagedReminders[.sidekick/sessions/{sessionId}/stage/{hookName}/*.json]
    UI -->|Reads| TranscriptSnapshots[.sidekick/sessions/{sessionId}/transcripts/pre-compact-*.jsonl]

    subgraph "Replay Engine (In-Browser)"
        LogFile --> Ingest[Log Ingest]
        Ingest --> Reconstructor[State Reconstructor]
        Reconstructor --> TimeTravel[Time Travel Store]
    end
```

**Notes**:
- **Transcript Path**: The `$transcript_path` is provided by Claude Code at session start and propagated through: Claude Code → hook script → sidekick CLI → sidekick Supervisor. The UI reads this file to reconstruct the conversation timeline.
- **Log Files**: Global (not session-specific). The UI filters events by `context.sessionId` to isolate a single session's timeline. See **LLD-STRUCTURED-LOGGING.md §2.2** for log file strategy.

## 3. Core Features

### 3.1 Compaction Timeline (New)

The Monitoring UI supports **compaction-aware time travel** to handle transcript compaction events. Per **LLD-TRANSCRIPT-PROCESSING.md** and **LLD-flow.md §5.6**:

- **Pre-Compact Snapshots**: CLI copies full transcript before compaction to `.sidekick/sessions/{sessionId}/transcripts/pre-compact-{timestamp}.jsonl`
- **Compaction History**: TranscriptService maintains `compaction-history.json` with metadata for each compaction point

**UI Behavior**:
1. **Compaction Markers**: Timeline shows visual markers (e.g., scissors icon) at each compaction point
2. **Segment Navigation**: Users can navigate between pre-compact and post-compact transcript segments
3. **Metrics Continuity**: Metrics shown correctly across compaction boundaries (TranscriptService handles recomputation)
4. **Snapshot Viewer**: Clicking a compaction marker opens the pre-compact snapshot for comparison

**Data Source**: Reads `.sidekick/sessions/{sessionId}/state/compaction-history.json` for compaction metadata (schema per **LLD-TRANSCRIPT-PROCESSING.md §4.2**):
```json
[
  {
    "compactedAt": 1678888888888,
    "transcriptSnapshotPath": "transcripts/pre-compact-1678888888888.jsonl",
    "metricsAtCompaction": {
      "turnCount": 15,
      "toolsThisTurn": 0,
      "toolCount": 142,
      "messageCount": 45,
      "tokenUsage": { "input": 32000, "output": 13000, "total": 45000 },
      "toolsPerTurn": 9.5
    },
    "postCompactLineCount": 50
  }
]
```

### 3.2 Time Travel (The Replay Engine)
Since Sidekick overwrites its state files (`state/session-summary.json`, etc.), we cannot rely on the file system for history. Instead, we use **Log-Based Reconstruction**.

- **Mechanism**:
    1.  The UI ingests `.sidekick/logs/supervisor.log` and `.sidekick/logs/cli.log` (NDJSON).
    2.  It filters events by `context.sessionId` to isolate the target session.
    3.  It merges the streams based on timestamp.
    4.  It filters for `SidekickEvent` types (Hook events, Transcript events, Internal events).
    5.  It builds an in-memory timeline of state snapshots.
    6.  The user can scrub a timeline slider to "rewind" the state.

### 3.2 Views

#### A. Session Timeline
A master timeline showing the chronological sequence of events:
- User Messages
- Assistant Responses
- Tool Uses
- **Reminders Issued**
- **Sidekick Decisions** (e.g., "Triggered Summary", "Pruned Context")
- **State Changes** (e.g., "Summary Updated")
- **Status Line Calls**
- **Errors and Warnings**

#### B. Transcript Viewer
Displays the conversation history.
- **Sync**: When scrubbing the timeline, the transcript view highlights the active message at that point in time.

#### C. State Inspector
A JSON tree view showing the internal state at the selected timestamp.
- **Scope**: Shows session state files from `.sidekick/sessions/{sessionId}/state/`:
  - `session-summary.json` - Session title, intent, topics
  - `session-state.json` - Token count, cost, duration, model info
  - Staged reminders in `.sidekick/sessions/{sessionId}/stage/{hookName}/*.json`
- **Diff Mode**: Highlights what changed between the previous and current state.

#### D. Decision Log
A filtered view of "Decision" events to see the system's reasoning chain.
- Example: `[Decision] Session Title Change: Updated session title to "My Session"`

#### E. System Health
A real-time dashboard showing the health of the Supervisor process.
- **Metrics**: Uptime, Memory Usage (Heap/RSS), Queue Depth, Active Tasks.
- **Source**: Reads `.sidekick/state/supervisor-status.json` (global, not session-specific).
- **Visuals**: Sparklines for memory/queue, status indicators for liveness.
- **Offline Detection**: Poll file mtime; if > 30s old, show "Supervisor Offline" state with red/grey badge and last-known timestamp. This handles cases where the Supervisor crashes or is manually stopped.

## 4. Data Sources & Schema

### 4.1 SidekickEvent Schema

The UI consumes **SidekickEvents** as defined in `LLD-flow.md §3.2`. All events conform to a unified schema with discriminated union types.

**Reference**: See `LLD-STRUCTURED-LOGGING.md §3` for log record format (Pino adds `level`, `time`, `pid`, `hostname`, `name`, `msg` fields).

```typescript
// Base context shared by all events
interface EventContext {
  sessionId: string        // Required: correlates all events in a session
  timestamp: number        // Unix timestamp (ms)
  scope?: 'project' | 'user'  // Which scope this event occurred in
  correlationId?: string   // Unique ID for the CLI command execution
  traceId?: string         // Optional: links causally-related events
  hook?: string            // Optional: which hook triggered this event
}

// Unified event type - discriminated union
type SidekickEvent = HookEvent | TranscriptEvent

interface HookEvent {
  kind: 'hook'
  hook: HookName           // 'SessionStart' | 'UserPromptSubmit' | 'PreToolUse' | etc.
  context: EventContext
  payload: Record<string, unknown>  // Hook-specific payload
}

interface TranscriptEvent {
  kind: 'transcript'
  eventType: TranscriptEventType  // 'UserPrompt' | 'ToolCall' | 'ToolResult' | 'Compact'
  context: EventContext
  payload: {
    lineNumber: number
    entry: TranscriptEntry
    content?: string       // Message/result content (may be truncated for UI)
    toolName?: string      // For ToolCall/ToolResult events
  }
  metadata: {
    transcriptPath: string
    metrics: TranscriptMetrics
  }
}
```

#### Event Types

| Type                  | Source                       | Examples                                               | Behavior                       |
|-----------------------|------------------------------|--------------------------------------------------------|--------------------------------|
| **Hook Events**       | Claude Code (external)       | `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `Stop` | Trigger handler chains       |
| **Transcript Events** | TranscriptService (internal) | `UserPrompt`, `ToolCall`, `ToolResult`, `Compact`      | Trigger handler chains (async) |
| **Internal Events**   | Handlers                     | `ReminderStaged`, `ReminderConsumed`, `SummaryUpdated` | Logged only (non-recursive)    |

#### CLI-Logged Events

| Event              | When                          |
|--------------------|-------------------------------|
| `HookReceived`     | Hook invocation starts        |
| `ReminderConsumed` | CLI returns a staged reminder |
| `HookCompleted`    | Hook invocation ends          |

#### Supervisor-Logged Events

| Event                      | When                                        |
|----------------------------|---------------------------------------------|
| `EventReceived`            | IPC event arrives from CLI                  |
| `HandlerExecuted`          | Handler completes (success or failure)      |
| `ReminderStaged`           | Reminder file created/updated               |
| `SummaryUpdated`           | Session summary recalculated                |
| `RemindersCleared`         | Stage directory cleaned (SessionStart)      |
| `TranscriptEventEmitted`   | TranscriptService emits a transcript event  |
| `TranscriptMetricsUpdated` | TranscriptService updates derived metrics   |
| `PreCompactCaptured`       | Pre-compact snapshot persisted              |

#### Example: UserPromptSubmit Hook Flow

```json
// 1. Hook received from Claude (cli.log)
{ "level": 30, "time": 1678888888000, "source": "cli", "pid": 12345,
  "type": "HookReceived",
  "context": { "sessionId": "sess-001", "traceId": "req-abc", "hook": "UserPromptSubmit" },
  "payload": { "prompt": "Fix the auth bug" } }

// 2. Supervisor receives event via IPC (supervisor.log)
{ "level": 30, "time": 1678888888100, "source": "supervisor", "pid": 12346,
  "type": "EventReceived",
  "context": { "sessionId": "sess-001", "traceId": "req-abc", "hook": "UserPromptSubmit" },
  "payload": {} }

// 3. Supervisor handler executes (supervisor.log)
{ "level": 30, "time": 1678888888150, "source": "supervisor", "pid": 12346,
  "type": "HandlerExecuted",
  "context": { "sessionId": "sess-001", "traceId": "req-abc", "hook": "UserPromptSubmit" },
  "payload": { "handlerId": "session-summary:update", "durationMs": 45 } }

// 4. Summary updated (supervisor.log)
{ "level": 30, "time": 1678888889400, "source": "supervisor", "pid": 12346,
  "type": "SummaryUpdated",
  "context": { "sessionId": "sess-001", "traceId": "req-abc" },
  "payload": { "state": { "title": "Auth Bug Fix", "turnCount": 5 }, "reason": "cadence_met" } }

// 5. CLI returns reminder (cli.log)
{ "level": 30, "time": 1678888889500, "source": "cli", "pid": 12345,
  "type": "ReminderConsumed",
  "context": { "sessionId": "sess-001", "traceId": "req-abc", "hook": "UserPromptSubmit" },
  "payload": { "reminderName": "UserPromptSubmitReminder", "persistent": true } }

// 6. Hook completes (cli.log)
{ "level": 30, "time": 1678888889550, "source": "cli", "pid": 12345,
  "type": "HookCompleted",
  "context": { "sessionId": "sess-001", "traceId": "req-abc", "hook": "UserPromptSubmit" },
  "payload": { "durationMs": 1550, "reminderReturned": true } }
```

#### Example: TranscriptService Emits Transcript Event

The TranscriptService watches the transcript file and emits events as new entries appear. These events include embedded metrics.

```json
// TranscriptService detects new UserPrompt entry (supervisor.log)
{ "level": 30, "time": 1678888890000, "source": "supervisor", "pid": 12346,
  "type": "TranscriptEventEmitted",
  "context": { "sessionId": "sess-001" },
  "payload": {
    "kind": "transcript",
    "eventType": "UserPrompt",
    "lineNumber": 42,
    "content": "Fix the auth bug"
  },
  "metadata": {
    "transcriptPath": "/path/to/transcript.jsonl",
    "metrics": { "turnCount": 5, "toolsThisTurn": 0, "toolCount": 12, "messageCount": 18,
                 "tokenUsage": { "input": 6000, "output": 2500, "total": 8500 }, "toolsPerTurn": 2.4 }
  }
}

// TranscriptService detects ToolResult entry (supervisor.log)
{ "level": 30, "time": 1678888891000, "source": "supervisor", "pid": 12346,
  "type": "TranscriptEventEmitted",
  "context": { "sessionId": "sess-001" },
  "payload": {
    "kind": "transcript",
    "eventType": "ToolResult",
    "lineNumber": 45,
    "toolName": "Read",
    "content": "     1→import { Config } from './config'..."  // May be truncated for UI display
  },
  "metadata": {
    "transcriptPath": "/path/to/transcript.jsonl",
    "metrics": { "turnCount": 5, "toolsThisTurn": 1, "toolCount": 13, "messageCount": 19,
                 "tokenUsage": { "input": 6500, "output": 2700, "total": 9200 }, "toolsPerTurn": 2.6 }
  }
}
```

### 4.2 TranscriptMetrics

The TranscriptService maintains session metrics derived from the transcript file. These are embedded in `TranscriptEvent.metadata.metrics` and used by handlers to evaluate thresholds.

| Metric          | Type               | Description                              |
|-----------------|--------------------|------------------------------------------|
| `turnCount`     | number             | Total user prompts in session            |
| `toolsThisTurn` | number             | Tools since last UserPrompt (reset each turn) |
| `toolCount`     | number             | Total tool invocations across session    |
| `messageCount`  | number             | Total messages (user + assistant + system) |
| `tokenUsage`    | TokenUsageMetrics  | `{ input, output, total }` from transcript metadata |
| `toolsPerTurn`  | number             | Derived ratio: `toolCount / turnCount`   |

**Note**: Metrics are the single source of truth—handlers do NOT increment counters directly. See **LLD-TRANSCRIPT-PROCESSING.md §3.1** for full schema including watermarks.

### 4.3 Transcript Correlation
- **Primary Correlator**: `context.sessionId`
- **Key**: Timestamp.
- **Logic**: The UI aligns log timestamps with transcript message timestamps to show side-by-side evolution.

## 5. UI Layout (Unified Cockpit)

### 5.1 Concept
A "Unified Cockpit" design that merges the transcript and event log into a single chronological stream, maximizing context and screen real estate for state inspection.  The color theme should be "light" (with no option to switch to dark mode).

### 5.2 Layout Structure
- **Left Panel (The Stream)**: A wide, scrollable vertical stream containing:
    - **Search Bar**: A sticky header at the top of the stream to filter messages and events.
        - **Text Search**: Free-form text matches against message content and event payloads.
        - **Kind Filtering**: Use `kind:hook`, `kind:transcript` to show only hook or transcript events.
        - **Type Filtering**: Use `type:ReminderStaged`, `type:SummaryUpdated` to filter by event type.
        - **Hook Filtering**: Use `hook:UserPromptSubmit`, `hook:PreToolUse` to filter by hook name.
        - **Combined**: `kind:hook hook:Stop` shows only Stop hook events.
    - **Transcript Items**: User messages and Assistant responses in standard chat bubbles.
    - **Interleaved Events**: SidekickEvent cards inserted exactly when they occurred.
        - *Visual Style*: Distinct from chat bubbles (e.g., different background color, border, or icon) to clearly separate system events from conversation.
        - *Card Content*: Shows event `type` (e.g., "ReminderStaged"), with `payload.reason` as subtitle and expandable `payload` details.
    - **Time Travel Gutter**: A vertical rail on the far left.
        - **Slider**: A draggable handle moving vertically.
        - **Current Time Indicator**: A horizontal line extending from the slider across the entire stream, visually cutting the history at the "current" replay time.
        - **Future State**: Items below the line (in the future) are dimmed/desaturated.

- **Right Panel (State Inspector)**: A wide, dedicated panel for deep inspection.
    - **Diff Toggle**: A control to switch between "Raw View" and "Diff View".
    - **Content**:
        - *Raw View*: Read-only JSON tree of the state at the current timestamp.
        - *Diff View*: A "Git Diff" style visualization (red/green highlights) showing exactly what changed in the state file compared to the previous snapshot.

### 5.3 Interaction Model
- **Scrubbing**: Dragging the vertical slider updates the Right Panel instantly.
- **Clicking**: Clicking any event in the Stream snaps the Time Travel line to that event's timestamp.
- **Live Mode**: A "Live" button snaps the slider to the bottom and follows new events in real-time.

## 6. Implementation Strategy
1.  **Instrumentation**: Update `sidekick-core` and `sidekick-supervisor` to emit `SidekickEvent` types (see `LLD-flow.md §3` and `LLD-STRUCTURED-LOGGING.md`).
2.  **UI Scaffold**: Create React app with a log parser that reads both `cli.log` and `supervisor.log`.
3.  **Replay Logic**: Implement a reducer that:
    - Filters events by `context.sessionId` to isolate a session
    - Merges CLI and Supervisor log streams by timestamp
    - Builds state timeline from event payloads
    - Correlates causally-related events via `context.traceId`
4.  **Visualization**: Build Timeline, Inspector, and event-filter components.

## 7. Outstanding Questions

### 7.1 UI Noise Management
*Question*: Detailed events (like full reminder text or large client payloads) can clutter the stream.
*Recommendation*: The UI should use "progressive disclosure". The stream shows a summary (e.g., "Reminder Injected"), and clicking the event reveals the full payload in the Inspector or an expanded card view.


## 8. UI Mockups

**FIXME** these options are out of date with changes to requirements and the ui-mockup/*.html mockup file

### Option 1: Data-Dense Dashboard
**Concept**: High information density, compact rows, clear separation of data types. Designed for power users who want to see as much context as possible at once.

![Option 1 Mockup](assets/sidekick/ui-mockups/option_1_dense.png)

**Key Features**:
- **Compact Stream**: Chat bubbles and event cards are minimized to show more history.
- **High Contrast**: Strong colors for different event types (Blue=Chat, Orange=Decision, Purple=State).
- **Split View**: 60/40 split favors the stream but gives ample room for the inspector.

### Option 2: Focus & Flow
**Concept**: A modern, airy interface emphasizing readability and visual hierarchy. Uses generous whitespace and card-based design to reduce cognitive load.

> [!NOTE]
> Image generation limit reached. Providing wireframe and description.

```mermaid
mockup
    title Sidekick Monitoring - Focus & Flow
    h1 "Sidekick Monitoring" search input "Search events..."
    
    area "Stream (Left Panel)"
        text "User: Fix the bug in auth.ts"
        text "Assistant: I'll check the logs."
        
        box "Decision: Prune Context"
            text "Reason: Token limit reached"
        
        text "User: Looks good."
        
        line "Current Time Indicator"
        
        text "Future Event (Dimmed)"
    
    area "Inspector (Right Panel)"
        tabs "Raw" "Diff"
        
        code "JSON State View"
        text "{ 'summary': '...' }"
```

**Key Features**:
- **Card-Based Events**: System events look like distinct cards with icons, separating them visually from the chat "stream".
- **Soft Aesthetics**: Rounded corners, soft shadows, pastel accents.
- **Readable Typography**: Larger font sizes and more line height.

### Option 3: Timeline-Centric
**Concept**: Emphasizes the temporal aspect of the session. The "Time Travel" feature is the central organizing principle, with a prominent timeline rail.

> [!NOTE]
> Image generation limit reached. Providing wireframe and description.

```mermaid
mockup
    title Sidekick Monitoring - Timeline Centric
    
    area "Timeline Rail (Left Edge)"
        text "10:00 AM"
        text "|"
        text "10:05 AM"
        text "|"
        text "10:10 AM"
    
    area "Stream (Center)"
        text "User: Start session"
        text "Decision: Init"
        text "Assistant: Ready."
    
    area "Inspector (Right)"
        text "State Change: +5 lines"
        code "Diff View"
```

**Key Features**:
- **Prominent Timeline**: The left gutter is wider and includes explicit timestamps and tick marks.
- **Leader Lines**: Events in the stream are visually connected to specific points on the timeline.
- **Git-Style Diff**: The inspector defaults to a "Diff View" to show state evolution over time.
