# State Snapshot Viewer — Design Spec

**Bead**: `claude-code-sidekick-d9b`
**Date**: 2026-04-04
**Status**: Approved

## Problem

The Detail panel's State tab is fully built (`StateTab.tsx`) but renders empty because no data pipeline exists to populate it. State files are written to `.sidekick/sessions/{sessionId}/state/` but are overwritten in-place, losing history. The UI needs historical state snapshots to show what Sidekick's internal state looked like at any point during a session.

## Decision

Append-only JSONL state journal with deduplicated full snapshots. No diffs, no baselines — each entry is self-contained. Change detection prevents writing identical state.

### Alternatives Considered

1. **Embed state in event log payloads** — Rejected: bloats NDJSON event logs with full state contents on every change.
2. **Versioned state files on disk** (one file per change) — Rejected: file proliferation, harder to query than a single journal.
3. **Diff-based journal with periodic baselines** — Rejected: adds diff/merge complexity for negligible disk savings (state files are <2KB each, ~100 changes per session max).
4. **File-system mtime only** (read current files) — Rejected: no history, only captures latest state.

## Architecture

Three layers with single responsibilities:

```
State Writers (core)
  │ post-write hook
  ▼
State Journal Writer ──► .sidekick/sessions/{id}/state-history.jsonl
                                        │
                                        ▼
State Snapshots API (UI server) ──► GET /api/.../state-snapshots
                                        │
                                        ▼
useStateSnapshots hook (frontend) ──► StateTab component (already built)
```

## Layer 1: State Journal Writer

**Package**: `sidekick-core`
**New file**: `packages/sidekick-core/src/state/state-journal.ts`

### Journal File

- **Location**: `.sidekick/sessions/{sessionId}/state-history.jsonl`
- **Scope**: Session state only (not global `.sidekick/state/` files)
- **Format**: NDJSON, one entry per state change

```jsonl
{"ts":1712234567890,"file":"session-summary","data":{"session_title":"Fix auth","latest_intent":"debugging","confidence":0.82}}
{"ts":1712234567891,"file":"session-persona","data":{"persona_id":"cavil"}}
{"ts":1712234570000,"file":"session-summary","data":{"session_title":"Fix auth","latest_intent":"refactoring","confidence":0.91}}
```

### Entry Schema

| Field | Type | Description |
|-------|------|-------------|
| `ts` | `number` | Unix timestamp in milliseconds (`Date.now()`) |
| `file` | `string` | State file basename without extension (e.g., `session-summary`) |
| `data` | `object` | Full contents of the state file at this point in time |

### Change Detection

- Maintain an in-memory `Map<string, string>` of `file` to last-written JSON string (per session)
- Before appending, `JSON.stringify(newData)` and compare against last entry for that file key
- Skip write if identical
- On service startup, prime the map by reading the last entry per file from the existing journal (or start empty)

### Integration Point

Hook into the existing state persistence path. After a state file is written to disk, call the journal appender. The journal appender is a thin function — `appendIfChanged(sessionId, fileKey, data)` — that handles dedup and append.

The specific integration point depends on whether state writes go through `StateService.write()` or are scattered across individual handlers. The implementation plan should trace the exact write sites.

### Write Safety

- Use `appendFile` (not write-then-rename) since we're appending a single line
- Newline-terminate each entry to handle crash recovery (partial last line is discarded on read)

## Layer 2: State Snapshots API

**Package**: `sidekick-ui`
**New files**: `server/state-api.ts`, `server/handlers/state.ts`

### Endpoint

```
GET /api/projects/:projectId/sessions/:sessionId/state-snapshots
```

### Response Format

```typescript
{
  snapshots: StateSnapshot[]  // sorted by timestamp ascending
}
```

Uses the existing `StateSnapshot` interface from `src/types.ts`:

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

### Reconstruction Algorithm

1. Read `state-history.jsonl` from `.sidekick/sessions/{sessionId}/`
2. Parse entries, discard malformed lines
3. Sort by `ts` ascending
4. Walk entries chronologically, maintaining a cumulative accumulator (`Map<string, object>`)
5. At each timestamp where state changed, emit a `StateSnapshot` with all accumulated values
6. Map `file` keys to `StateSnapshot` property names (e.g., `session-summary` to `sessionSummary`)

### File Key to Property Name Mapping

| Journal `file` key | `StateSnapshot` property |
|---|---|
| `session-summary` | `sessionSummary` |
| `session-persona` | `sessionPersona` |
| `snarky-message` | `snarkyMessage` |
| `resume-message` | `resumeMessage` |
| `transcript-metrics` | `transcriptMetrics` |
| `llm-metrics` | `llmMetrics` |
| `summary-countdown` | `summaryCountdown` |

Unknown file keys are included using their camelCase conversion — this allows future state files to appear in the State tab without code changes.

### Fallback for Pre-Existing Sessions

If `state-history.jsonl` does not exist (sessions created before this feature):
1. Read all current `*.json` files from `.sidekick/sessions/{sessionId}/state/`
2. Use the most recent file mtime as the snapshot timestamp
3. Return a single `StateSnapshot` with current values

This provides graceful degradation — old sessions show current state, new sessions show full history.

## Layer 3: Frontend

**Package**: `sidekick-ui`
**New file**: `src/hooks/useStateSnapshots.ts`

### Hook

```typescript
function useStateSnapshots(
  projectId: string | null,
  sessionId: string | null
): UseStateSnapshotsResult
```

Follows the exact pattern of `useTranscript` and `useTimeline`:
- Fetches on `[projectId, sessionId]` change
- Returns `{ snapshots: StateSnapshot[], loading: boolean, error: string | null }`
- Cancellation on unmount/re-fetch

### Wiring in App.tsx

Replace `selectedSession.stateSnapshots` (currently always `[]`) with the hook's output:

```typescript
const { snapshots: stateSnapshots } = useStateSnapshots(
  state.selectedProjectId,
  state.selectedSessionId
)
```

Pass `stateSnapshots` to `DetailPanel` instead of `selectedSession.stateSnapshots`.

### No Changes to Existing Components

- `StateTab.tsx` — already built, renders snapshots with `findSnapshotAtTime()`
- `DetailPanel.tsx` — already accepts and passes `stateSnapshots`
- `types.ts` — `StateSnapshot` interface already sufficient

## Files Changed

| Package | Modified | Created |
|---|---|---|
| `sidekick-core` | State write path (TBD in implementation plan) | `src/state/state-journal.ts` |
| `sidekick-ui/server` | `router.ts` (add route) | `state-api.ts`, `handlers/state.ts` |
| `sidekick-ui/src` | `App.tsx` (wire hook) | `hooks/useStateSnapshots.ts` |

## Testing Strategy

- **Unit tests**: State journal writer (change detection, append, crash recovery)
- **Unit tests**: State API reconstruction algorithm (cumulative snapshots, malformed line handling, fallback)
- **Unit tests**: `useStateSnapshots` hook (fetch, cancel, error states)
- **Integration**: End-to-end from state write through API to StateTab rendering (may require dev-mode session)

## Out of Scope

- Global project state (`.sidekick/state/`) — session state only for now
- Journal compaction/cleanup — sessions are ephemeral enough that unbounded growth is acceptable
- Real-time streaming of state changes — polling or websocket updates deferred
- Adding new log events to core services for unlogged state changes
