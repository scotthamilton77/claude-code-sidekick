# UI/UX Coherence Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement decisions D20-D28 from the UI/UX coherence design to create a unified, filterable transcript with tool pairing, LED state machine, user message subtypes, and subagent drill-down.

**Architecture:** Server-side merge of Claude Code JSONL and Sidekick NDJSON into a unified `TranscriptLine[]` with computed LED states. Client-side filtering via independent toggle categories. Tool pairs connected via gutter lines. Subagent transcripts rendered in a chain of panels with temporal scroll-lock.

**Tech Stack:** TypeScript, React, Vite dev server middleware, Tailwind CSS, lucide-react icons.

**Design doc:** `docs/plans/2026-03-14-ui-ux-coherence-design.md`

**Decision log:** `packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md` — update with new decisions as they arise.

**Test command:** `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui test`

**Build/typecheck:** `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui build && pnpm --filter sidekick-ui typecheck`

---

## Task 1: Quick Fixes (D28)

Three independent rendering/data fixes. Low risk, no dependencies.

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts` — add `compactionTokensAfter` field
- Modify: `packages/sidekick-ui/server/timeline-api.ts` — add `reminder:cleared` to `TIMELINE_EVENT_TYPES` and `generateLabel()`
- Modify: `packages/sidekick-ui/src/types.ts` — add `compactionTokensAfter` to `TranscriptLine`, add `reminder:cleared` to `SidekickEventType`
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx` — render clickable PR links, render compaction token delta
- Modify: `packages/sidekick-ui/src/components/detail/DetailPanel.tsx` — update CompactionDetail to show before/after
- Test: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts` — test compaction postTokens mapping
- Test: `packages/sidekick-ui/server/__tests__/timeline-api.test.ts` — test reminder:cleared label generation

**Changes:**

1. **`reminder:cleared`**: Add `'reminder:cleared'` to the `SidekickEventType` union in `types.ts`. In `timeline-api.ts`, add it to `TIMELINE_EVENT_TYPES` Set and add a case in `generateLabel()`:
   ```typescript
   case 'reminder:cleared':
     return { label: `Reminder cleared: ${payload.reminderType ?? 'all'}` }
   ```

2. **Compaction postTokens**: In `transcript-api.ts` `processSystemEntry()`, for `compact_boundary` subtype, also extract `compactMetadata.postTokens`:
   ```typescript
   compactionTokensAfter: compactMetadata?.postTokens as number | undefined,
   ```
   Add `compactionTokensAfter` to `ApiTranscriptLine` interface. In `types.ts`, add to `TranscriptLine`. Update CompactionDetail to render "X k → Y k" when both values present.

3. **Clickable PR links**: In `TranscriptLine.tsx`, the pr-link case should render `line.prUrl` as:
   ```tsx
   {line.prUrl && isSafeUrl(line.prUrl) && (
     <a href={line.prUrl} target="_blank" rel="noopener noreferrer"
        className="text-xs text-indigo-500 hover:underline truncate block">
       {line.prUrl}
     </a>
   )}
   ```

**Tests:** Write tests for reminder:cleared label generation and compaction postTokens mapping. Run existing tests to ensure no regressions.

**Commit:** `fix(ui): quick fixes — reminder:cleared, compaction postTokens, clickable PR links`

---

## Task 2: Timeline Filter Behavior Change (D21 partial)

Change timeline filters from highlight/dim to show/hide. All filters selected by default.

**Files:**
- Modify: `packages/sidekick-ui/src/components/timeline/Timeline.tsx` — filter events instead of dimming
- Modify: `packages/sidekick-ui/src/components/timeline/TimelineEvent.tsx` — remove `isDimmed` prop
- Modify: `packages/sidekick-ui/src/components/timeline/TimelineFilterBar.tsx` — update toggle styling to show active = filled, inactive = outline

**Changes:**

In `Timeline.tsx`, replace the `isEventDimmed()` function with actual filtering:
```typescript
// Before: events.map(event => ({ ...event, isDimmed: isEventDimmed(event) }))
// After: filter events before mapping
const visibleEvents = useMemo(() => {
  if (state.timelineFilters.size === 0) return events
  return events.filter(event => {
    const filterCategory = SIDEKICK_EVENT_TO_FILTER[event.type]
    return filterCategory ? state.timelineFilters.has(filterCategory) : true
  })
}, [events, state.timelineFilters])
```

Note: currently `timelineFilters` in `NavigationState` is initialized empty and toggling adds/removes. The semantic meaning needs to flip: filters in the Set are ACTIVE (shown). Initialize with all 5 filters. Review `TOGGLE_TIMELINE_FILTER` reducer logic — currently toggles Set membership, which still works if we initialize the Set with all values and treat "in Set = visible."

Update `initialState` in `useNavigation.ts`:
```typescript
timelineFilters: new Set<TimelineFilter>(['reminders', 'decisions', 'session-analysis', 'statusline', 'errors']),
```

Remove `isDimmed` prop from `TimelineEventItem`. Update `TimelineFilterBar` so active filters have filled background, inactive have outline/muted style.

**Tests:** Verify existing timeline tests still pass. Add test for filter-to-hide behavior if timeline has component tests.

**Commit:** `feat(ui): change timeline filters from dim to hide (D21)`

---

## Task 3: User Message Subtypes (D24)

Detect user message subtypes server-side and render them distinctly client-side.

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts` — add subtype detection + `userSubtype` field
- Modify: `packages/sidekick-ui/src/types.ts` — add `UserSubtype` type and field to `TranscriptLine`
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx` — render subtypes differently
- Test: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts` — test subtype detection

