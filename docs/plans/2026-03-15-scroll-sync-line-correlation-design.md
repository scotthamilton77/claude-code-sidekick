# Click-Based Scroll-Sync with Line Correlation

**Beads:** `claude-code-sidekick-cgc` (P1), `claude-code-sidekick-sz6` (P2)
**Epic:** `claude-code-sidekick-1yf` (UI/UX Coherence)
**Date:** 2026-03-15

## Problem

Two gaps exist in the UI's scroll-sync behavior:

1. **Line correlation (`sz6`):** Only Sidekick event lines in the transcript can sync to the timeline. Claude Code lines (assistant messages, tool-use, tool-result, user prompts) have no timeline correlation — clicking them does nothing.

2. **Dead scroll-sync hook (`cgc`):** `useScrollSync.ts` was implemented as a continuous timestamp-based scroll coordinator but never integrated into any panel. It's dead code that signals planned work that isn't happening.

## Decisions

- **Click-sync only.** Continuous scroll-sync between timeline (sparse events) and transcript (dense conversation) would feel imprecise and janky. Click-to-scroll covers the primary use case.
- **Nearest-timestamp matching.** When a user clicks a Claude Code transcript line, find the timeline event with the closest timestamp and scroll to it.
- **Delete `useScrollSync.ts`.** YAGNI. The fraction-based approach may not be the right design if continuous sync is ever revisited.

## Architecture

### Current State

```
Sidekick event click (transcript) → SYNC_TO_TRANSCRIPT_EVENT → Timeline scrolls ✓
Timeline event click              → SYNC_TO_TIMELINE_EVENT  → Transcript scrolls ✓
Claude Code line click            → (nothing)                                    ✗
useScrollSync.ts                  → dead code, never called                      ✗
```

### Target State

```
Any transcript line click         → nearest-timestamp match → Timeline scrolls   ✓
Timeline event click              → SYNC_TO_TIMELINE_EVENT  → Transcript scrolls ✓
useScrollSync.ts                  → deleted                                      ✓
```

### Data Flow: Transcript → Timeline (new)

```
User clicks Claude Code transcript line (e.g. assistant message at T=1000)
  → Transcript click handler checks: is this a Sidekick event?
    → Yes: existing flow (dispatch SYNC_TO_TRANSCRIPT_EVENT with line.id)
    → No: binary search timelineEvents by line.timestamp
      → Find nearest event (e.g. reminder:staged at T=980)
      → Dispatch SYNC_TO_TRANSCRIPT_EVENT with event.transcriptLineId
      → Timeline useEffect scrolls to that event, highlights it
      → 2s timeout clears highlight
```

### Binary Search: Nearest Timestamp

```typescript
function findNearestTimelineEvent(
  events: SidekickEvent[],
  targetTimestamp: number
): SidekickEvent | null {
  if (events.length === 0) return null
  let lo = 0, hi = events.length - 1
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].timestamp < targetTimestamp) lo = mid + 1
    else hi = mid
  }
  // Compare lo and lo-1 to find truly nearest
  if (lo > 0) {
    const diffLo = Math.abs(events[lo].timestamp - targetTimestamp)
    const diffPrev = Math.abs(events[lo - 1].timestamp - targetTimestamp)
    if (diffPrev < diffLo) return events[lo - 1]
  }
  return events[lo]
}
```

Events must be sorted by timestamp (they already are from `timeline-api.ts`).

## Files Changed

| Action | File | What |
|--------|------|------|
| Delete | `src/hooks/useScrollSync.ts` | Remove dead code |
| Modify | `src/components/transcript/Transcript.tsx` | Add `timelineEvents` prop, nearest-timestamp click handler for non-Sidekick lines |
| Modify | `src/App.tsx` | Pass `timelineEvents` to Transcript, remove any useScrollSync references |
| Add | `src/utils/findNearestTimelineEvent.ts` | Extract binary search to testable utility |
| Add | `src/utils/__tests__/findNearestTimelineEvent.test.ts` | Unit tests for the binary search |

All paths relative to `packages/sidekick-ui/`.

## What This Does NOT Include

- Continuous scroll-sync (intentionally removed)
- SubagentTranscript ↔ Timeline sync (subagents have no timeline events)
- Scroll position persistence across navigation
- Any new UI elements — reuses existing `isSynced` highlight styling

## Testing

- Unit test `findNearestTimelineEvent` with: empty array, single event, exact match, between two events, before all events, after all events
- Verify existing Sidekick event click-sync still works (no regression)
- Verify Claude Code line click now scrolls timeline to nearest event
- Build and typecheck pass
