# Pin Persona Through Context Clear

**Issue:** sidekick-1b3d
**Date:** 2026-03-07

## Problem

When a user runs `/clear` in Claude Code, the `SessionStart` hook fires with `source="clear"` and a **new session ID**. The persona selection handler treats this like a fresh startup and re-rolls a random persona, breaking personality continuity within the same terminal flow.

## Solution

Preserve the active persona across `/clear` boundaries using the daemon's in-memory state as a handoff mechanism, controlled by a new config setting.

## Design

### Config

New setting in `features.yaml` under `session-summary.settings.personas`:

```yaml
persistThroughClear: true  # default: true
```

When `true`, `/clear` preserves the current persona. When `false`, current behavior (re-roll) is preserved.

### Mechanism

The daemon process (one per project) holds a transient field:

```typescript
lastClearedPersona: { personaId: string; timestamp: number } | null
```

**Hook sequence on `/clear`:**

1. **SessionEnd** (`reason="clear"`):
   - Read current session's `session-persona.json`
   - Set `lastClearedPersona = { personaId, timestamp: Date.now() }`

2. **SessionStart** (`source="clear"`, new session ID):
   - If `persistThroughClear === true` AND `lastClearedPersona` exists AND timestamp < 5s old:
     - Use the cached `personaId` instead of re-selecting
     - Write it to the new session's `session-persona.json`
     - Null out `lastClearedPersona`
   - Otherwise: fall through to normal persona selection

### Precedence

1. `pinnedPersona` config (highest) — always wins
2. `lastClearedPersona` handoff (on clear + persist enabled)
3. Normal weighted random selection (lowest)

### Edge Cases

- First `/clear` before any persona selected: no handoff data, normal selection
- `persona set <id>` then `/clear`: preserves the manually-set persona
- Daemon restart between SessionEnd and SessionStart: no handoff data, normal selection (acceptable — daemon restarts during a `/clear` are near-impossible)
- Two sessions `/clear` simultaneously: last-write-wins on the field, first-read-wins on consumption. Window is milliseconds. Worst case: persona swap, not data loss.
- Stale handoff (> 5s): ignored, normal selection. Prevents accidental carryover from unrelated events.

## Affected Files

1. `assets/sidekick/defaults/features.yaml` — add `persistThroughClear` default
2. `packages/types/` — update persona config type for new setting
3. `packages/feature-session-summary/src/handlers/create-first-summary.ts` — branch on `startType + config`
4. `packages/feature-session-summary/src/handlers/persona-selection.ts` — add "reuse" path
5. Daemon service layer — add `lastClearedPersona` field and SessionEnd handler
6. SessionEnd hook handler — capture persona on `reason="clear"`

## Testing

- Unit: `clear` + `persistThroughClear=true` + valid handoff → same persona preserved
- Unit: `clear` + `persistThroughClear=false` → normal re-selection
- Unit: `clear` + no handoff data → falls through to normal selection
- Unit: `clear` + stale handoff (> 5s) → falls through to normal selection
- Unit: `startup` → always selects fresh (unaffected by new config)
- Unit: `pinnedPersona` overrides handoff
