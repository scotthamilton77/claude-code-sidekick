# UI Prototype Design

> Approved: 2026-03-07
> Bead: sidekick-5o6r
> Branch: feat/ui-prototype
> Source: packages/sidekick-ui/docs/REQUIREMENTS.md

## Goal

Build an interactive prototype (mock data only) to validate the progressive disclosure navigation model and key UX decisions before full implementation.

## 1. Navigation Architecture

Three-depth progressive disclosure with accordion compression.

### Navigation States

**State 1 — Session Selector (full width):**
Project tree with sessions grouped by project. Each session shows title, date, branch.

**State 2 — Session Dashboard (selector compressed left):**
Selector compresses to a narrow strip (~32-40px) with 90-degree CCW rotated text reading bottom-to-top: "Project A / Auth Bug Investigation". Dashboard expands to fill remaining width.

**State 3 — Detail Panel (dashboard compressed, detail expands right):**
Dashboard compresses to timeline-rail-only view with rotated label. Detail panel expands on the right showing context-sensitive content.

### Compression Behavior

- Compressed panels collapse to ~32-40px width showing rotated 90-degree CCW text (read bottom-to-top).
- Compressed label format: `"Project A / Auth Bug Investigation"` (session selector) or `"Auth Bug Investigation — 10:02 AM"` (dashboard).
- Each panel has a collapse/expand chevron **in its title/header bar** (not floating on borders).
- Expanding a panel compresses its rightward neighbor(s).
- Collapsing a panel expands its leftward neighbor.
- Clicking the compressed panel's rotated text also re-expands it (same as clicking the expand chevron).
- Transition: CSS `transition` on `width`/`flex-basis` (~200ms ease-out).
- Panel content is reactive to width — compressed panels show only the rotated label; expanded panels render full content.

### Detail Panel Navigation

Prev/Next arrow buttons in the detail header to step through timeline events without closing the panel. Compressed timeline rail and transcript track position in sync.

## 2. Session Dashboard Layout

When a session is selected, the dashboard has three zones:

### Summary Strip (top bar)

Compact horizontal bar with session vitals:
- Active persona (name + icon)
- Current intent + confidence indicator
- Token count / cost
- Duration
- Session status (live/historical)

### Two-Column Split (below strip)

**Left — Timeline:**
- Vertical event rail with colored dots by type
- Focus filter toggles at top (composable, DP-3)
- Compaction boundary markers (scissors icon)
- Click event to open detail panel

**Right — Transcript:**
- Chat-bubble format (user/assistant/tool/system)
- Search/filter bar at top
- Events highlighted in sync with timeline selection

### Time Correlation (DP-2)

Selecting an event in either panel highlights the corresponding item in the other. Scrolling syncs bidirectionally.

### Focus Filters (DP-3)

Composable toggles (multiple active simultaneously). Unfiltered events dim to 20% opacity rather than disappearing, preserving temporal context.

### Confidence Visualization (DP-5)

Color-coded dot on summary/state events: green (>0.8), amber (0.5-0.8), red (<0.5).

## 3. Detail Panel

Context-sensitive content based on event type:

| Event Type | Detail View |
|---|---|
| State/Summary | JSON tree with Raw/Diff toggle, confidence indicators |
| Tool use | Tool name, input params, output/result, duration |
| Decision | Category, reasoning chain, impact |
| Reminder | Lifecycle state, hook target, blocking flag, priority |
| Transcript | Full message with metadata (tokens, model, cost) |

## 4. Component Architecture

```
App
+-- SessionSelector          (depth 1, full or compressed)
|   +-- ProjectGroup         (project name + session list)
|   +-- CompressedLabel      (rotated text when collapsed)
+-- SessionDashboard         (depth 2, full or compressed)
|   +-- SummaryStrip         (persona, intent, cost, duration)
|   +-- Timeline             (vertical event rail + focus filters)
|   |   +-- FocusFilterBar   (composable toggle buttons)
|   |   +-- TimelineEvent    (colored dot + label + confidence)
|   |   +-- CompactionMarker (scissors boundary)
|   +-- Transcript           (chat bubbles + search/filter)
|   |   +-- TranscriptEvent  (user/assistant/tool/system cards)
|   |   +-- SearchFilterBar  (text search + kind filters)
|   +-- CompressedTimeline   (dots-only rail when collapsed)
+-- DetailPanel              (depth 3)
|   +-- DetailHeader         (title + prev/next + collapse chevron)
|   +-- StateInspector       (JSON tree, raw/diff)
|   +-- ToolDetail           (params, result, duration)
|   +-- DecisionDetail       (category, reasoning)
|   +-- ReminderDetail       (lifecycle, hook, priority)
+-- NavigationManager        (controls panel widths/transitions)
```

## 5. Technical Decisions

- **State management:** React context + `useReducer`. No external library.
- **Styling:** Tailwind CSS. Light default + dark mode (`dark:` variants + toggle).
- **Data:** Mock/synthetic only. Realistic density: 2 projects, 5-6 sessions, 20-40 events per session.
- **Animation:** CSS transitions only. No animation library.
- **Stack:** React 18 + Vite + TypeScript + Tailwind (existing package infrastructure).

## 6. Mock Data Requirements

- 2 projects with distinct character (e.g., "sidekick" and "webapp")
- 5-6 sessions across projects
- 20-40 events per session including: hook events, transcript events, decisions, state changes, reminders, LLM calls, compaction boundaries, persona changes
- Confidence values varying across sessions to test visualization
- At least one session with a compaction boundary

## 7. Prior Implementation

The previous UI implementation is archived at `packages/sidekick-ui/.archive/` for reference. It contains working examples of event adapters, log parsers, state inspection, and replay engine — all wired to real data. The architecture has changed, but individual utilities may be worth consulting.

## 8. Open Questions to Resolve via Prototype

These are intentionally left as experiments:

1. **Focus filters composability** — do multiple active filters confuse or empower?
2. **Confidence dot vs sparkline** — is the simple dot sufficient at realistic density?
3. **Compression animation timing** — 200ms right, or too fast/slow?
4. **Rotated text readability** — does bottom-to-top 90-degree text work at narrow widths?