**Types:**
```typescript
export type UserSubtype = 'prompt' | 'system-injection' | 'command' | 'skill-content'
```

**Server-side detection** in `processUserEntry()`:
```typescript
function classifyUserSubtype(entry: Record<string, unknown>, content: string): UserSubtype {
  if (entry.isMeta === true) {
    if (content.includes('<command-name>')) return 'command'
    return 'system-injection' // covers skill content too
  }
  if (content.includes('<system-reminder>')) return 'system-injection'
  if (content.includes('<command-name>')) return 'command'
  return 'prompt'
}
```

Add `userSubtype?: UserSubtype` to `ApiTranscriptLine`.

**Client rendering:**
- `prompt`: current styling, no change
- `system-injection`: gray-200 bg, collapsed by default (just show "System injection" label, click to expand), monospace, gray left border
- `command`: compact pill showing command name extracted from content, terminal-green accent
- `skill-content`: same as system-injection

**Tests:** Test each subtype classification with representative content strings from real transcripts.

**Commit:** `feat(ui): user message subtype detection and rendering (D24)`

---

## Task 4: Session Selector Date Grouping (D27)

Group sessions by date within each project. Surface session fetch errors.

**Files:**
- Modify: `packages/sidekick-ui/src/components/SessionSelector.tsx` — add date grouping + error indicator
- Modify: `packages/sidekick-ui/src/hooks/useSessions.ts` — surface per-project errors
- Modify: `packages/sidekick-ui/src/types.ts` — add error field to Project if needed

**Date groups:**
```typescript
function groupSessionsByDate(sessions: Session[]): Map<string, Session[]> {
  const groups = new Map<string, Session[]>()
  const now = new Date()
  for (const session of sessions) {
    const d = new Date(session.dateRaw ?? session.date)
    const key = isToday(d, now) ? 'Today'
      : isYesterday(d, now) ? 'Yesterday'
      : isThisWeek(d, now) ? 'This Week'
      : isThisMonth(d, now) ? 'This Month'
      : 'Older'
    const arr = groups.get(key) ?? []
    arr.push(session)
    groups.set(key, arr)
  }
  return groups
}
```

