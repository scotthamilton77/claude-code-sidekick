# UI Prototype Implementation Plan v2

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Revise the existing prototype to validate the four-panel layout with Sidekick-only timeline, LED-gutter transcript, and persistent detail panel.

**Architecture:** Four-panel layout (SessionSelector | Timeline | Transcript+LEDs | DetailPanel). React context + useReducer for navigation state. All data is synthetic mock data.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite, lucide-react (icons)

**Worktree:** `.worktrees/feat-ui-prototype` (branch: `feat/ui-prototype`)

**Design doc:** `docs/plans/2026-03-07-ui-prototype-design.md` (v2)

**v1 prototype:** Current code on this branch — reuse session selector, summary strip, dark mode, styling patterns.

---

### Task 1: Revise Types

Update the type system to reflect the new event model: separate Sidekick events from transcript events, add LED state, add state file snapshots.

**Files:**
- Modify: `packages/sidekick-ui/src/types.ts`

**Changes:**

1. Define `SidekickEventType` — the 16 Sidekick-specific event types (reminder-staged, reminder-unstaged, reminder-consumed, decision, session-summary-start, session-summary-finish, session-title-changed, intent-changed, snarky-message-start, snarky-message-finish, resume-message-start, resume-message-finish, persona-selected, persona-changed, statusline-rendered, log-error).

2. Define `TranscriptLineType` — user-message, assistant-message, tool-use, tool-result, compaction, plus all SidekickEventType values (Sidekick events appear inline in transcript).

3. Define `TranscriptLine` interface — id, timestamp, type, content fields varying by type. For assistant messages, include a `thinking` field. For tool-use, include toolName/input/duration. For tool-result, include output. For Sidekick events, include event-specific fields.

4. Define `SidekickEvent` interface — id, timestamp, type (SidekickEventType), label, detail fields. References the corresponding TranscriptLine ID for scroll-sync.

5. Define `LEDState` interface — per-line snapshot of blocking reminder states:
   ```typescript
   interface LEDState {
     vcBuild: boolean
     vcTypecheck: boolean
     vcTest: boolean
     vcLint: boolean
     verifyCompletion: boolean
     pauseAndReflect: boolean
     titleConfidence: 'red' | 'amber' | 'green'
   }
   ```

6. Define `StateSnapshot` interface — represents Sidekick state files at a point in time:
   ```typescript
   interface StateSnapshot {
     timestamp: number
     sessionSummary?: Record<string, unknown>
     sessionPersona?: Record<string, unknown>
     snarkyMessage?: Record<string, unknown>
     resumeMessage?: Record<string, unknown>
     transcriptMetrics?: Record<string, unknown>
     llmMetrics?: Record<string, unknown>
     summaryCountdown?: Record<string, unknown>
   }
   ```

7. Update `Session` to include: `transcriptLines: TranscriptLine[]`, `sideKickEvents: SidekickEvent[]`, `ledStates: Map<string, LEDState>` (keyed by transcript line ID), `stateSnapshots: StateSnapshot[]`.

8. Define `TimelineFilter` — reminders, decisions, session-analysis, statusline, errors.

9. Update `NavigationState` — remove old filter types, add `selectedTranscriptLineId`, `timelineFilters`.

**Commit:**
```
refactor(ui): revise types for v2 four-panel layout
```

---

### Task 2: Revise Mock Data

Rewrite mock data to exercise the new model: separate Sidekick events, full transcript lines, LED state per line, state file snapshots.

**Files:**
- Modify: `packages/sidekick-ui/src/data/mock-data.ts`

**Requirements:**

1. Each session needs both `transcriptLines` (full conversation) and `sidekickEvents` (Sidekick-only, referencing transcript line IDs for sync).

2. LED states computed per transcript line. Example lifecycle:
   - Lines 1-10: all LEDs off, confidence green
   - Line 11 (tool-use: Edit file): `vcBuild`, `vcTypecheck`, `vcTest`, `vcLint` light up
   - Lines 12-20: LEDs stay lit
   - Line 21 (tool-use: Bash `pnpm test`): `vcTest` goes dark
   - Line 22 (tool-use: Bash `pnpm build`): `vcBuild` goes dark
   - etc.

3. State snapshots at key points (after session summary runs, after persona change, after intent update).

4. At least one session with `pause-and-reflect` firing (many tool calls in a row).

5. At least one session with `verify-completion` firing (agent claims "done" before running checks).

6. Reuse session metadata from v1 (project names, session titles, branches) but restructure event data.

**Commit:**
```
refactor(ui): revise mock data for v2 transcript and LED model
```

---

### Task 3: Revise Navigation State

Update useReducer to handle the new four-panel model.

**Files:**
- Modify: `packages/sidekick-ui/src/hooks/useNavigation.ts`

**Changes:**

