# Scroll-Sync Line Correlation Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable click-sync from any transcript line to the nearest timeline event, and delete the unused `useScrollSync` hook.

**Architecture:** Extract a `findNearestTimelineEvent` binary-search utility. Pass `timelineEvents` to `Transcript.tsx` so its click handler can resolve non-Sidekick lines to the nearest timeline event and dispatch the existing `SYNC_TO_TRANSCRIPT_EVENT` action. Delete the dead `useScrollSync` hook.

**Tech Stack:** TypeScript, React, Vitest

**Design doc:** `docs/plans/2026-03-15-scroll-sync-line-correlation-design.md`

**Test command:** `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui test`

**Build/typecheck:** `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui build && pnpm --filter sidekick-ui typecheck`

---

## Task 1: Delete dead `useScrollSync` hook

Remove the unused hook file. No tests reference it, no imports exist outside the file itself.

**Files:**
- Delete: `packages/sidekick-ui/src/hooks/useScrollSync.ts`

**Step 1: Verify no imports exist**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && grep -r "useScrollSync\|scrollSync" packages/sidekick-ui/src/ --include="*.ts" --include="*.tsx" -l`
Expected: Only `packages/sidekick-ui/src/hooks/useScrollSync.ts`

**Step 2: Delete the file**

```bash
rm packages/sidekick-ui/src/hooks/useScrollSync.ts
```

**Step 3: Verify build still passes**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui build && pnpm --filter sidekick-ui typecheck`
Expected: PASS (no breakage — file was dead code)

**Step 4: Commit**

```bash
git add -u packages/sidekick-ui/src/hooks/useScrollSync.ts
git commit -m "chore(ui): delete unused useScrollSync hook"
```

---

## Task 2: Create `findNearestTimelineEvent` utility with tests

Extract the binary-search logic into a standalone, testable utility function.

**Files:**
- Create: `packages/sidekick-ui/src/utils/findNearestTimelineEvent.ts`
- Create: `packages/sidekick-ui/src/utils/__tests__/findNearestTimelineEvent.test.ts`

**Step 1: Write the failing tests**

Create `packages/sidekick-ui/src/utils/__tests__/findNearestTimelineEvent.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { findNearestTimelineEvent } from '../findNearestTimelineEvent'
import type { SidekickEvent } from '../../types'

function makeEvent(timestamp: number, id = `evt-${timestamp}`): SidekickEvent {
  return {
    id,
    timestamp,
    type: 'reminder:staged',
    label: `Event at ${timestamp}`,
    transcriptLineId: `sidekick-${timestamp}-reminder:staged`,
  }
}

describe('findNearestTimelineEvent', () => {
  it('returns null for empty events array', () => {
    expect(findNearestTimelineEvent([], 1000)).toBeNull()
  })

  it('returns the only event for single-element array', () => {
    const events = [makeEvent(500)]
    expect(findNearestTimelineEvent(events, 1000)).toBe(events[0])
  })

  it('returns exact match when timestamp matches', () => {
    const events = [makeEvent(100), makeEvent(200), makeEvent(300)]
    expect(findNearestTimelineEvent(events, 200)).toBe(events[1])
  })

  it('returns nearest event when target is between two events (closer to earlier)', () => {
    const events = [makeEvent(100), makeEvent(300)]
    // 180 is closer to 100 than 300
    expect(findNearestTimelineEvent(events, 180)).toBe(events[0])
  })

  it('returns nearest event when target is between two events (closer to later)', () => {
    const events = [makeEvent(100), makeEvent(300)]
    // 250 is closer to 300 than 100
    expect(findNearestTimelineEvent(events, 250)).toBe(events[1])
  })

  it('returns first event when target is before all events', () => {
    const events = [makeEvent(100), makeEvent(200)]
    expect(findNearestTimelineEvent(events, 50)).toBe(events[0])
  })

  it('returns last event when target is after all events', () => {
    const events = [makeEvent(100), makeEvent(200)]
    expect(findNearestTimelineEvent(events, 999)).toBe(events[1])
  })

  it('handles equidistant timestamps (prefers earlier)', () => {
    const events = [makeEvent(100), makeEvent(200)]
    // 150 is equidistant — implementation returns earlier (lo-1 wins when diff is equal via < comparison)
    const result = findNearestTimelineEvent(events, 150)
    expect(result).toBe(events[0])
  })
})
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui test -- --run src/utils/__tests__/findNearestTimelineEvent.test.ts`
Expected: FAIL — module not found

**Step 3: Write implementation**

Create `packages/sidekick-ui/src/utils/findNearestTimelineEvent.ts`:

```typescript
import type { SidekickEvent } from '../types'

/**
 * Find the timeline event with the closest timestamp to the target.
 * Events must be sorted by timestamp (ascending).
 * Returns null if events array is empty.
 */
export function findNearestTimelineEvent(
  events: readonly SidekickEvent[],
  targetTimestamp: number,
): SidekickEvent | null {
  if (events.length === 0) return null
  if (events.length === 1) return events[0]
  if (targetTimestamp <= events[0].timestamp) return events[0]
  if (targetTimestamp >= events[events.length - 1].timestamp) return events[events.length - 1]

  let lo = 0
  let hi = events.length - 1

  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (events[mid].timestamp < targetTimestamp) lo = mid + 1
    else hi = mid
  }

  // Compare lo and lo-1 to find truly nearest
  if (lo > 0) {
    const diffLo = Math.abs(events[lo].timestamp - targetTimestamp)
    const diffPrev = Math.abs(events[lo - 1].timestamp - targetTimestamp)
    if (diffPrev <= diffLo) return events[lo - 1]
  }

  return events[lo]
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui test -- --run src/utils/__tests__/findNearestTimelineEvent.test.ts`
Expected: 8 tests PASS

