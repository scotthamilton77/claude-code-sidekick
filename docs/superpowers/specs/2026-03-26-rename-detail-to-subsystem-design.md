# Rename DecisionRecordedPayload.detail → subsystem, make title required

**Bead:** claude-code-sidekick-pkj (P1)
**Date:** 2026-03-26
**Status:** Approved

## Problem

`DecisionRecordedPayload.detail` is misnamed. Every emission site sets it to
`'session-summary analysis'` — it functions as a subsystem identifier, not a
detail. When a human-readable label was needed, `title` was added as optional
because `detail` was squatting on that semantic role. Additionally, the UI
transcript parser never extracts `detail`, so the field is written to logs but
never consumed.

## Design

### 1. Type Definition (`packages/types/src/events.ts`)

Rename `detail` → `subsystem` (free-form `string`). Make `title` required.

```typescript
export interface DecisionRecordedPayload {
  decision: string
  reason: string
  subsystem: string    // renamed from detail
  title: string        // was optional, now required
}
```

### 2. Emission Sites (`packages/feature-session-summary/src/handlers/update-summary.ts`)

All 5 emission sites in `handleUpdateSummary`:

- `detail: 'session-summary analysis'` → `subsystem: 'session-summary'`
  (intentionally shortened — ` analysis` is redundant with the event type `decision:recorded`)
- Verify each site already provides `title` (they do — via `DECISION_TITLE_*` constants)

### 3. Event Factory (`packages/feature-session-summary/src/events.ts`)

`DecisionEvents.decisionRecorded()` is a passthrough — the type change
propagates automatically. No code change needed beyond the import.

### 4. Transcript Parser (`packages/sidekick-ui/server/transcript-api.ts`)

Add `subsystem` extraction with fallback for old log entries:

```typescript
line.decisionSubsystem = (payload.subsystem ?? payload.detail) as string | undefined
```

### 5. ApiTranscriptLine Type

Add field to the transcript line interface:

```typescript
decisionSubsystem?: string
```

### 6. Timeline API (`packages/sidekick-ui/server/timeline-api.ts`)

No change. Timeline uses `title`/`decision` for the label and `reason` for the
detail string. Subsystem is not needed in the one-line timeline view.

### 7. UI — DecisionDetail Component (`packages/sidekick-ui/src/components/detail/DecisionDetail.tsx`)

Add subsystem display — conditionally rendered labeled field (only when
`decisionSubsystem` is present, since old log entries may lack it). Style
as a small badge similar to `decisionCategory`.

### 8. Tests

| Test File | Changes |
|-----------|---------|
| `types/.../canonical-events.test.ts` | `detail` → `subsystem`, assert `title` is required |
| `feature-session-summary/.../events.test.ts` | Update payload field name in factory test |
| `feature-session-summary/.../event-emission.test.ts` | `meta?.detail` → `meta?.subsystem` |
| `sidekick-ui/.../transcript-api.test.ts` | Add `decisionSubsystem` assertion |
| `sidekick-ui/.../timeline-api.test.ts` | No change needed |

## Out of Scope

- Removing non-decision emissions (unconditional actions logged as decisions) → `fzk`
- Adding decision events for VC reminder staging/unstaging → `fzk`
- Union type for subsystem values (free-form string for now, tighten later)

## Backward Compatibility

- Type system: no backward compat needed (single-user project, per AGENTS.md)
- Log parser: `payload.subsystem ?? payload.detail` handles old log entries