1. New actions:
   - `SELECT_TRANSCRIPT_LINE` — opens/updates detail panel, shrinks transcript
   - `CLOSE_DETAIL` — collapses detail panel, transcript re-expands
   - `SYNC_TO_TIMELINE_EVENT` — scrolls transcript to correlated event (no panel change)
   - `TOGGLE_TIMELINE_FILTER` — toggle timeline category filter
   - Remove old `SELECT_EVENT`, `DESELECT_EVENT`, `TOGGLE_DETAIL_PANEL` actions
   - Keep `SELECT_SESSION`, `BACK_TO_SELECTOR`, `TOGGLE_SELECTOR_PANEL`, `SET_SEARCH`, `TOGGLE_DARK_MODE`

2. State changes:
   - `selectedTranscriptLineId` replaces `selectedEventId`
   - `timelineFilters: Set<TimelineFilter>` replaces `activeFilters: Set<FocusFilter>`
   - `detailPanel.expanded` is true when any transcript line is selected
   - Timeline panel has no expand/collapse state (always visible when session selected)

3. Panel resize logic:
   - Session selected: selector compresses, timeline+transcript fill space
   - Transcript line clicked: transcript shrinks (e.g., from `flex-[3]` to `flex-[2]`), detail gets `flex-[2]`
   - Detail closed: transcript re-expands to `flex-[3]`, detail gets `w-0`
   - Timeline stays at fixed width always

**Commit:**
```
refactor(ui): update navigation state for v2 panel model
```

---

### Task 4: Timeline Panel (Sidekick Events Only)

Replace the old timeline (all events with colored dots) with a Sidekick-only event list.

**Files:**
- Rewrite: `packages/sidekick-ui/src/components/timeline/Timeline.tsx`
- Rewrite: `packages/sidekick-ui/src/components/timeline/TimelineEvent.tsx`
- Rewrite: `packages/sidekick-ui/src/components/timeline/FocusFilterBar.tsx` → rename to `TimelineFilterBar.tsx`
- Delete: `packages/sidekick-ui/src/components/timeline/CompactionMarker.tsx` (moves to transcript)

**Timeline display:**
- Text list: timestamp (HH:MM:SS) + event label
- No colored dots
- Category filter bar at top: Reminders | Decisions | Session Analysis | Statusline | Errors
- Filtered events dim to 20% (same pattern as v1)
- Click event → dispatches `SYNC_TO_TIMELINE_EVENT` (scroll-syncs transcript, highlights correlated line)
- Selected/synced event gets subtle highlight

**Commit:**
```
refactor(ui): rewrite Timeline for Sidekick-only events
```

---

### Task 5: LED Gutter Component

New component: a column of 7 indicator LEDs rendered per transcript line.

**Files:**
- Create: `packages/sidekick-ui/src/components/transcript/LEDGutter.tsx`
- Create: `packages/sidekick-ui/src/components/transcript/LEDColorKey.tsx`

**LEDGutter.tsx:**
- Receives `LEDState` for the current line
- Renders 7 indicators in a tight vertical or horizontal strip (~50-60px wide)
- Lit = bright colored circle/square, Unlit = gray circle/square
- Colors: B=blue, T=cyan, t=green, L=amber, V=red, P=orange, ■=red/amber/green
- Each LED is small (6-8px) with minimal spacing
- Must align vertically across transcript lines to create scannable columns

**LEDColorKey.tsx:**
- Small legend mapping LED colors to meanings
- Collapsible/toggleable — doesn't take much space
- Position: transcript header area or floating tooltip

**Commit:**
```
feat(ui): add LED gutter component with color key
```

---

### Task 6: Transcript Panel (Revised)

Rewrite the transcript to show full conversation + Sidekick events inline, with LED gutter.

**Files:**
- Rewrite: `packages/sidekick-ui/src/components/transcript/Transcript.tsx`
- Rewrite: `packages/sidekick-ui/src/components/transcript/TranscriptEvent.tsx` → rename to `TranscriptLine.tsx`
- Keep: `packages/sidekick-ui/src/components/transcript/SearchFilterBar.tsx`
- Move: CompactionMarker rendering into transcript

**Transcript layout:**
```
┌─────────┬──────────────────────────────────┐
│ LED     │  Transcript content              │
│ gutter  │                                  │
│ (50px)  │  [search bar]                    │
│         │  [transcript lines...]           │
│ B T t L │                                  │
│ V P ■   │                                  │
└─────────┴──────────────────────────────────┘
```

**TranscriptLine types:**
- `user-message`: User icon + content
- `assistant-message`: Assistant icon + content + thinking block (collapsible)
- `tool-use`: Tool icon + name + input summary + duration
- `tool-result`: Indented result content
- `compaction`: Scissors divider with segment info
- Sidekick events: Rendered inline with type-specific detail (more verbose than timeline)

**Interaction:**
- Click any line → dispatches `SELECT_TRANSCRIPT_LINE` → detail panel opens/updates
- Selected line gets highlight ring
- `scrollToLineId` prop for timeline sync (smooth scroll + center)
- Search filters across all line types

**Commit:**
```
refactor(ui): rewrite Transcript with LED gutter and inline Sidekick events
```

---

### Task 7: Detail Panel (Revised)

