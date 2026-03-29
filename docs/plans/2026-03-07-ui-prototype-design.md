# UI Prototype Design v2

> Approved: 2026-03-07
> Revised: 2026-03-07 (v2 — post-prototype-testing redesign)
> Bead: sidekick-5o6r
> Branch: feat/ui-prototype
> Source: packages/sidekick-ui/docs/REQUIREMENTS.md

## Goal

Build an interactive prototype (mock data only) to validate the revised monitoring UI: a four-panel layout with Sidekick event timeline, LED-gutter transcript, and persistent detail panel.

## 1. Navigation Architecture

Four-panel layout with progressive disclosure. Panels left-to-right:

```
┌──────────────┬───────────┬─────────────────────────────┬──────────────────┐
│   Session    │  Timeline │  Transcript (with LED gutter)│   Detail Panel   │
│   Selector   │ (sidekick │                              │  (opens on click)│
│              │  events)  │                              │                  │
└──────────────┴───────────┴─────────────────────────────┴──────────────────┘
```

### Panel Behavior

**Session Selector** — Unchanged from v1. Project tree → session list. Compresses to rotated label when session selected.

**Timeline** — Sidekick events only (no transcript events). Fixed width (~240px). Does NOT compress. Clicking an event scroll-syncs and highlights the correlated event in the transcript. No other action.

**Transcript** — Full conversation plus Sidekick events inline. Has LED gutter on left showing blocking reminder state per line. When a transcript line is clicked, the detail panel opens/updates on the right and the transcript panel shrinks (but remains scrollable and clickable).

**Detail Panel** — Opens when a transcript line is clicked. Shows context-specific details + a tab for Sidekick state file snapshots. **Stays open** across clicks — just swaps content. Can be explicitly collapsed via chevron.

### Panel Resize Behavior

- Selecting a session: Selector compresses → Timeline + Transcript fill space
- Clicking transcript line: Transcript shrinks → Detail panel slides in from right
- Clicking different transcript line: Detail panel updates content (no collapse/re-expand)
- Collapsing detail panel: Transcript re-expands
- Timeline never compresses or resizes

## 2. Timeline Panel

Shows **Sidekick-only events** — things the Sidekick system did, not what the LLM/user conversation contains.

### Sidekick Event Types

| Event | Description |
|-------|-------------|
| `reminder-staged` | A reminder was staged (with reminder ID) |
| `reminder-unstaged` | A reminder was unstaged |
| `reminder-consumed` | A reminder was consumed by the LLM |
| `decision` | Sidekick made a decision (summary analysis, handler routing, etc.) |
| `session-summary-start` | Session summary analysis began |
| `session-summary-finish` | Session summary analysis completed |
| `session-title-changed` | Session title was updated |
| `intent-changed` | Latest intent was updated |
| `snarky-message-start` | Snarky/persona message generation began |
| `snarky-message-finish` | Snarky/persona message generation completed |
| `resume-message-start` | Resume message generation began |
| `resume-message-finish` | Resume message generation completed |
| `persona-selected` | Persona was selected for the session |
| `persona-changed` | Persona was changed mid-session |
| `statusline-rendered` | Statusline was rendered/updated |
| `log-error` | An error was logged by Sidekick |

### Timeline Display

- Text list with timestamp + event label (no colored dots)
- Filterable by category: Reminders, Decisions, Session Analysis, Statusline, Errors
- Click → scroll-syncs transcript to the correlated Sidekick event, highlights it, centers it in view
- No other action on click (does NOT open detail panel)

## 3. Transcript Panel

Full conversation log showing all message types, with Sidekick events interspersed at their chronological position.

### Transcript Line Types

| Type | Description |
|------|-------------|
| `user-message` | User prompt |
| `assistant-message` | Agent response (including thinking blocks) |
| `tool-use` | Tool invocation (tool name, input summary) |
| `tool-result` | Tool result (output summary) |
| `compaction` | Context compaction boundary (scissors marker) |
| Sidekick events | All timeline event types above, rendered inline but more verbose |

### LED Gutter

A column of indicator LEDs on the left margin of each transcript line, showing the **state of blocking reminders at that point in the conversation**.

**LED indicators (7 total):**

| LED | Reminder ID | Meaning when lit |
|-----|-------------|------------------|
| B | `vc-build` | Source edited, build not yet run |
| T | `vc-typecheck` | Source edited, typecheck not yet run |
| t | `vc-test` | Source edited, tests not yet run |
| L | `vc-lint` | Source edited, lint not yet run |
| V | `verify-completion` | Agent claiming completion, checks pending |
| P | `pause-and-reflect` | Tool count threshold hit |
| ■ | (confidence) | Session title confidence (red/amber/green square) |

**Visual treatment:**
- Lit: Bright colored dot/square (distinct color per LED)
- Unlit: Gray/dim dot
- Like a row of LEDs or status lights — think equipment rack indicator panel
- Approximately 50-60px wide as a gutter column
- Present on **every** transcript line — creates a visual pattern when scanning vertically
- Non-blocking reminders (remember-your-persona, user-prompt-submit, etc.) are NOT shown as LEDs but still appear as Sidekick events in the transcript when staged/consumed

**Color key:** Small, unobtrusive legend somewhere on the page (perhaps collapsible in the transcript header area).

### Transcript Interaction

- Clicking a line → opens/updates detail panel on right, transcript shrinks but stays usable
- Search bar at top filters transcript content
- Sidekick events rendered inline with more detail than the timeline (e.g., reminder content, decision reasoning)

