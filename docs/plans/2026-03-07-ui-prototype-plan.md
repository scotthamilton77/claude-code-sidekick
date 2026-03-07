# UI Prototype Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build an interactive prototype with mock data to validate the progressive disclosure navigation model described in `docs/plans/2026-03-07-ui-prototype-design.md`.

**Architecture:** Three-depth accordion navigation (SessionSelector -> SessionDashboard -> DetailPanel) with compressed panels showing rotated 90-degree CCW text. React context + useReducer for navigation state. All data is synthetic mock data.

**Tech Stack:** React 18, TypeScript, Tailwind CSS, Vite, lucide-react (icons)

**Worktree:** `.worktrees/feat-ui-prototype` (branch: `feat/ui-prototype`)

**Design doc:** `docs/plans/2026-03-07-ui-prototype-design.md`

**Archived prior implementation:** `packages/sidekick-ui/.archive/` (reference only)

---

### Task 1: Fix Build Infrastructure

The archived server code broke the vite config. Fix it so the dev server starts clean.

**Files:**
- Modify: `packages/sidekick-ui/vite.config.ts`
- Modify: `packages/sidekick-ui/src/index.css`
- Create: `packages/sidekick-ui/src/App.tsx` (minimal placeholder)

**Step 1: Update vite.config.ts — remove server plugin reference**

```typescript
import react from '@vitejs/plugin-react'
import path from 'path'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
```

**Step 2: Clean up index.css — remove old timeline slider styles**

Keep only the base Tailwind directives, full-height setup, custom scrollbar, and add the rotated text utility:

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

html, body, #root {
  height: 100%;
  margin: 0;
  padding: 0;
}