**Step 5: Commit**

```bash
git add packages/sidekick-ui/src/utils/findNearestTimelineEvent.ts packages/sidekick-ui/src/utils/__tests__/findNearestTimelineEvent.test.ts
git commit -m "feat(ui): add findNearestTimelineEvent binary search utility"
```

---

## Task 3: Wire timeline events into Transcript and add nearest-timestamp click-sync

Pass `timelineEvents` from `App.tsx` to `Transcript.tsx`. Update the click handler so non-Sidekick transcript lines dispatch `SYNC_TO_TRANSCRIPT_EVENT` with the nearest timeline event's `transcriptLineId`.

**Files:**
- Modify: `packages/sidekick-ui/src/App.tsx` — pass `timelineEvents` prop to Transcript
- Modify: `packages/sidekick-ui/src/components/transcript/Transcript.tsx` — accept `timelineEvents` prop, update click handler

**Step 1: Add `timelineEvents` prop to Transcript interface**

In `packages/sidekick-ui/src/components/transcript/Transcript.tsx`, add to `TranscriptProps`:

```typescript
interface TranscriptProps {
  lines: TranscriptLine[]
  loading?: boolean
  error?: string | null
  ledStates?: Map<string, LEDState>
  scrollToLineId: string | null
  defaultModel?: string
  timelineEvents?: SidekickEvent[]  // ← ADD THIS
}
```

Add import for `SidekickEvent` and `findNearestTimelineEvent`:

```typescript
import type { TranscriptLine, LEDState, TranscriptFilter, SidekickEvent } from '../../types'
import { findNearestTimelineEvent } from '../../utils/findNearestTimelineEvent'
```

**Step 2: Update the click handler in Transcript**

In `Transcript.tsx`, in the `onLineClick` callback (inside the `else` branch at line 241-248), change the condition for timeline sync from only Sidekick events to ALL non-Agent lines:

```typescript
// Current code (lines 241-248):
} else {
  dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: line.id })
  if (line.type in SIDEKICK_EVENT_TO_FILTER) {
    dispatch({ type: 'SYNC_TO_TRANSCRIPT_EVENT', lineId: line.id })
    setTimeout(() => dispatch({ type: 'CLEAR_SYNC' }), 2000)
  }
}

// New code:
} else {
  dispatch({ type: 'SELECT_TRANSCRIPT_LINE', lineId: line.id })
  // Sync to timeline: Sidekick events use their own ID, Claude Code lines find nearest
  if (line.type in SIDEKICK_EVENT_TO_FILTER) {
    dispatch({ type: 'SYNC_TO_TRANSCRIPT_EVENT', lineId: line.id })
    setTimeout(() => dispatch({ type: 'CLEAR_SYNC' }), 2000)
  } else if (timelineEvents && timelineEvents.length > 0) {
    const nearest = findNearestTimelineEvent(timelineEvents, line.timestamp)
    if (nearest) {
      dispatch({ type: 'SYNC_TO_TRANSCRIPT_EVENT', lineId: nearest.transcriptLineId })
      setTimeout(() => dispatch({ type: 'CLEAR_SYNC' }), 2000)
    }
  }
}
```

Note: Destructure `timelineEvents` from props in the component function signature.

**Step 3: Pass `timelineEvents` from App.tsx**

In `packages/sidekick-ui/src/App.tsx`, add `timelineEvents` prop to the `<Transcript>` JSX (line 104-111):

```tsx
<Transcript
  lines={transcriptLines}
  loading={transcriptLoading}
  error={transcriptError}
  ledStates={selectedSession?.ledStates ?? new Map()}
  scrollToLineId={state.syncedTranscriptLineId}
  defaultModel={defaultModel}
  timelineEvents={timelineEvents}
/>
```

**Step 4: Verify build and typecheck pass**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui build && pnpm --filter sidekick-ui typecheck`
Expected: PASS

**Step 5: Run all sidekick-ui tests**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui test -- --run`
Expected: All tests PASS

**Step 6: Commit**

```bash
git add packages/sidekick-ui/src/App.tsx packages/sidekick-ui/src/components/transcript/Transcript.tsx
git commit -m "feat(ui): click any transcript line to scroll timeline to nearest event"
```

---

## Task 4: Final verification

Run full build, typecheck, and lint to confirm everything is clean.

**Step 1: Full verification**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm build && pnpm typecheck && pnpm lint`
Expected: All PASS

**Step 2: Run sidekick-ui tests**

Run: `cd /Users/scott/src/projects/claude-code-sidekick && pnpm --filter sidekick-ui test -- --run`
Expected: All PASS

---

## Task Dependency Graph

```
Task 1 (Delete useScrollSync) ── independent
Task 2 (findNearestTimelineEvent utility + tests) ── independent
Task 3 (Wire into Transcript + App) ── depends on Task 2
Task 4 (Final verification) ── depends on Tasks 1, 2, 3
```

**Parallelizable:** Tasks 1 and 2 can run concurrently.
**Serial:** Task 3 depends on Task 2. Task 4 is final gate.