Render each group as a collapsible section with header showing group name + count. Most recent group expanded by default, rest collapsed.

**Error surfacing:** In `useSessions.ts`, when a project's session fetch fails, capture the error message on the Project object (add `sessionLoadError?: string`). In SessionSelector, show a yellow warning badge on the project header when `project.sessionLoadError` is set, with tooltip showing the error.

**Commit:** `feat(ui): session selector date grouping and error surfacing (D27)`

---

## Task 5: Transcript Filter Bar (D21 complete)

Add a filter bar to the transcript panel with 5 toggle categories.

**Files:**
- Create: `packages/sidekick-ui/src/components/transcript/TranscriptFilterBar.tsx`
- Modify: `packages/sidekick-ui/src/types.ts` — add `TranscriptFilter` type
- Modify: `packages/sidekick-ui/src/hooks/useNavigation.ts` — add `transcriptFilters` to state, add `TOGGLE_TRANSCRIPT_FILTER` action
- Modify: `packages/sidekick-ui/src/components/transcript/Transcript.tsx` — integrate filter bar, filter lines before rendering

**Types:**
```typescript
export type TranscriptFilter = 'conversation' | 'tools' | 'thinking' | 'sidekick' | 'system'
```

Add to `NavigationState`:
```typescript
transcriptFilters: Set<TranscriptFilter>  // all 5 active by default
```

**Filter matching logic** in `Transcript.tsx`:
```typescript
function matchesTranscriptFilter(line: TranscriptLine, filters: Set<TranscriptFilter>): boolean {
  if (filters.size === 5) return true // all active = show everything
  const type = line.type
  if (type === 'user-message' || type === 'assistant-message') return filters.has('conversation')
  if (type === 'tool-use' || type === 'tool-result') return filters.has('tools')
  // Thinking: assistant-message with thinking field but no content
  if (type === 'assistant-message' && line.thinking && !line.content) return filters.has('thinking')
  if (isSidekickEventType(type)) return filters.has('sidekick')
  // system: compaction, turn-duration, api-error, pr-link
  return filters.has('system')
}
```

Note: "Thinking" filter interacts with "Conversation" — an assistant message with BOTH content and thinking should be shown if either Conversation or Thinking is active. An assistant message with ONLY thinking should require the Thinking filter. Handle this edge case.

**TranscriptFilterBar component:** Same pill-toggle pattern as `TimelineFilterBar`. 5 categories with distinct colors:
- Conversation: indigo
- Tools: amber
- Thinking: purple
- Sidekick: emerald
- System: slate

**Commit:** `feat(ui): transcript filter bar with 5 categories (D21)`

---

## Task 6: Server-Side Event Interleaving (D20)

Merge Sidekick events into the transcript API response, sorted by timestamp.

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts` — import timeline parsing, merge events
- Modify: `packages/sidekick-ui/server/api-plugin.ts` — pass `projectDir` to `parseTranscriptLines`
- Modify: `packages/sidekick-ui/server/timeline-api.ts` — export `readLogFile` and `findLogFiles` (or extract shared helper)
- Test: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts` — test interleaving

**Approach:** `parseTranscriptLines()` currently takes `(projectId, sessionId)`. Change signature to also accept `projectDir` (the Sidekick project directory where `.sidekick/logs/` lives). After parsing Claude Code transcript lines, also parse Sidekick NDJSON logs for the same sessionId, convert each Sidekick event to a `TranscriptLine`, merge both arrays, and sort by timestamp.

**Sidekick event → TranscriptLine mapping:**
```typescript
function sidekickEventToTranscriptLine(event: TimelineEvent, index: number): ApiTranscriptLine {
  return {
    id: `sidekick-${index}`,
    timestamp: event.timestamp,
    type: event.type as ApiTranscriptLineType,
    content: event.label,
    // Copy event-specific payload fields to the appropriate TranscriptLine fields
    // based on event type (reminder fields, decision fields, etc.)
  }
}
```