::-webkit-scrollbar { width: 6px; height: 6px; }
::-webkit-scrollbar-track { background: #f1f5f9; }
::-webkit-scrollbar-thumb { background: #cbd5e1; border-radius: 3px; }
::-webkit-scrollbar-thumb:hover { background: #94a3b8; }

/* Rotated text for compressed panels — reads bottom-to-top */
.text-vertical {
  writing-mode: vertical-rl;
  transform: rotate(180deg);
  white-space: nowrap;
}

/* Panel transition */
.panel-transition {
  transition: flex-basis 200ms ease-out, width 200ms ease-out, opacity 150ms ease-out;
}
```

**Step 3: Create minimal App.tsx placeholder**

```tsx
function App() {
  return (
    <div className="h-screen bg-slate-50 flex items-center justify-center">
      <p className="text-slate-500">Sidekick Prototype</p>
    </div>
  )
}

export default App
```

**Step 4: Verify dev server starts**

Run: `cd packages/sidekick-ui && npx vite --host 2>&1 | head -10`

Expected: Vite dev server starts without errors, serves on localhost.

**Step 5: Commit**

```
feat(ui): fix build infrastructure for prototype
```

---

### Task 2: Types and Mock Data

Define the prototype's type system and create realistic mock data (2 projects, 5-6 sessions, 20-40 events per session).

**Files:**
- Create: `packages/sidekick-ui/src/types.ts`
- Create: `packages/sidekick-ui/src/data/mock-data.ts`

**Step 1: Create types.ts**

Define all types needed by the prototype. These are UI-only types — no dependency on `@sidekick/types`.

```typescript
// Event types displayed on the timeline
export type EventType =
  | 'session-start'
  | 'user-message'
  | 'assistant-message'
  | 'tool-use'
  | 'decision'
  | 'state-change'
  | 'reminder'
  | 'compaction'
  | 'persona-change'
  | 'llm-call'

// A single event on the timeline
export interface TimelineEvent {
  id: string
  timestamp: number
  type: EventType
  label: string
  content?: string
  // Tool events
  toolName?: string
  toolInput?: Record<string, unknown>
  toolResult?: Record<string, unknown>
  toolDurationMs?: number
  // State/summary events
  confidence?: number
  stateSnapshot?: Record<string, unknown>
  previousSnapshot?: Record<string, unknown>
  // Reminder events
  reminderAction?: 'staged' | 'consumed' | 'cleared'
  reminderHook?: string
  reminderBlocking?: boolean
  reminderPriority?: number
  // Decision events
  decisionCategory?: 'summary' | 'reminder' | 'context-prune' | 'handler'
  decisionReasoning?: string
  decisionImpact?: string
  // LLM call events
  llmModel?: string
  llmTokensIn?: number
  llmTokensOut?: number
  llmCostUsd?: number
  llmLatencyMs?: number
  // Persona change events
  personaFrom?: string
  personaTo?: string
  // Compaction events
  compactionSegment?: number
  compactionTokensBefore?: number
  compactionTokensAfter?: number
}

// Session metadata
export interface Session {
  id: string
  title: string
  date: string
  branch: string
  projectId: string
  persona?: string
  intent?: string
  intentConfidence?: number
  tokenCount?: number
  costUsd?: number
  durationSec?: number
  status: 'active' | 'completed'
  events: TimelineEvent[]
}

// Project grouping
export interface Project {
  id: string
  name: string
  sessions: Session[]
}

// Focus filter types (matches EventType categories)
export type FocusFilter =
  | 'hooks'
  | 'transcript'
  | 'decisions'
  | 'reminders'
  | 'llm-calls'
  | 'state-changes'

// Navigation depth
export type NavigationDepth = 'selector' | 'dashboard' | 'detail'

// Panel state
export interface PanelState {
  expanded: boolean
}

// Full navigation state
export interface NavigationState {
  depth: NavigationDepth
  selectedProjectId: string | null
  selectedSessionId: string | null
  selectedEventId: string | null
  selectorPanel: PanelState
  dashboardPanel: PanelState
  detailPanel: PanelState
  activeFilters: Set<FocusFilter>
  searchQuery: string
  darkMode: boolean
}
```

**Step 2: Create mock-data.ts with realistic data**

Create 2 projects with 5-6 sessions total, each having 20-40 events. Include variety: compaction boundaries, persona changes, varying confidence levels, reminder lifecycles.

This file should export:

```typescript
export const mockProjects: Project[]
```

Use helper functions to generate events with realistic timestamps and content. Reference the archived `packages/sidekick-ui/.archive/src/data/mockData.ts` for content inspiration but use the new type system.

The mock data should include:
- **Project "sidekick"** (3 sessions): debugging daemon, adding persona, fixing hooks
- **Project "webapp"** (2-3 sessions): auth bug, API refactor, frontend polish
- At least one session with a compaction boundary
- Confidence values ranging from 0.3 to 0.95 across sessions
- Reminder lifecycle (staged -> consumed) in at least two sessions
- Persona changes in at least one session
- LLM calls with varying models/costs

**Step 3: Commit**

```
feat(ui): add prototype types and realistic mock data
```

---

### Task 3: Navigation State Management

Build the `NavigationManager` — a React context + useReducer that controls panel expand/collapse and navigation depth.

**Files:**
- Create: `packages/sidekick-ui/src/hooks/useNavigation.ts`

**Step 1: Create useNavigation.ts**

```typescript
import { createContext, useContext, useReducer, type Dispatch } from 'react'
import type { NavigationState, FocusFilter } from '../types'

// Action types
type NavigationAction =
  | { type: 'SELECT_SESSION'; projectId: string; sessionId: string }
  | { type: 'SELECT_EVENT'; eventId: string }
  | { type: 'DESELECT_EVENT' }
  | { type: 'BACK_TO_SELECTOR' }
  | { type: 'TOGGLE_SELECTOR_PANEL' }
  | { type: 'TOGGLE_DASHBOARD_PANEL' }
  | { type: 'TOGGLE_DETAIL_PANEL' }
  | { type: 'TOGGLE_FILTER'; filter: FocusFilter }
  | { type: 'SET_SEARCH'; query: string }
  | { type: 'TOGGLE_DARK_MODE' }
  | { type: 'NAVIGATE_EVENT'; direction: 'prev' | 'next' }

const initialState: NavigationState = {
  depth: 'selector',
  selectedProjectId: null,
  selectedSessionId: null,
  selectedEventId: null,
  selectorPanel: { expanded: true },
  dashboardPanel: { expanded: false },
  detailPanel: { expanded: false },
  activeFilters: new Set(),
  searchQuery: '',
  darkMode: false,
}

function navigationReducer(state: NavigationState, action: NavigationAction): NavigationState {
  switch (action.type) {
    case 'SELECT_SESSION':
      return {
        ...state,
        depth: 'dashboard',
        selectedProjectId: action.projectId,
        selectedSessionId: action.sessionId,
        selectedEventId: null,
        selectorPanel: { expanded: false },
        dashboardPanel: { expanded: true },
        detailPanel: { expanded: false },
      }
    case 'SELECT_EVENT':
      return {
        ...state,
        depth: 'detail',
        selectedEventId: action.eventId,
        selectorPanel: { expanded: false },
        dashboardPanel: { expanded: false },
        detailPanel: { expanded: true },
      }
    case 'DESELECT_EVENT':
      return {
        ...state,
        depth: 'dashboard',
        selectedEventId: null,
        dashboardPanel: { expanded: true },
        detailPanel: { expanded: false },
      }
    case 'BACK_TO_SELECTOR':
      return {
        ...state,
        depth: 'selector',
        selectedProjectId: null,
        selectedSessionId: null,
        selectedEventId: null,
        selectorPanel: { expanded: true },
        dashboardPanel: { expanded: false },
        detailPanel: { expanded: false },
      }
    case 'TOGGLE_SELECTOR_PANEL':
      // Expanding selector compresses dashboard/detail
      if (!state.selectorPanel.expanded) {
        return {
          ...state,
          depth: 'selector',
          selectorPanel: { expanded: true },
          dashboardPanel: { expanded: false },
          detailPanel: { expanded: false },
        }
      }
      // Collapsing selector expands dashboard (if session selected)
      if (state.selectedSessionId) {
        return {
          ...state,
          depth: state.selectedEventId ? 'detail' : 'dashboard',
          selectorPanel: { expanded: false },
          dashboardPanel: { expanded: !state.selectedEventId },
          detailPanel: { expanded: !!state.selectedEventId },
        }
      }
      return state

    case 'TOGGLE_DASHBOARD_PANEL':
      if (!state.dashboardPanel.expanded) {
        // Expanding dashboard compresses detail
        return {
          ...state,
          depth: 'dashboard',
          dashboardPanel: { expanded: true },
          detailPanel: { expanded: false },
        }
      }
      // Collapsing dashboard expands selector
      return {
        ...state,
        depth: 'selector',
        selectorPanel: { expanded: true },
        dashboardPanel: { expanded: false },
        detailPanel: { expanded: false },
      }

    case 'TOGGLE_DETAIL_PANEL':
      if (!state.detailPanel.expanded) {
        return state // Can't expand detail without selecting an event
      }
      // Collapsing detail expands dashboard
      return {
        ...state,
        depth: 'dashboard',
        selectedEventId: null,
        dashboardPanel: { expanded: true },
        detailPanel: { expanded: false },
      }

    case 'TOGGLE_FILTER': {
      const newFilters = new Set(state.activeFilters)
      if (newFilters.has(action.filter)) {
        newFilters.delete(action.filter)
      } else {
        newFilters.add(action.filter)
      }
      return { ...state, activeFilters: newFilters }
    }

    case 'SET_SEARCH':
      return { ...state, searchQuery: action.query }

    case 'TOGGLE_DARK_MODE':
      return { ...state, darkMode: !state.darkMode }

    // NAVIGATE_EVENT is handled by the component that knows the event list
    // The reducer just updates selectedEventId
    case 'NAVIGATE_EVENT':
      return state // Handled at component level with event list context

    default:
      return state
  }
}

export interface NavigationContextValue {
  state: NavigationState
  dispatch: Dispatch<NavigationAction>
}

export const NavigationContext = createContext<NavigationContextValue | null>(null)

export function useNavigation(): NavigationContextValue {
  const context = useContext(NavigationContext)
  if (!context) {
    throw new Error('useNavigation must be used within NavigationProvider')
  }
  return context
}

export { initialState, navigationReducer }
export type { NavigationAction }
```

**Step 2: Commit**

```
feat(ui): add navigation state management with useReducer
```

---

### Task 4: CompressedLabel Component

The reusable rotated-text component used when panels are collapsed.

**Files:**
- Create: `packages/sidekick-ui/src/components/CompressedLabel.tsx`

**Step 1: Create CompressedLabel.tsx**

```tsx
interface CompressedLabelProps {
  text: string
  onClick?: () => void
}

export function CompressedLabel({ text, onClick }: CompressedLabelProps) {
  return (
    <button
      onClick={onClick}
      className="h-full w-full flex items-center justify-center cursor-pointer hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
      title={text}
    >
      <span className="text-vertical text-xs font-medium text-slate-600 dark:text-slate-400 select-none">
        {text}
      </span>
    </button>
  )
}
```

**Step 2: Commit**

```
feat(ui): add CompressedLabel component with rotated text
```

---

### Task 5: PanelHeader Component

Reusable panel header with title and collapse/expand chevron.

**Files:**
- Create: `packages/sidekick-ui/src/components/PanelHeader.tsx`

**Step 1: Create PanelHeader.tsx**

```tsx
import { ChevronLeft, ChevronRight } from 'lucide-react'

interface PanelHeaderProps {
  title: string
  expanded: boolean
  onToggle: () => void
  /** Which direction the chevron points when expanded */
  collapseDirection: 'left' | 'right'
  children?: React.ReactNode
}

export function PanelHeader({ title, expanded, onToggle, collapseDirection, children }: PanelHeaderProps) {
  const CollapseIcon = collapseDirection === 'left' ? ChevronLeft : ChevronRight
  const ExpandIcon = collapseDirection === 'left' ? ChevronRight : ChevronLeft

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-medium text-slate-700 dark:text-slate-300 truncate">{title}</h2>
        {children}
      </div>
      <button
        onClick={onToggle}
        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0"
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? <CollapseIcon size={16} /> : <ExpandIcon size={16} />}
      </button>
    </div>
  )
}
```

**Step 2: Commit**

```
feat(ui): add PanelHeader component with collapse/expand chevron
```

---

### Task 6: SessionSelector Panel

The first-depth panel showing projects and sessions.

**Files:**
- Create: `packages/sidekick-ui/src/components/SessionSelector.tsx`

**Step 1: Create SessionSelector.tsx**

Full-width view: project tree with session cards (title, date, branch, status indicator).
Compressed view: CompressedLabel with "Project / Session" text.

The component receives the project list and dispatches `SELECT_SESSION` and `TOGGLE_SELECTOR_PANEL` actions.

Include:
- Project group headers with expand/collapse
- Session cards with status dot (green=active, gray=completed)
- Date and branch display
- Highlight for selected session (when returning from dashboard)
- Dark mode support via `dark:` variants

**Step 2: Commit**

```
feat(ui): add SessionSelector panel with project tree
```

---

### Task 7: SummaryStrip Component

The compact session vitals bar at the top of the dashboard.

**Files:**
- Create: `packages/sidekick-ui/src/components/SummaryStrip.tsx`

**Step 1: Create SummaryStrip.tsx**

Horizontal bar showing:
- Active persona (icon + name)
- Current intent + confidence dot (green/amber/red)
- Token count
- Cost (USD)
- Duration
- Status badge (live/historical)
- Dark mode toggle button

All values come from the selected Session object. Confidence dot color: green (>0.8), amber (0.5-0.8), red (<0.5).

**Step 2: Commit**

```
feat(ui): add SummaryStrip with session vitals
```

---

### Task 8: Timeline Components

The vertical event rail with focus filters.

**Files:**
- Create: `packages/sidekick-ui/src/components/timeline/FocusFilterBar.tsx`
- Create: `packages/sidekick-ui/src/components/timeline/TimelineEvent.tsx`
- Create: `packages/sidekick-ui/src/components/timeline/CompactionMarker.tsx`
- Create: `packages/sidekick-ui/src/components/timeline/Timeline.tsx`

**Step 1: Create FocusFilterBar.tsx**

Composable toggle buttons for event type filtering. Active filters get highlighted styling. Inactive (but filtered-out) events dim to 20% opacity via parent logic.

Filter categories: hooks, transcript, decisions, reminders, llm-calls, state-changes.

**Step 2: Create TimelineEvent.tsx**

A single event on the rail:
- Colored dot by type (same palette as old UI: blue=user, emerald=assistant, cyan=tool, amber=decision, purple=state, rose=reminder, slate=session, indigo=llm-call)
- Time label (HH:MM:SS)
- Short label text
- Confidence dot (for state-change events)
- Highlight ring when selected
- Dim to 20% opacity when filtered out (not hidden)
- Click handler dispatches SELECT_EVENT

**Step 3: Create CompactionMarker.tsx**

Scissors icon with dashed line spanning the timeline width. Positioned between events at the compaction boundary.

**Step 4: Create Timeline.tsx**

Container that renders FocusFilterBar at top, then scrollable list of TimelineEvent items with CompactionMarker items interspersed at compaction boundaries.

Scroll-syncs with transcript via a shared callback (passed from parent). When an event is clicked, dispatches SELECT_EVENT.

**Step 5: Commit**

```
feat(ui): add Timeline with focus filters and event rail
```

---

### Task 9: Transcript Components

Chat-bubble transcript panel with search/filter.

**Files:**
- Create: `packages/sidekick-ui/src/components/transcript/SearchFilterBar.tsx`
- Create: `packages/sidekick-ui/src/components/transcript/TranscriptEvent.tsx`
- Create: `packages/sidekick-ui/src/components/transcript/Transcript.tsx`

**Step 1: Create SearchFilterBar.tsx**

Text input with search icon. Dispatches SET_SEARCH action on change. Debounce input by 200ms.

**Step 2: Create TranscriptEvent.tsx**

Renders different card styles per event type:
- **user-message**: Blue avatar, white card with content
- **assistant-message**: Green avatar, white card with content
- **tool-use**: Indented, compact card with tool name and result summary
- **decision**: Amber card with category and reasoning
- **state-change**: Purple card with summary diff
- **reminder**: Rose card with lifecycle info
- **session-start/compaction/persona-change**: Centered divider line with icon and label

Each card shows timestamp. Highlighted when selected. Dimmed when filtered out. Click dispatches SELECT_EVENT.

**Step 3: Create Transcript.tsx**

Container: SearchFilterBar at top, scrollable list of TranscriptEvent items.

Accepts a `scrollToEventId` prop for sync with timeline. Uses ref + scrollIntoView.

**Step 4: Commit**

```
feat(ui): add Transcript panel with chat bubbles and search
```

---

### Task 10: SessionDashboard Panel

The second-depth panel combining SummaryStrip + Timeline + Transcript.

**Files:**
- Create: `packages/sidekick-ui/src/components/SessionDashboard.tsx`

**Step 1: Create SessionDashboard.tsx**

When expanded:
- PanelHeader with "Session: {title}" and collapse chevron
- SummaryStrip below header
- Two-column split: Timeline (left, ~280px) | Transcript (right, flex-1)
- Bidirectional scroll sync between Timeline and Transcript

When compressed:
- CompressedLabel with "{title} -- {time}"

Handles time correlation (DP-2): clicking in timeline highlights transcript event and scrolls to it, and vice versa. Use a local state for `hoveredEventId` to highlight corresponding items.

**Step 2: Commit**

```
feat(ui): add SessionDashboard with timeline/transcript split
```

---

### Task 11: Detail Panel

The third-depth panel with context-sensitive event detail views.

**Files:**
- Create: `packages/sidekick-ui/src/components/detail/DetailHeader.tsx`
- Create: `packages/sidekick-ui/src/components/detail/StateInspector.tsx`
- Create: `packages/sidekick-ui/src/components/detail/ToolDetail.tsx`
- Create: `packages/sidekick-ui/src/components/detail/DecisionDetail.tsx`
- Create: `packages/sidekick-ui/src/components/detail/ReminderDetail.tsx`
- Create: `packages/sidekick-ui/src/components/detail/TranscriptDetail.tsx`
- Create: `packages/sidekick-ui/src/components/detail/DetailPanel.tsx`

**Step 1: Create DetailHeader.tsx**

Panel header with:
- Event type icon + label
- Prev/Next buttons (left/right arrows with "3 / 28" counter)
- Collapse chevron
- Prev/Next dispatches: finds adjacent event in the session's event list and dispatches SELECT_EVENT with the new ID

**Step 2: Create individual detail views**

Each receives the selected `TimelineEvent` and renders appropriate content:

- **StateInspector**: JSON tree view with Raw/Diff toggle. Raw shows `stateSnapshot` as formatted JSON. Diff shows red/green lines between `previousSnapshot` and `stateSnapshot`. Confidence dot.
- **ToolDetail**: Tool name header, collapsible input params (JSON), result (JSON), duration badge.
- **DecisionDetail**: Category badge, reasoning text, impact summary.
- **ReminderDetail**: Action badge (staged/consumed/cleared), hook target, blocking flag, priority number.
- **TranscriptDetail**: Full message content, metadata table (tokens in/out, model, cost, latency).

**Step 3: Create DetailPanel.tsx**

Container that:
- Shows DetailHeader
- Switches content view based on selected event type
- Passes prev/next navigation to header (needs access to event list from session)

**Step 4: Commit**

```
feat(ui): add DetailPanel with context-sensitive event views
```

---

### Task 12: App Shell — Wire It All Together

Connect all panels with the navigation context.

**Files:**
- Modify: `packages/sidekick-ui/src/App.tsx`
- Modify: `packages/sidekick-ui/src/main.tsx` (add dark mode class)

**Step 1: Rewrite App.tsx**

```tsx
import { useReducer } from 'react'
import { NavigationContext, initialState, navigationReducer } from './hooks/useNavigation'
import { SessionSelector } from './components/SessionSelector'
import { SessionDashboard } from './components/SessionDashboard'
import { DetailPanel } from './components/detail/DetailPanel'
import { mockProjects } from './data/mock-data'

function App() {
  const [state, dispatch] = useReducer(navigationReducer, initialState)

  // Derive selected data from state
  const selectedProject = mockProjects.find(p => p.id === state.selectedProjectId)
  const selectedSession = selectedProject?.sessions.find(s => s.id === state.selectedSessionId)
  const selectedEvent = selectedSession?.events.find(e => e.id === state.selectedEventId)

  // Panel width classes based on expanded/collapsed state
  const selectorWidth = state.selectorPanel.expanded ? 'flex-1' : 'w-10'
  const dashboardWidth = state.dashboardPanel.expanded ? 'flex-1' : 'w-10'
  const detailWidth = state.detailPanel.expanded ? 'flex-1' : 'w-0'

  return (
    <NavigationContext.Provider value={{ state, dispatch }}>
      <div className={`h-screen flex ${state.darkMode ? 'dark' : ''}`}>
        <div className="h-full w-full bg-slate-50 dark:bg-slate-950 flex overflow-hidden">
          {/* Session Selector */}
          <div className={`panel-transition ${selectorWidth} border-r border-slate-200 dark:border-slate-800 overflow-hidden`}>
            <SessionSelector projects={mockProjects} />
          </div>

          {/* Session Dashboard */}
          {state.selectedSessionId && (
            <div className={`panel-transition ${dashboardWidth} border-r border-slate-200 dark:border-slate-800 overflow-hidden`}>
              <SessionDashboard session={selectedSession!} />
            </div>
          )}

          {/* Detail Panel */}
          {state.selectedEventId && selectedSession && (
            <div className={`panel-transition ${detailWidth} overflow-hidden`}>
              <DetailPanel event={selectedEvent!} events={selectedSession.events} />
            </div>
          )}
        </div>
      </div>
    </NavigationContext.Provider>
  )
}

export default App
```

Note: The exact width classes will need tuning during implementation. The `panel-transition` CSS class handles the animation. The `flex-1` vs `w-10` pattern creates the accordion effect.

**Step 2: Update tailwind.config.js for dark mode**

Add `darkMode: 'class'` to tailwind config.

**Step 3: Verify the prototype runs**

Run: `cd packages/sidekick-ui && npx vite --host`

Open in browser. Verify:
- Session selector renders with project tree
- Clicking a session compresses selector, shows dashboard
- Clicking an event compresses dashboard, shows detail
- Chevrons expand/collapse panels
- Rotated text appears on compressed panels
- Dark mode toggle works
- Focus filters dim events
- Prev/Next steps through events in detail view

**Step 4: Commit**

```
feat(ui): wire App shell with navigation context and all panels
```

---

### Task 13: Polish and Verify

Final pass — visual cleanup, keyboard navigation, ensure all open questions are testable.

**Files:**
- Potentially modify any component for visual fixes

**Step 1: Add keyboard support**

- `Escape` dismisses detail panel (returns to dashboard)
- `Escape` from dashboard returns to selector
- `ArrowLeft` / `ArrowRight` in detail panel for prev/next event
- Add `useEffect` with `keydown` listener in App.tsx

**Step 2: Verify open questions are testable**

Walk through each open question from the design doc:
1. Focus filters composability — toggle multiple filters, verify dimming behavior
2. Confidence dot — verify green/amber/red on state events
3. Compression animation — adjust timing if 200ms feels wrong
4. Rotated text readability — verify at 32-40px panel width

**Step 3: Run build verification**

Run: `cd packages/sidekick-ui && npx tsc --noEmit && npx vite build`

Fix any type errors or build failures.

**Step 4: Final commit**

```
feat(ui): add keyboard navigation and polish
```

---

## Execution Notes

- **All paths are relative to the worktree root:** `.worktrees/feat-ui-prototype/`
- **No tests required for this prototype** — it's a UX validation tool, not production code. Tests come when we implement the real UI.
- **Design reference:** `docs/plans/2026-03-07-ui-prototype-design.md`
- **Archived reference:** `packages/sidekick-ui/.archive/` has working examples of event rendering, diff views, JSON tree viewers
- **Use `@` alias** for imports: `import { Foo } from '@/components/Foo'`
- **lucide-react** is already a dependency — use it for all icons
- **Commit after each task** — small, atomic commits on `feat/ui-prototype` branch
