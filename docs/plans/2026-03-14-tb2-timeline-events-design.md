# TB2: Timeline with Real NDJSON Events — Design

**Bead:** `claude-code-sidekick-dgt`
**Parent epic:** `sidekick-43a8b12e`
**Decision log:** `packages/sidekick-ui/docs/UI_IMPLEMENTATION_DECISIONS.md` (D8-D12)

## Goal

Second tracer bullet: parse NDJSON log files server-side, filter by session, transform to `SidekickEvent[]`, and feed the existing Timeline component with real data. Proves the log-to-UI data pipeline end-to-end.

## Architecture

```
.sidekick/logs/cli.log          .sidekick/logs/sidekickd.log
        |                              |
        +----------+    +-------------+
                   v    v
        Vite server: timeline-api.ts
          - Parse NDJSON lines (JSON.parse per line)
          - Filter by context.sessionId
          - Filter by visibility (timeline | both)
          - Transform to SidekickEvent via labelGenerator
                   |
                   v
        GET /api/projects/:projectId/sessions/:sessionId/timeline
          → { events: SidekickEvent[] }
                   |
                   v
        useTimeline() hook (new)
          - Fetches on session selection
          - Returns { events, loading, error }
                   |
                   v
        Timeline component (existing, unchanged)
          - Receives SidekickEvent[] instead of []
          - Filters, renders, dims — all existing behavior
```

## Scope

### In scope
- New API route for timeline events
- Fresh minimal NDJSON parser (not archived parser)
- Payload-aware label generator for human-readable timeline labels
- `useTimeline()` React hook
- Wire to existing Timeline component
- Empty state message ("No events") for sessions with no log data
- Unit tests, hook tests, Playwright e2e tests

### Out of scope (deferred)
- SSE / live updates for active sessions
- Transcript line correlation / scroll-sync (transcriptLineId = '' placeholder)
- Large log file pagination/streaming
- Per-session log files (see bead claude-code-sidekick-ht7)

## API Route

### `GET /api/projects/:projectId/sessions/:sessionId/timeline`

**Source:** `.sidekick/logs/cli.log` and `.sidekick/logs/sidekickd.log` in the project directory.

**Processing pipeline:**
1. Read both log files (full read for TB2)
2. Parse each line as JSON — skip malformed lines
3. Filter: `context.sessionId === requestedSessionId`
4. Filter: `UI_EVENT_VISIBILITY[type]` is `'timeline'` or `'both'`
5. Transform to `SidekickEvent` via label generator
6. Merge both files' events, sort by timestamp ascending

**Response:**
```typescript
{
  events: Array<{
    id: string            // crypto.randomUUID()
    timestamp: number     // from event.time
    type: SidekickEventType
    label: string         // payload-aware human-readable label
    detail?: string       // optional additional context
    transcriptLineId: string  // '' for TB2 (scroll-sync deferred)
  }>
}
```

**Error responses:**
- Unknown project ID → 404 `{ error: "Project not found" }`
- Unknown session ID → 404 `{ error: "Session not found" }`
- Filesystem read error → 500 `{ error: "..." }`
- Missing log files → 200 with empty `events` array (not an error)

## Server-Side Pipeline

### NDJSON Parser

Minimal, fresh implementation (~50 lines). Per line:
- `JSON.parse(line)` — skip malformed lines with server-side warning
- Extract: `type`, `time`, `context.sessionId`, `payload`, `source`
- No Pino-specific logic — only canonical event fields matter

### Label Generator

Function `generateLabel(type, payload) → { label, detail? }` with payload-aware output:

| Type | Label Example | Detail Example |
|------|--------------|----------------|
| `reminder:staged` | `Staged: vc-build` | `reason: tool_threshold` |
| `reminder:unstaged` | `Unstaged: vc-build` | `triggeredBy: tool_result` |
| `reminder:consumed` | `Consumed: verify-completion` | — |
| `decision:recorded` | `Decision: skip-tests` | `reasoning: "tests already passed"` |
| `session-title:changed` | `Title → "Fix auth bug"` | `confidence: 0.85` |
| `intent:changed` | `Intent → "refactoring"` | `confidence: 0.72` |
| `persona:selected` | `Persona: yoda` | — |
| `snarky-message:finish` | `Snarky Message` | first 80 chars of generated message |
| `error:occurred` | `Error: ENOENT` | first 120 chars of stack |