**API route change:** The transcript route in `api-plugin.ts` already looks up the project via `getProjectById()` for timeline. For transcript, it currently passes `(projectId, sessionId)` directly. Change to also pass `project.projectDir` so the transcript parser can find `.sidekick/logs/`.

**Expand `ApiTranscriptLineType`:** Add all 16 SidekickEventType values to the union.

**Important:** The NDJSON log files contain events for ALL sessions. The parser must filter by `sessionId` (same as timeline-api.ts does). Reuse or share the filtering logic.

**Tests:** Create test fixtures with both Claude Code JSONL entries and Sidekick NDJSON entries at known timestamps. Verify they interleave correctly by timestamp. Verify Sidekick events have correct TranscriptLine fields.

**Commit:** `feat(ui): interleave Sidekick events into transcript (D20)`

---

## Task 7: LED State Machine (D23)

Compute LED states server-side during the merge pass and include in API response.

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts` — compute LEDState per line during merge
- Modify: `packages/sidekick-ui/server/transcript-api.ts` — add `ledState` field to `ApiTranscriptLine`
- Modify: `packages/sidekick-ui/src/types.ts` — ensure `TranscriptLine.ledState` is typed
- Modify: `packages/sidekick-ui/src/components/transcript/Transcript.tsx` — use line.ledState instead of external Map
- Modify: `packages/sidekick-ui/src/components/transcript/LEDGutter.tsx` — no change needed (already takes LEDState)
- Modify: `packages/sidekick-ui/src/App.tsx` — remove ledStates prop threading if no longer needed
- Test: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts`

**State machine logic** (server-side, after merge and sort):
```typescript
interface RunningLEDState {
  vcBuild: boolean
  vcTypecheck: boolean
  vcTest: boolean
  vcLint: boolean
  verifyCompletion: boolean
  pauseAndReflect: boolean
  titleConfidence: 'red' | 'amber' | 'green' | ''
  titleConfidencePct: string
}

function computeLEDStates(lines: ApiTranscriptLine[]): void {
  const state: RunningLEDState = { /* all false/empty */ }
  for (const line of lines) {
    // Check if this line mutates LED state
    if (line.type === 'reminder:staged') {
      const key = mapReminderTypeToLED(line.reminderType)
      if (key) state[key] = true
    } else if (line.type === 'reminder:unstaged' || line.type === 'reminder:consumed' || line.type === 'reminder:cleared') {
      const key = mapReminderTypeToLED(line.reminderType)
      if (key) state[key] = false
    } else if (line.type === 'session-title:changed') {
      // Update titleConfidence from payload
    }
    // Stamp current state onto line
    line.ledState = { ...state }
  }
}
```

**Reminder type → LED mapping:**
- `vc-build` → `vcBuild`
- `vc-typecheck` → `vcTypecheck`
- `vc-test` → `vcTest`
- `vc-lint` → `vcLint`
- `verify-completion` → `verifyCompletion`
- `pause-and-reflect` → `pauseAndReflect`

Look up the actual `reminderType` values used in the Sidekick NDJSON payload. Check `packages/sidekick-core/src/types/` for the canonical reminder type enum.

**Client changes:** `Transcript.tsx` currently accepts `ledStates: Map<string, LEDState>` and passes to `LEDGutter`. Change to read `line.ledState` directly. Remove the Map prop.

**Tests:** Create test with a sequence of Sidekick events (staged → unstaged) and verify LED states flow correctly through the transcript lines.

**Commit:** `feat(ui): server-side LED state machine computation (D23)`

---

## Task 8: Tool-Use ID Capture (D22 data)

Capture `tool_use_id` from Claude Code transcripts to enable tool pairing.

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts` — extract `toolUseId` from tool_use and tool_result blocks
- Modify: `packages/sidekick-ui/src/types.ts` — add `toolUseId` to `TranscriptLine`
- Test: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts`

