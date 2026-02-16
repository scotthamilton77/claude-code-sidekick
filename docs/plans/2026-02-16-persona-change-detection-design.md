# Persona Change Detection Design

**Bead**: sidekick-nmjf
**Date**: 2026-02-16
**Status**: Approved

## Problem

Two symptoms when a session starts with a persona already configured:

1. **Redundant persona injection**: The file watcher fires on `session-persona.json` creation at session start and stages a `persona-changed` one-shot reminder, even though SessionStart already established the persona. The persona hasn't changed — it was initialized.

2. **False change on initial creation**: When a new session creates the persona file for the first time, the system treats this as a change event and writes a snarky "persona changed" message. Initial creation should not be treated as a change.

**Root cause**: The file watcher always passes `includeChangedReminder: true` for add/change events. `stagePersonaRemindersForSession` has no way to distinguish initialization from a genuine mid-session switch because no prior state is tracked.

## Design

### Three-State Tracking Model

Introduce a per-session state file at `.sidekick/sessions/{sessionId}/state/last-staged-persona.json` that tracks what was last staged:

```typescript
// Three distinct states via file presence and content:
// 1. File absent         → never_staged (session initialization)
// 2. { personaId: null } → cleared (explicitly removed mid-session)
// 3. { personaId: "X" }  → staged (persona X is active)
```

### Decision Matrix

| Prior State | Incoming | Fire one-shot? | Rationale |
|---|---|---|---|
| never_staged (no file) | persona-X | No | Initialization, not a change |
| staged: persona-A | persona-A | No | Redundant, same persona |
| staged: persona-A | persona-B | Yes | Genuine switch |
| staged: persona-A | cleared | No | `unlink` path already skips |
| cleared (was A) | persona-X | Yes | User re-engaged mid-session |
| never_staged | cleared | No | Nothing to announce |

### State Transitions by Trigger Path

| Trigger | Writes State | `includeChangedReminder` | Behavior |
|---|---|---|---|
| SessionStart handler | `{ personaId: "X" }` | Not passed (false) | Establishes baseline, never fires one-shot |
| File watcher (add/change) | `{ personaId: "X" }` | `true` — gated by comparison | Compares before firing |
| File watcher (unlink) | `{ personaId: null }` | `false` | Records explicit clear |
| Config change restage | `{ personaId: "X" }` | Not passed (false) | Re-establishes, no announcement |
| No persona / disabled guard | `{ personaId: null }` | N/A — returns early | Cleans up and records |

## Code Changes

### `@sidekick/types` — Schema

Add `LastStagedPersonaSchema` (Zod):

```typescript
export const LastStagedPersonaSchema = z.object({
  personaId: z.string().nullable(),
})
export type LastStagedPersona = z.infer<typeof LastStagedPersonaSchema>
```

### `stage-persona-reminders.ts` — Core logic change

The only file with behavioral change:

1. Read `last-staged-persona.json` via `stateService.read()` at top of `stagePersonaRemindersForSession`
2. After staging persistent reminder, determine whether to honor `includeChangedReminder`:
   - File absent (never staged) → skip one-shot
   - `personaId: null` (cleared) and incoming is a persona → fire one-shot
   - `personaId` differs from incoming → fire one-shot
   - `personaId` matches incoming → skip one-shot
3. Write `{ personaId }` after staging completes
4. In `clearPersonaReminders`, write `{ personaId: null }` to record explicit clear

### Files NOT Changed

- `daemon.ts` — file watcher continues to pass `includeChangedReminder: true`; the function now internally decides
- Consumption handlers (CLI-side) — untouched
- `session-persona-watcher.ts` — untouched
- `remember-your-persona.yaml` / `persona-changed.yaml` — untouched

## Testing

- Unit tests for `stagePersonaRemindersForSession` covering all six matrix rows
- Verify SessionStart → file watcher sequence does not produce one-shot
- Verify genuine `persona set X` → `persona set Y` mid-session produces one-shot
- Verify `persona clear` → `persona set X` mid-session produces one-shot
- Verify redundant staging (same persona) is silent

## Acceptance Criteria

Build passes. Typecheck passes. Tests pass. No `persona-changed` one-shot fires on session initialization. Genuine mid-session persona switches continue to fire the one-shot.
