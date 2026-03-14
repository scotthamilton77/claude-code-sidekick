# Reminder Event Enrichment Design

**Date:** 2026-03-13
**Status:** Approved
**Parent Epic:** `sidekick-43a8b12e`

## Problem

The Sidekick UI is a forensic debugging tool. When a user asks "why did this reminder fire?" or "why WASN'T I reminded?", the current event stream can answer the first question partially but cannot answer the second at all.

The reminder system has 58 identified decision points across 12 core files. Most "positive" decisions (stage, unstage, consume) already emit events. But:

1. **Negative decisions** ("evaluated and decided NOT to stage") fire no event — the system is silent when nothing changes.
2. **Positive events lack context** — `reminder:staged` says WHAT happened but not WHY (threshold reached? cascade? re-activation?).
3. **Completion classification results** are logged but not attached to the `reminder:consumed` event the UI renders.

## Design

### New Event: `reminder:not-staged`

A new canonical event type (#32) for negative staging decisions.

**Visibility:** `log` — high-frequency, only shown in detail panel or log viewer, not on the main timeline.

**Payload:**

```typescript
export interface ReminderNotStagedPayload {
  /** Which reminder was evaluated. e.g., 'vc-build', 'pause-and-reflect' */
  reminderName: string
  /** Which hook triggered the evaluation */
  hookName: HookName
  /** Why staging was skipped */
  reason: string  // 'below_threshold', 'same_turn', 'feature_disabled', 'no_unverified_changes', 'pattern_mismatch'
  /** For threshold-gated decisions: the threshold value */
  threshold?: number
  /** For threshold-gated decisions: the current counter value */
  currentValue?: number
  /** What action triggered the evaluation */
  triggeredBy?: string  // 'file_edit', 'bash_command', 'tool_result', 'user_prompt'
}
```

**High-value emission points** (from the 58-point audit):

| File | Decision | Reason Value |
|------|----------|-------------|
| `track-verification-tools.ts:145` | VC tool edit counter below threshold | `below_threshold` |
| `track-verification-tools.ts:112` | File doesn't match clearing patterns | `pattern_mismatch` |
| `track-verification-tools.ts:108` | Tool verification disabled in config | `feature_disabled` |
| `stage-pause-and-reflect.ts:58` | P&R reactivation skipped (same turn) | `same_turn` |
| `stage-pause-and-reflect.ts:66` | P&R tools below threshold | `below_threshold` |
| `stage-stop-bash-changes.ts:87` | Bash VC reactivation skipped (same turn) | `same_turn` |
| `stage-stop-bash-changes.ts:109` | No new files detected by git | `no_changes_detected` |
| `stage-stop-bash-changes.ts:119` | New files don't match source patterns | `pattern_mismatch` |
| `stage-persona-reminders.ts:157` | Persona injection disabled by config | `feature_disabled` |
| `stage-persona-reminders.ts:181` | No persona loaded or persona disabled | `no_persona` |
| `unstage-verify-completion.ts:129` | No unverified changes exist | `no_unverified_changes` |

### Enriched Payloads for Existing Events

All additions are optional fields — backward compatible.

**`ReminderStagedPayload`** — add:

```typescript
  /** Why this reminder was staged */
  reason?: string  // 'initial', 're-staged', 'threshold_reached', 'cascade', 'session_start'
  /** What action triggered the staging */
  triggeredBy?: string  // 'file_edit', 'bash_command', 'tool_result', 'session_start', 'bulk_processing'
  /** For threshold-gated reminders: state at time of staging */
  thresholdState?: {
    current: number
    threshold: number
  }
```

**`ReminderUnstagedPayload`** — add (already has `reason`):

```typescript
  /** What caused this unstaging */
  triggeredBy?: string  // 'cascade_from_pause_and_reflect', 'verification_passed', 'cycle_limit', 'config_change'
  /** For VC tool unstaging: the tool's state machine snapshot */
  toolState?: {
    status: string  // 'verified', 'cooldown', 'staged'
    editsSinceVerified: number
  }
```

**`ReminderConsumedPayload`** — add:

```typescript
  /** For verify-completion: the LLM classification result */
  classificationResult?: {
    category: string  // 'CLAIMING_COMPLETION', 'ASKING_QUESTION', 'ANSWERING_QUESTION', 'OTHER'
    confidence: number
    shouldBlock: boolean
  }
```

### What Does NOT Change

- `decision:recorded` — keeps its narrow scope (LLM operation gating decisions in `update-summary.ts`). The reminder system's decisions are better served by domain-specific events.
- Event visibility for existing events — `reminder:staged`, `reminder:unstaged`, `reminder:consumed` stay `timeline`.

## Implementation Notes

### Where to add `reminder:not-staged`

1. Define `ReminderNotStagedEvent` and `ReminderNotStagedPayload` in `packages/types/src/events.ts`
2. Add to `UIEventType` union, `UI_EVENT_TYPES` array, `UIEventPayloadMap`, `UI_EVENT_VISIBILITY` (as `'log'`)
3. Add factory `ReminderEvents.reminderNotStaged()` in `packages/feature-reminders/src/events.ts`
4. Wire `logEvent()` calls at the 11 emission points listed above

### Where to enrich payloads

1. Extend `ReminderStagedPayload`, `ReminderUnstagedPayload`, `ReminderConsumedPayload` in `packages/types/src/events.ts` with optional fields
2. Update factory functions to accept and pass through new fields
3. Update emission points to provide the new fields from local scope variables
4. Update existing tests to verify new fields appear when provided

### Testing

- Unit tests for the new event factory
- Unit tests for each emission point (verify `logEvent` called with correct payload)
- Verify backward compatibility — existing tests must pass without changes