**Data extraction:**

In `processAssistantEntry()`, for `tool_use` blocks:
```typescript
if (b.type === 'tool_use') {
  lines.push({
    // ... existing fields ...
    toolUseId: b.id as string,  // Claude API always provides this
  })
}
```

In `processUserEntry()`, for `tool_result` blocks:
```typescript
if (b.type === 'tool_result') {
  lines.push({
    // ... existing fields ...
    toolUseId: b.tool_use_id as string,  // references the matching tool_use
  })
}
```

Add `toolUseId?: string` to `ApiTranscriptLine` and `TranscriptLine`.

**Tests:** Add test entries with `tool_use` blocks containing `id` and `tool_result` blocks containing `tool_use_id`. Verify both map to `toolUseId` on the resulting lines.

**Commit:** `feat(ui): capture toolUseId for tool pairing (D22)`

---

## Task 9: Tool Pair UI — Gutter Lines, Hover, Navigation (D22 UI)

Render visual connections between tool-use and tool-result pairs.

**Files:**
- Create: `packages/sidekick-ui/src/components/transcript/ToolPairConnector.tsx` — SVG overlay for gutter lines
- Modify: `packages/sidekick-ui/src/components/transcript/Transcript.tsx` — compute pair map, render connector overlay, handle hover state
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx` — add "→ result" / "← call" links, hover handlers

**Pair computation** (client-side, in `Transcript.tsx`):
```typescript
const toolPairs = useMemo(() => {
  const pairs = new Map<string, { useIndex: number; resultIndex: number }>()
  const useMap = new Map<string, number>() // toolUseId → index in visible lines
  visibleLines.forEach((line, index) => {
    if (line.type === 'tool-use' && line.toolUseId) {
      useMap.set(line.toolUseId, index)
    }
    if (line.type === 'tool-result' && line.toolUseId) {
      const useIndex = useMap.get(line.toolUseId)
      if (useIndex !== undefined) {
        pairs.set(line.toolUseId, { useIndex, resultIndex: index })
      }
    }
  })
  return pairs
}, [visibleLines])
```

**Color palette:** 5 cycling colors for concurrent pairs:
```typescript
const PAIR_COLORS = ['#6366f1', '#f59e0b', '#10b981', '#ef4444', '#8b5cf6']
```
Assign color by order of tool-use appearance.

**Gutter connector:** An SVG overlay positioned absolutely over the LED gutter area. For each pair, draw a vertical line from the tool-use row to the tool-result row. Use the assigned color. On hover, thicken the line and highlight both rows.

**In-bubble links:** In `TranscriptLine.tsx`, when `line.toolUseId` exists:
- tool-use: show small "→ result" link that dispatches a scroll action
- tool-result: show small "← call" link that dispatches a scroll action

**Hover state:** Lift hover state to Transcript via `hoveredToolUseId`. When set, both paired rows get a subtle highlight ring and the connector line becomes prominent.

**Commit:** `feat(ui): tool pair gutter lines, hover, and navigation (D22)`

---

## Task 10: Expand/Collapse for Large Content (D26)

Add universal expand/collapse to large content blocks.

**Files:**
- Create: `packages/sidekick-ui/src/components/transcript/CollapsibleContent.tsx`
- Modify: `packages/sidekick-ui/src/components/transcript/TranscriptLine.tsx` — wrap tool inputs, results, thinking, system injections

**CollapsibleContent component:**
```typescript
interface CollapsibleContentProps {
  content: string
  previewLines?: number  // default 3
  previewChars?: number  // default 200
  className?: string
  mono?: boolean
}
```

Renders preview (first N lines or N chars, whichever is shorter). Shows "Show more (X lines)" / "Show less" toggle. When expanded, shows full content with optional syntax highlighting for JSON.

**Apply to:**
- Tool inputs: wrap `formatToolInput` preview → full `JSON.stringify(line.toolInput, null, 2)` on expand
- Tool results: wrap `line.toolOutput` (already truncated server-side to 500 chars — consider sending full output and letting client handle truncation, OR add expand that fetches full content)
- Thinking blocks: wrap `line.thinking`
- System injections (from Task 3): already collapsed by default, use same component

**Decision needed:** Tool results are truncated to 500 chars server-side. For expand/collapse to show full content, either: (a) remove server-side truncation and let the client handle it, or (b) keep server truncation as a safety valve and accept that expand only shows up to 500 chars. Recommend (a) — remove truncation, since the client filter can hide tool results entirely if they're noisy. Add a client-side character limit at a higher threshold (e.g., 10,000 chars) for safety.

**Commit:** `feat(ui): expand/collapse for large content blocks (D26)`

---

## Task 11: Subagent Transcript API (D25 data)

New API endpoint to fetch a subagent's transcript.

**Files:**
- Modify: `packages/sidekick-ui/server/transcript-api.ts` — add `parseSubagentTranscript()` function
- Modify: `packages/sidekick-ui/server/api-plugin.ts` — add route `GET /api/projects/:projectId/sessions/:sessionId/subagents/:agentId/transcript`
- Test: `packages/sidekick-ui/server/__tests__/transcript-api.test.ts`
- Test: `packages/sidekick-ui/server/__tests__/api-plugin.test.ts`

**Subagent file location:**
```
~/.claude/projects/{projectId}/{sessionId}/subagents/agent-{agentId}.jsonl
~/.claude/projects/{projectId}/{sessionId}/subagents/agent-{agentId}.meta.json
```

**`parseSubagentTranscript(projectId, sessionId, agentId)`:**
- Resolve path to subagent JSONL file
- Parse using the same entry processing functions as the main transcript
- NO Sidekick event interleaving (subagents don't have their own Sidekick events)
- NO LED state computation
- Return `ApiTranscriptLine[]`

**Meta.json** provides: `agentType`, `worktreePath`, `parentToolUseId`. Return these as metadata alongside the transcript lines.

**API route:** Validate all three path segments (projectId, sessionId, agentId). Return 404 if subagent file doesn't exist.

**Linking from parent:** In the main transcript, Agent tool-use entries need the `agentId` to construct the drill-down URL. The `agent_progress` entries in the main transcript contain `data.agentId`. The plan:
1. During main transcript parsing, when encountering `agent_progress` entries (currently skipped as unknown type), extract `data.agentId` and associate it with the parent tool_use via `toolUseId`.
2. Add `agentId?: string` to `ApiTranscriptLine`. Populate on tool-use lines that have an associated agent_progress.

**Commit:** `feat(ui): subagent transcript API endpoint (D25)`

---

## Task 12: Subagent Panel Chain Layout (D25 UI)

Multi-panel transcript layout with compression and navigation.

**Files:**
- Create: `packages/sidekick-ui/src/components/transcript/SubagentTranscript.tsx` — subagent panel
- Create: `packages/sidekick-ui/src/hooks/useSubagentTranscript.ts` — data hook
- Modify: `packages/sidekick-ui/src/App.tsx` — dynamic panel chain layout
- Modify: `packages/sidekick-ui/src/hooks/useNavigation.ts` — add subagent chain state
- Modify: `packages/sidekick-ui/src/types.ts` — add subagent navigation types

**Navigation state addition:**
```typescript
interface SubagentChainEntry {
  projectId: string
  sessionId: string
  agentId: string
  agentType?: string  // from meta.json
  parentToolUseId?: string
}