Fallback for unknown types: humanize the type string (`reminder:staged` → `Reminder Staged`).

## React Data Layer

### `useTimeline()` hook

New file: `packages/sidekick-ui/src/hooks/useTimeline.ts`

```typescript
interface UseTimelineResult {
  events: SidekickEvent[]
  loading: boolean
  error: string | null
}

function useTimeline(projectId: string | null, sessionId: string | null): UseTimelineResult
```

- Fetches when both IDs are non-null
- Re-fetches when `sessionId` changes
- Returns empty `events` array when no session selected
- No polling, no SSE — static fetch only

### `App.tsx` changes

- Import and call `useTimeline(selectedProjectId, selectedSessionId)`
- Pass `events` to `<Timeline events={timelineEvents} />`
- Show subtle loading indicator on Timeline panel during fetch

## What Changes vs What Stays

| Component | Change? | Notes |
|-----------|---------|-------|
| `timeline-api.ts` | New (~120 lines) | Parser, label generator, route handler |
| `useTimeline.ts` | New (~40 lines) | Fetch hook |
| `api-plugin.ts` | Minimal | Register third route |
| `App.tsx` | Minimal | Wire useTimeline() to Timeline |
| `Timeline.tsx` | Minimal | Add empty state message |
| `TimelineFilterBar.tsx` | No change | Already works |
| `TimelineEventItem.tsx` | No change | Already works |
| `types.ts` | No change | SidekickEvent type sufficient |

## Error Handling & Edge Cases

- **Missing log file:** Return empty events array (new project, no events yet)
- **Malformed JSON line:** Skip and continue. Don't fail the request.
- **Large log file:** Full read for TB2. Pagination/streaming deferred.
- **Empty timeline:** Display "No events" message
- **Session switch:** useTimeline re-fetches on sessionId change; stale data cleared

## Testing Strategy

### Server-side unit tests (`server/__tests__/timeline-api.test.ts`)
- Parse valid NDJSON lines → correct SidekickEvent[]
- Skip malformed lines without crashing
- Filter by sessionId — only matching events returned
- Filter by visibility — log-only events excluded
- Merge and sort events from both log files by timestamp
- Label generator produces correct labels for each event type
- Label generator falls back gracefully for unknown types
- Empty/missing log files → empty array

### React hook tests (`src/hooks/__tests__/useTimeline.test.ts`)
- Fetches on session selection, returns events
- Returns empty array when no session selected
- Handles fetch error gracefully
- Re-fetches when sessionId changes

### Playwright e2e (`e2e/timeline.spec.ts`)
- API route returns JSON with events array
- Timeline renders events when session with log data is selected
- Timeline shows "no events" message for session with no log data
- Filter toggles dim/show events by category
- Switching sessions reloads timeline with new session's events

## Decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D8 | Fresh minimal NDJSON parser, not archived parser | Archived parser predates canonical event types; ~50 lines vs adapting legacy code |
| D9 | `transcriptLineId: ''` placeholder | Scroll-sync deferred to TB3; no type contract changes needed |
| D10 | Payload-aware label generator | Repeated generic labels useless in narrow timeline column |
| D11 | Parser + transformer in `server/` only | Client never touches raw NDJSON in TB2; extract when SSE arrives |
| D12 | Empty timeline shows "no events" message | Silent empty state confuses users |

## What This Proves

- NDJSON log files can be parsed and served as structured timeline data
- The canonical event type system maps cleanly to the UI's SidekickEvent type
- Payload-aware labels provide meaningful timeline entries
- The existing Timeline component works with real data unchanged
- Foundation for SSE live updates (TB3+) and transcript correlation

## What This Defers

- SSE / live updates for active sessions → bead
- Transcript line correlation / scroll-sync → bead
- Large log file pagination/streaming → bead
- Per-session log files → claude-code-sidekick-ht7
- Middleware plugin refactor → claude-code-sidekick-qn3 (now at 3 routes, trigger at ~4)
