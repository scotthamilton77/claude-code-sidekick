# Monitoring UI Low-Level Design

## 1. Overview

The Sidekick Monitoring UI is a developer tool designed to provide visibility into the internal state, decision-making process, and evolution of a Sidekick session. It enables "Time Travel" debugging by reconstructing past states from structured logs, allowing developers to understand *why* the system behaved in a certain way.

## 2. Architecture

### 2.1 Tech Stack
- **Type**: Local Web Application (SPA).
- **Framework**: React + Vite + TypeScript.
- **Styling**: TailwindCSS (for rapid, modern UI development).
- **Runtime**: Node.js (served via `npx @sidekick/ui` or similar).
- **Communication**: Polling / WebSocket (future) to read local files.

### 2.2 Data Flow
The UI runs locally and reads files directly from the session directory.

```mermaid
graph TD
    UI[Monitoring UI (React)] -->|Reads| SupervisorLog[.sidekick/sessions/{session_id}/supervisor.log]
    UI -->|Reads| CliLog[.sidekick/sessions/{session_id}/cli.log]
    UI -->|Reads| Transcript[.sidekick/sessions/{session_id}/transcript.json]
    UI -->|Reads| StateFiles[.sidekick/sessions/{session_id}/*.json]
    UI -->|Reads| SupervisorStatus[.sidekick/sessions/{session_id}/supervisor-status.json]

    subgraph "Replay Engine (In-Browser)"
        LogFile --> Ingest[Log Ingest]
        Ingest --> Reconstructor[State Reconstructor]
        Reconstructor --> TimeTravel[Time Travel Store]
    end
```

## 3. Core Features

### 3.1 Time Travel (The Replay Engine)
Since Sidekick overwrites its state files (`state/summary.json`, etc.), we cannot rely on the file system for history. Instead, we use **Log-Based Reconstruction**.

- **Mechanism**:
    1.  The UI ingests `sessions/{session_id}/supervisor.log` and `sessions/{session_id}/cli.log` (NDJSON).
    2.  It merges the streams based on timestamp.
    3.  It filters for entity-lifecycle events (by `entity` type and `lifecycle` state).
    4.  It builds an in-memory timeline of state snapshots.
    5.  The user can scrub a timeline slider to "rewind" the state.

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
- **Scope**: Shows `sessions/{session_id}/summary.json`, `sessions/{session_id}/status.json`, `sessions/{session_id}/reminders.json`, etc.
- **Diff Mode**: Highlights what changed between the previous and current state.

#### D. Decision Log
A filtered view of "Decision" events to see the system's reasoning chain.
- Example: `[Decision] Session Title Change: Updated session title to "My Session"`

#### E. System Health
A real-time dashboard showing the health of the Supervisor process.
- **Metrics**: Uptime, Memory Usage (Heap/RSS), Queue Depth, Active Tasks.
- **Source**: Reads `sessions/{session_id}/supervisor-status.json`.
- **Visuals**: Sparklines for memory/queue, status indicators for liveness.
- **Offline Detection**: Poll file mtime; if > 30s old, show "Supervisor Offline" state with red/grey badge and last-known timestamp. This handles cases where the Supervisor crashes or is manually stopped.

## 4. Data Sources & Schema

### 4.1 Entity-Lifecycle Event Schema

The UI consumes **Entity-Lifecycle events** as defined in `LLD-STRUCTURED-LOGGING.md`. All events follow a unified schema:

```json
{
  "level": 30,
  "time": 1678888888888,
  "source": "sidekick-cli",           // Required: which component emitted this
  "pid": 12345,                       // Required: process ID for correlation

  "context": {                        // Required: event correlation context
    "session_id": "sess-abc123",      //   - correlates all events in session
    "trace_id": "req-456",            //   - links causally-related events
    "hook": "UserPromptSubmit"        //   - hook name (when applicable)
  },

  "entity": "reminder",               // Required: entity type
  "entity_id": "rem-789",             // Required: unique instance ID
  "lifecycle": "triggered",           // Required: what happened

  "reason": "turn_cadence_met",       // Optional: explains the transition
  "state": { ... },                   // Optional: full entity state snapshot
  "metadata": { ... }                 // Optional: additional context
}
```

#### Standard Entity Types

| Entity | Lifecycle States | Description |
|--------|------------------|-------------|
| `context` | N/A | Nested diagnostic context (groups correlators) |
| `session` | started, ended | Claude session boundaries |
| `hook` | received | Hook invocations from Claude |
| `command` | received, processed | CLI/IPC requests to Supervisor |
| `task` | queued, started, completed, failed | Background work units |
| `reminder` | created, triggered, injected, dismissed | Reminder instances |
| `summary` | analyzing, updated | Session summary state |
| `statusline` | rendered, error | Status line renders |
| `transcript` | normalized, pruned | Transcript processing |

#### Example: UserPromptSubmit Hook → Task Chain (complete flow)