Rewrite the detail panel for the new model: opens on transcript click, has Details + State tabs.

**Files:**
- Rewrite: `packages/sidekick-ui/src/components/detail/DetailPanel.tsx`
- Rewrite: `packages/sidekick-ui/src/components/detail/DetailHeader.tsx`
- Create: `packages/sidekick-ui/src/components/detail/StateTab.tsx`
- Keep/modify: existing detail view components (ToolDetail, DecisionDetail, etc.)
- Delete: `packages/sidekick-ui/src/components/detail/TranscriptDetail.tsx` (merged into general detail views)

**DetailPanel changes:**
- Two tabs: **Details** and **State**
- Details tab: context-specific content based on clicked transcript line type
- State tab: formatted JSON display of state file snapshots at that timestamp
  - Collapsible sections per state file
  - Shows the snapshot closest to (but not after) the selected line's timestamp
- Prev/Next buttons step through transcript lines (not just Sidekick events)
- Panel stays open across clicks — only collapses via explicit chevron

**DetailHeader changes:**
- Shows line type badge + label/content summary
- Prev/Next with "N / M" counter (counts all transcript lines)
- Close (X) button
- Tab switcher: Details | State

**StateTab.tsx:**
- Receives array of `StateSnapshot` and current timestamp
- Finds the most recent snapshot at or before the selected line
- Renders each state file as a collapsible JSON section
- Highlights fields that changed from the previous snapshot (optional, stretch goal)

**Commit:**
```
refactor(ui): revise DetailPanel with Details/State tabs
```

---

### Task 8: Dashboard Layout (Revised App Shell)

Rewire the App shell for the four-panel layout.

**Files:**
- Rewrite: `packages/sidekick-ui/src/App.tsx`
- Modify: `packages/sidekick-ui/src/components/SessionDashboard.tsx` → potentially split into DashboardArea or inline in App

**Layout:**
```tsx
<div className="h-screen flex">
  {/* Session Selector — compresses to label */}
  <div className={selectorExpanded ? 'flex-1' : 'w-10'}>
    <SessionSelector />
  </div>

  {/* Dashboard Area — visible when session selected */}
  {selectedSession && (
    <div className="flex-1 flex flex-col">
      <SummaryStrip session={selectedSession} />
      <div className="flex-1 flex overflow-hidden">
        {/* Timeline — fixed width, never compresses */}
        <div className="w-60 flex-shrink-0 border-r">
          <Timeline events={selectedSession.sidekickEvents} />
        </div>

        {/* Transcript — shrinks when detail open */}
        <div className={detailOpen ? 'flex-[2]' : 'flex-[3]'}>
          <Transcript
            lines={selectedSession.transcriptLines}
            ledStates={selectedSession.ledStates}
            scrollToLineId={syncedLineId}
          />
        </div>

        {/* Detail Panel — slides in on transcript click */}
        {detailOpen && (
          <div className="flex-[2] border-l">
            <DetailPanel
              line={selectedLine}
              stateSnapshots={selectedSession.stateSnapshots}
            />
          </div>
        )}
      </div>
    </div>
  )}
</div>
```

**Keyboard navigation:**
- `Escape`: close detail panel → if no detail, back to selector
- `ArrowUp` / `ArrowDown`: prev/next transcript line when detail is open

**Commit:**
```
refactor(ui): rewire App shell for v2 four-panel layout
```

---

### Task 9: Polish and Verify

Final pass — visual cleanup, ensure all interactions work, verify build.

**Files:**
- Potentially modify any component for visual fixes

**Steps:**

1. Verify all interactions:
   - Session selection → timeline + transcript appear
   - Timeline click → transcript scrolls to correlated event
   - Transcript click → detail panel opens with correct content
   - Click different transcript line → detail swaps (no collapse/re-expand)
   - Detail close → transcript re-expands
   - LED gutter shows correct state per line
   - State tab shows snapshots
   - Dark mode works across all new components
   - Search filters transcript
   - Timeline filters dim non-matching events

2. Verify LED gutter visual quality:
   - LEDs align vertically across lines (scannable columns)
   - Lit/unlit states are clearly distinguishable
   - Color key is accessible but unobtrusive

3. Run build verification:
   ```bash
   cd packages/sidekick-ui && npx tsc --noEmit && npx vite build
   ```

4. Test with Playwright browser (take screenshots for review)

**Commit:**
```
feat(ui): v2 prototype polish and verification
```

---

## Execution Notes

- **All paths are relative to the worktree root:** `.worktrees/feat-ui-prototype/`
- **Reuse v1 code where possible:** SessionSelector, CompressedLabel, PanelHeader, SummaryStrip, dark mode infrastructure, CSS utilities are all reusable.
- **No tests required** — this is a UX validation prototype.
- **Use `@` alias** for imports: `import { Foo } from '@/components/Foo'`
- **lucide-react** is already a dependency — use it for all icons
- **Commit after each task** — atomic commits on `feat/ui-prototype` branch
- **v1 prototype code** is the starting point — refactor, don't rebuild from scratch