## 4. Detail Panel

Opens on transcript line click. Persists across clicks (just swaps content).

### Tabs

1. **Details** — Context-specific content based on what was clicked:
   - User/assistant message: Full content, metadata (tokens, model, cost)
   - Tool use: Tool name, full input params, duration
   - Tool result: Full output
   - Sidekick event: Full event details (varies by type)
   - Compaction: Segment info, token counts before/after

2. **State** — Sidekick state file snapshots at that point in time:
   - `session-summary.json` (title, confidence, intent, pivot detection)
   - `session-persona.json`
   - `snarky-message.json`, `resume-message.json`
   - `transcript-metrics.json`, `llm-metrics.json`
   - `cli-log-metrics.json`, `daemon-log-metrics.json`
   - `summary-countdown.json`
   - Rendered as formatted JSON with collapsible sections

### Detail Panel Behavior

- Opens when any transcript line is clicked
- Stays open when clicking a different transcript line (content swaps)
- Can be collapsed via chevron (transcript re-expands)
- Prev/Next navigation buttons to step through transcript lines

## 5. Summary Strip

Compact horizontal bar at the top of the dashboard area (spans Timeline + Transcript + Detail).

Session vitals:
- Active persona (name + icon)
- Current intent + confidence indicator
- Context window utilization (progress bar)
- Token count / cost
- Duration
- Session status (LIVE / HISTORY)
- Dark mode toggle

## 6. Component Architecture

```
App
├── SessionSelector              (depth 1, full or compressed)
│   ├── ProjectGroup             (project name + session list)
│   └── CompressedLabel          (rotated text when collapsed)
├── DashboardArea                (spans remaining width)
│   ├── SummaryStrip             (persona, intent, cost, duration)
│   ├── ContentArea              (flex row below strip)
│   │   ├── Timeline             (fixed ~240px, Sidekick events only)
│   │   │   ├── TimelineFilterBar (category filter toggles)
│   │   │   └── TimelineEvent    (timestamp + label, no dots)
│   │   ├── Transcript           (flex-1, shrinks when detail open)
│   │   │   ├── SearchBar        (text search)
│   │   │   ├── LEDGutter        (indicator column per line)
│   │   │   ├── TranscriptLine   (user/assistant/tool/sidekick cards)
│   │   │   └── CompactionMarker (scissors boundary)
│   │   └── DetailPanel          (slides in from right on click)
│   │       ├── DetailHeader     (title + prev/next + close)
│   │       ├── DetailsTab       (context-specific content)
│   │       └── StateTab         (state file JSON snapshots)
│   └── LEDColorKey              (small legend, collapsible)
└── NavigationManager            (controls panel widths/transitions)
```

## 7. Technical Decisions

- **State management:** React context + `useReducer`. No external library.
- **Styling:** Tailwind CSS. Light default + dark mode (`dark:` variants + toggle).
- **Data:** Mock/synthetic only. Must include realistic reminder lifecycle data to exercise LED gutter.
- **Animation:** CSS transitions only. No animation library.
- **Stack:** React 18 + Vite + TypeScript + Tailwind (existing package infrastructure).

## 8. Mock Data Requirements

- 2 projects with distinct character ("sidekick" and "webapp")
- 5-6 sessions across projects
- Rich Sidekick event data: reminder staged/consumed lifecycles, decisions, session analysis, persona changes, statusline renders
- Full transcript data: user messages, assistant messages (with thinking), tool use/results, compaction boundaries
- Blocking reminder state transitions that exercise the LED gutter (e.g., vc-build lights up after an edit, goes dark after build runs)
- Confidence values varying across sessions (0.3 to 0.95)
- State file snapshots at multiple points per session
- At least one session with a compaction boundary

## 9. Open Questions to Resolve via Prototype

1. **LED gutter readability** — are 7 indicators too dense? Is the per-line pattern scannable?
2. **LED in timeline** — a super-compact (10-12px wide) version of the LED strip in the timeline panel? File under "maybe later" unless prototyping reveals it's needed.
3. **Transcript density** — with Sidekick events inline, does the transcript feel too busy?
4. **Detail panel width** — what's the right split between transcript and detail when detail is open?
5. **State tab usefulness** — are raw JSON state files useful, or do we need a diff/changelog view?

## 10. Changes from v1

| Aspect | v1 (prototype tested) | v2 (this revision) |
|--------|----------------------|---------------------|
| Timeline content | All events (user, tool, hook, etc.) with colored dots | Sidekick events only, text list, no dots |
| Transcript | Chat bubbles, no state indicators | Full conversation + LED gutter showing blocking reminder state |
| Detail trigger | Click timeline event | Click transcript line |
| Detail behavior | Dashboard compresses to dots rail | Transcript shrinks, timeline unchanged |
| Panel count | 3 (selector, dashboard, detail) | 4 (selector, timeline, transcript, detail) |
| LED indicators | None | 6 reminder + 1 confidence per transcript line |
| State inspection | JSON in detail panel | Dedicated "State" tab in detail panel |

## 11. Prior Implementation

The v1 prototype is the current code on this branch. It validates the core accordion mechanics, dark mode, focus filters, and component rendering. The v2 redesign reuses the session selector, summary strip, and much of the styling — but restructures the dashboard into separate timeline and transcript panels with the LED gutter concept.

The pre-prototype implementation was removed in the `.archive/` cleanup (git history preserves it).
