# Sidekick UI — Consolidated Requirements

> Consolidated from Phase 1 analysis (sidekick-n4lx.1, n4lx.2, n4lx.3).
> Supersedes MONITORING-UI.md as the authoritative requirements source.
> Status: **Approved** (2026-03-07)

## 1. Purpose & Users

**Primary user**: Developer (project author) debugging sidekick internals — understanding why sidekick made specific decisions, how hooks fired, how reminders were staged/consumed, and what the LLM saw.

**Secondary uses**: Real-time session monitoring, demos.

**Use pattern**: Occasional deep-dive forensic tool, not a daily dashboard. Optimized for **depth over glanceability**.

**Primary use cases**:
- Post-session forensics: walk through transcript and sidekick decision history
- Real-time monitoring: observe an active session's events as they occur

## 2. Design Principles

### DP-1: Timeline is the Spine
All events (LLM calls, persona changes, reminders, session summaries, hook executions, log entries) anchor to a single chronological timeline. The timeline is the primary navigation and orientation artifact.

### DP-2: Time-Correlated Linked Views
Focusing on a timestamp in any panel (logs, transcript, state inspector, detail overlay) syncs all other visible panels to that moment. Every view is temporally linked.

### DP-3: Focus Filters
The timeline supports emphasis modes that highlight specific event types (hook events, reminder lifecycle, session summary events, LLM calls). Whether these filters are mutually exclusive or composable is TBD via prototyping.

### DP-4: Progressive Drill-Down
The dashboard shows summary-level indicators (task queue count, active persona, context window %). Detail is accessed via overlays or panels that expand rightward, following the compression pattern (see Navigation Model).

### DP-5: Confidence as Visual Signal
Session summary confidence is communicated directly on timeline events (via color coding, icons, or sparkline indicators) rather than in a separate panel. Exact treatment TBD via prototyping.

## 3. Navigation Model

**Left-to-right progressive disclosure**:

```
[Projects/Sessions] → [Session Dashboard] → [Detail Panel]
```

1. The UI opens to a project/session selector
2. Selecting a session compresses the selector leftward, expanding the session dashboard
3. Selecting an item of interest on the dashboard compresses it, revealing a detail panel on the right
4. Dismissing the detail panel restores the dashboard view

This pattern supports focused forensic drilling without losing context of where you are.

## 4. Core Features

All 9 original features are retained, with modifications noted.

### F-1: Compaction-Aware Time Travel
Segment navigation at compaction boundaries (scissors icon markers), metrics continuity across segments, snapshot viewer for pre-compact state.

### F-2: Log-Based Replay Engine
Ingest NDJSON logs (cli.log, sidekickd.log), filter by sessionId, merge by timestamp, build state timeline, scrub via timeline control.

### F-3: Session Timeline
Chronological event stream interleaving transcript messages, hook executions, reminder lifecycle events, decision events, state changes, statusline calls, errors, LLM calls, persona changes. Supports focus filters (DP-3).

### F-4: Transcript Viewer
Chat bubble format, time-synced with timeline scrubbing. Scrolls/centers when timeline position changes (DP-2).

### F-5: State Inspector
JSON tree view of session state files (under `.sidekick/sessions/{sessionId}/**`) at selected timestamp. Raw view + diff view (git-style). Read-only.

### F-6: Decision Log
Filtered view of Decision events showing sidekick's reasoning chain. Accessible as a focus filter on the timeline.

### F-7: System Health Dashboard
Daemon uptime, memory (heap/RSS) sparklines, queue depth, active task count, offline detection (30s mtime threshold). Restart history, memory leak detection.

### F-8: Search/Filter Bar
Text search + kind + type + hook filters. Combined filter expressions.

### F-9: Live Mode
Auto-follow new events as they arrive. File watching or polling — implementation favors simplicity and minimal code.

## 5. Architecture Gap Coverage

### G-1: Persona System
- **MVP**: Display active persona at any point in time (from session state files). Show persona change events and trait injection events on the timeline.
- **Future** (sidekick-qubi, P4): Force persona change on active session from UI; re-run snarky-comment LLM call with different persona.

### G-2: Task Engine
- **Dashboard**: Show queued/executing task count as summary indicator.
- **Detail**: Task list with status, type, and execution details accessible via drill-in panel.

### G-3: Provider/Telemetry
- **Timeline**: LLM calls appear as timeline events with detail drill-in (model, tokens, cost, latency, retries).
- **Future** (sidekick-ueyc, P3): Usage reports filterable by project, session, provider, model.

### G-4: Configuration Cascade
- **Future** (sidekick-dqw5, P4): Inspector showing resolved config with layer attribution (which of 7 layers each value came from).

### G-5: Session Summary Enhancements
- Confidence trends visualized on timeline events (DP-5). Exact treatment (color, icon, sparkline, alternative timeline view) TBD via prototyping.
- Detail drill-in for any session summary analysis event showing full analysis results.

### G-6: Reminder System
- Full reminder lifecycle on timeline (staged → consumed → deleted).
- Supports focus filters (DP-3) to emphasize reminder events.
- Click timeline event to zoom in, seeing surrounding transcript context.
- Detail view shows classifier reasoning, cadence, and impact.

### G-7: Transcript Metrics
- Context window utilization over time (the key metric for this category).

### G-8: Structured Logging
- Log viewer as detail panel.
- Time-correlated with timeline (DP-2): scrolling logs syncs timeline/transcript position and vice versa.

### G-9: Daemon Health
- Restart history, memory leak detection (beyond original system health dashboard).

### G-10: Statusline
- Rendering history along the timeline.

## 6. Design Constraints

| Constraint | Decision |
|---|---|
| Theme | Light default + dark mode |
| Data source | File-based: watch `.sidekick/sessions/{sessionId}/**` and log files |
| Platform | Local SPA, browser-based |
| Stack | React + Vite + TailwindCSS (TypeScript) |
| Mutability | Read-only (no state mutation from UI) |
| Real-time updates | File watching or polling — favor simplicity |
| Prototype-first | Build interactive prototype (not wired to real data) to validate UX before implementation |

## 7. Non-Goals

- State mutation from UI (no write operations)
- Multi-user or remote access
- Database backend
- WebSocket server (file watching/polling sufficient)

## 8. Open Questions (for Prototyping)

- **Focus filters**: Mutually exclusive or composable? How do combined filters render?
- **Confidence visualization**: Color-coded timeline events? Inline sparkline? Separate gutter track?
- **Drill-down compression**: Animation/transition behavior when panels compress leftward?
- **Session selector**: Tree view? List with search? Grouped by project?

## 9. Traceability

| Source | Issue | Status |
|---|---|---|
| Original requirements mined | sidekick-n4lx.1 | Closed |
| Architecture gaps identified | sidekick-n4lx.2 | Closed |
| User validation session | sidekick-n4lx.3 | Closed |
| Future: force persona change | sidekick-qubi | Open (P4) |
| Future: LLM usage reports | sidekick-ueyc | Open (P3) |
| Future: config cascade inspector | sidekick-dqw5 | Open (P4) |
