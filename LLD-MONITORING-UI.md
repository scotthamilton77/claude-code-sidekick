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
The UI runs locally and reads files directly from the project's `.sidekick` directory.

```mermaid
graph TD
    UI[Monitoring UI (React)] -->|Reads| LogFile[.sidekick/logs/sidekick.log]
    UI -->|Reads| Transcript[Transcript File]
    UI -->|Reads| StateFiles[.sidekick/state/*.json]
    
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
    1.  The UI ingests `sidekick.log` (NDJSON).
    2.  It filters for `event_type="state_change"` and `event_type="decision"`.
    3.  It builds an in-memory timeline of state snapshots.
    4.  The user can scrub a timeline slider to "rewind" the state.

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
- **Scope**: Shows `summary.json`, `status.json`, `reminders.json`, etc.
- **Diff Mode**: Highlights what changed between the previous and current state.

#### D. Decision Log
A filtered view of "Decision" events to see the system's reasoning chain.
- Example: `[Decision] Session Title Change: Updated session title to "My Session"`

## 4. Data Sources & Schema

### 4.1 Log Schema Enhancements
To support reconstruction, `sidekick-core` must emit specific events.

#### Decision Event
```json
{
  "level": 30,
  "time": 1678888888888,
  "event_type": "decision",
  "component": "session-summary",
  "decision": "update_summary",
  "reason": "tool_count_threshold_exceeded",
  "metadata": {
    "current_tools": 5,
    "threshold": 10
  }
}
```

#### State Change Event
```json
{
  "level": 30,
  "time": 1678888888888,
  "event_type": "state_change",
  "file": "summary.json",
  "operation": "update", // or "snapshot"
  "payload": { ... } // The new state or a diff
}
```

### 4.2 Transcript Correlation
- **Primary Correlator**: session ID
- **Key**: Timestamp.
- **Logic**: The UI aligns log timestamps with transcript message timestamps to show side-by-side evolution.

## 5. UI Layout (Unified Cockpit)

### 5.1 Concept
A "Unified Cockpit" design that merges the transcript and event log into a single chronological stream, maximizing context and screen real estate for state inspection.  The color theme should be "light" (with no option to switch to dark mode).

### 5.2 Layout Structure
- **Left Panel (The Stream)**: A wide, scrollable vertical stream containing:
    - **Search Bar**: A sticky header at the top of the stream to filter messages and events by text content.
    - **Transcript Items**: User messages and Assistant responses in standard chat bubbles.
    - **Interleaved Events**: "Decision" cards and "State Change" markers inserted exactly when they occurred.
        - *Visual Style*: Distinct from chat bubbles (e.g., different background color, border, or icon) to clearly separate system actions from conversation.
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
1.  **Instrumentation**: Update `sidekick-core` to emit `decision` and `state_change` logs.
2.  **UI Scaffold**: Create React app with a log parser.
3.  **Replay Logic**: Implement the reducer that takes a stream of logs and computes state.
4.  **Visualization**: Build the Timeline and Inspector components.

## 7. UI Mockups

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