```json
// 1. Hook received from Claude (cli.log)
{ "source": "sidekick-cli", "pid": 12345, "time": 1678888888000,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit" },
  "entity": "hook", "entity_id": "hook-001",
  "lifecycle": "received" }

// 2. CLI dispatches command to Supervisor (cli.log)
{ "source": "sidekick-cli", "pid": 12345, "time": 1678888888100,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit" },
  "entity": "command", "entity_id": "cmd-001",
  "lifecycle": "sent", "metadata": { "command": "handle_user_prompt_submit" } }

// 3a. Supervisor enqueues session summary task (supervisor.log, same trace_id)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888888150,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit" },
  "entity": "task", "entity_id": "task-001",
  "lifecycle": "queued", "state": { "type": "session_summary" } }

// 3b. Supervisor enqueues reminder task (supervisor.log, same trace_id)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888888151,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit" },
  "entity": "task", "entity_id": "task-002",
  "lifecycle": "queued", "state": { "type": "reminder" } }

// 3c. Supervisor enqueues turn_count_tracker (supervisor.log, same trace_id)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888888150,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit" },
  "entity": "task", "entity_id": "task-003",
  "lifecycle": "queued", "state": { "type": "increment_turn_count" } }

// 4. Task activates and summary analysis begins (supervisor.log)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888888200,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit", "task_id": "task-001" },
  "entity": "summary", "entity_id": "summary-001",
  "lifecycle": "analyzing", "state": { "transcript_lines": 342 } }

// 5. Summary analysis completes (supervisor.log)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888889400,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit", "task_id": "task-001" },
  "entity": "summary", "entity_id": "summary-001",
  "lifecycle": "updated", "state": { "title": "Backend API Development", "duration_ms": 1200 } }

// 6. Reminder trigger evaluated (supervisor.log)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888889450,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit", "task_id": "task-002" },
  "entity": "reminder", "entity_id": "rem-001",
  "lifecycle": "evaluating",
  "state": { "text": "Check for memory leaks", "countdown": 0 },
  "metadata": { "condition": "hook=='UserPromptSubmit'" }
}

// 7. Reminder injected (supervisor.log)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888889500,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit", "task_id": "task-002" },
  "entity": "reminder", "entity_id": "rem-001",
  "lifecycle": "injected",
  "state": { "text": "Check for memory leaks", "countdown": 0 }
  "metadata": { "condition": "hook=='UserPromptSubmit'", "result": true }
}

// 8. Task completed (supervisor.log)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888889550,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit" },
  "entity": "task", "entity_id": "task-001",
  "lifecycle": "completed", "state": { "duration_ms": 1350 } }

// 9. Task completed (supervisor.log)
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888889600,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "hook": "UserPromptSubmit" },
  "entity": "task", "entity_id": "task-002",
  "lifecycle": "completed", "state": { "duration_ms": 150 } }
```

#### Example: Reminder Lifecycle - Passive Activation (turn cadence trigger)

Assumption: there's a supervisor event handler registered for reminders that watches turn count events.

```json
// Triggered
{ "source": "sidekick-supervisor", "pid": 12346, "time": 1678888889450,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "task_id": "task-003" },
  "entity": "reminder", "entity_id": "rem-002",
  "lifecycle": "triggered", "reason": "turn_cadence_met",
  "state": { "text": "Check for memory leaks", "countdown": 0 },
  "metadata": { "cadence": 10 }
}

// Injected into hook response
{ "source": "sidekick-cli", "pid": 12345, "time": 1678888889600,
  "context": { "session_id": "sess-001", "trace_id": "req-abc", "task_id": "task-003" },
  "entity": "reminder", "entity_id": "rem-001",
  "lifecycle": "injected" }
```

> [!NOTE]
> **Future Enhancement**: Full, combined debug log correlation will be added in a future version.

### 4.2 Transcript Correlation
- **Primary Correlator**: `context.session_id`
- **Key**: Timestamp.
- **Logic**: The UI aligns log timestamps with transcript message timestamps to show side-by-side evolution.

## 5. UI Layout (Unified Cockpit)

### 5.1 Concept
A "Unified Cockpit" design that merges the transcript and event log into a single chronological stream, maximizing context and screen real estate for state inspection.  The color theme should be "light" (with no option to switch to dark mode).

### 5.2 Layout Structure
- **Left Panel (The Stream)**: A wide, scrollable vertical stream containing:
    - **Search Bar**: A sticky header at the top of the stream to filter messages and events.
        - **Text Search**: Free-form text matches against message content and event payloads.
        - **Entity Filtering**: Use `entity:reminder`, `entity:task` syntax to show only specific entity types.
        - **Lifecycle Filtering**: Use `lifecycle:failed`, `lifecycle:triggered` to filter by state.
        - **Combined**: `entity:task lifecycle:failed` shows only failed tasks.
    - **Transcript Items**: User messages and Assistant responses in standard chat bubbles.
    - **Interleaved Events**: Entity-lifecycle event cards inserted exactly when they occurred.
        - *Visual Style*: Distinct from chat bubbles (e.g., different background color, border, or icon) to clearly separate system events from conversation.
        - *Card Content*: Shows `entity:lifecycle` (e.g., "reminder:triggered"), with `reason` as subtitle and expandable (or hover-over overlay?) `state` and `metadata` payloads.
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
1.  **Instrumentation**: Update `sidekick-core` to emit Entity-Lifecycle events (see `LLD-STRUCTURED-LOGGING.md`).
2.  **UI Scaffold**: Create React app with a log parser that understands the unified event schema.
3.  **Replay Logic**: Implement a reducer that:
    - Groups events by `session_id`
    - Builds entity state from `state` snapshots
    - Correlates causally-related events via `trace_id`
4.  **Visualization**: Build Timeline, Inspector, and entity-filter components.

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