// In NavigationState:
subagentChain: SubagentChainEntry[]  // stack of open subagent panels
```

**New reducer actions:**
- `OPEN_SUBAGENT` — push to chain (or replace from clicked panel's depth)
- `CLOSE_SUBAGENT` — pop from chain (closes rightmost)
- `REPLACE_SUBAGENT` — when clicking different subagent in a parent panel, pop everything to the right and push new one

**Layout in App.tsx:**
The dashboard area currently has: `[Timeline] [Transcript] [DetailPanel?]`

New layout: `[Timeline] [MainTranscript] [Subagent1?] [Subagent2?] ... [DetailPanel?]`

Each transcript panel (main + subagents) has a flex basis that shrinks as more panels open. Any panel can be minimized to a compressed label (same as SessionSelector pattern). The rightmost panel gets the most space.

**SubagentTranscript component:** Mirrors `Transcript` but simpler:
- No LED gutter
- No Sidekick events (pure Claude Code conversation)
- Has its own TranscriptFilterBar (same 5 categories minus Sidekick)
- Has minimize/close buttons in header
- Clicking an Agent tool-use within it opens another subagent panel to its right

**Commit:** `feat(ui): subagent panel chain layout with compression (D25)`

---

## Task 13: Temporal Scroll-Lock (D25 scroll)

Synchronize scrolling between the main transcript and subagent panels by timestamp.

**Files:**
- Create: `packages/sidekick-ui/src/hooks/useScrollSync.ts` — scroll coordinator
- Modify: `packages/sidekick-ui/src/components/transcript/Transcript.tsx` — register with coordinator
- Modify: `packages/sidekick-ui/src/components/transcript/SubagentTranscript.tsx` — register with coordinator

**Scroll coordinator:**
```typescript
interface ScrollSyncCoordinator {
  registerPanel(panelId: string, ref: RefObject<HTMLDivElement>, timestamps: number[]): void
  unregisterPanel(panelId: string): void
  onScroll(panelId: string, scrollTop: number): void
}
```

**Timestamp mapping:** Each panel provides an ordered array of timestamps (one per visible line). The coordinator maps scroll position → timestamp → corresponding scroll position in other panels.

**Spacer insertion:** When one panel has events in a time window and another doesn't, insert invisible spacer `<div>` elements to maintain horizontal alignment. The coordinator computes where spacers are needed by comparing timestamp distributions across panels.

**Algorithm:**
1. Build a unified timestamp grid from all visible panels
2. For each panel, compute which grid slots have content and which need spacers
3. Insert spacer elements with computed heights
4. On scroll in any panel, map scroll position to grid position, then scroll all other panels to the corresponding grid position

**Performance:** Only compute spacers when panel content changes (not on every scroll). Use `IntersectionObserver` or virtual scrolling if panel content is very large.

**Commit:** `feat(ui): temporal scroll-lock between transcript panels (D25)`

---

## Task Dependency Graph

```
Task 1 (Quick fixes)           — independent
Task 2 (Timeline filter)       — independent
Task 3 (User subtypes)         — independent
Task 4 (Session date groups)   — independent
Task 5 (Transcript filter)     — independent (but pairs with Task 6)
Task 6 (Event interleaving)    — should follow Task 5 (filter bar handles Sidekick category)
Task 7 (LED state machine)     — depends on Task 6 (needs interleaved events)
Task 8 (ToolUseId capture)     — independent
Task 9 (Tool pair UI)          — depends on Task 8
Task 10 (Expand/collapse)      — independent
Task 11 (Subagent API)         — independent
Task 12 (Subagent UI)          — depends on Task 11
Task 13 (Scroll-lock)          — depends on Task 12
```

**Parallelizable groups:**
- Group A: Tasks 1, 2, 3, 4, 5, 8, 10, 11 (all independent)
- Group B: Tasks 6, 9, 12 (each depends on one from Group A)
- Group C: Tasks 7, 13 (each depends on one from Group B)

**Recommended serial order (for single-agent execution):**
1 → 2 → 3 → 4 → 5 → 8 → 6 → 7 → 10 → 9 → 11 → 12 → 13
