# Persona Pinning Design

**Date:** 2026-03-02
**Issue:** sidekick-wh2f
**Status:** Approved

## Summary

Allow users to pin a specific persona at the project level (`.sidekick/`) or user level (`~/.sidekick/`) so new sessions default to that persona instead of random selection.

## Requirements

- Pin a persona at project scope (default) or user scope
- Project scope overrides user scope (existing config cascade)
- Per-session `persona set` overrides any pin
- `persona unpin` command to clear a pin
- Graceful fallback to random selection if pinned persona not found

## Precedence

1. **Session override** — `persona set <id> --session-id=<id>` (existing)
2. **Project pin** — `.sidekick/features.yaml` → `session-summary.personas.pinnedPersona`
3. **User pin** — `~/.sidekick/features.yaml` → `session-summary.personas.pinnedPersona`
4. **Random selection** — existing weighted random from eligible pool

## Approach: Config-file Based Pin

Add `pinnedPersona` to the existing `session-summary.personas` config section. The config cascade already handles project-over-user resolution.

### Data Model

**New config key:** `features.session-summary.personas.pinnedPersona`

- Type: `string` (persona ID) or empty string (no pin)
- Default: `""` (empty — random selection)
- Stored in existing YAML config files via `configSet`/`configUnset`

### Selection Logic

In `selectPersonaForSession()`, add an early-exit before random selection:

1. Merge persona config (existing)
2. Create persona loader, discover all personas (existing)
3. **NEW: Check `pinnedPersona`**
   - Non-empty AND persona exists → persist as session persona, return (skip random)
   - Non-empty but NOT found → log warning, fall through to random
   - Empty → continue to random (no pin)
4. Parse allowList/blockList, filter, weighted random (existing)

Pinned persona bypasses allowList/blockList/weights — it is an explicit override.

### CLI Commands

**`persona pin <persona-id> [--scope=project|user]`**
- Default scope: `project`
- Validates persona ID exists
- Uses `configSet('features.session-summary.personas.pinnedPersona', personaId, { scope })`
- Returns: `{ success, personaId, scope, filePath }`

**`persona unpin [--scope=project|user]`**
- Default scope: `project`
- Uses `configUnset('features.session-summary.personas.pinnedPersona', { scope })`
- Returns: `{ success, scope, previousPersonaId, filePath }`
- Idempotent: no-pin returns `{ success: true, previousPersonaId: null }`

No daemon/IPC needed — direct file operations via config-writer.

### Error Handling

- Invalid persona ID on `pin` → error with available IDs listed
- Config write failure → propagated from `configSet` (has built-in rollback)
- Missing persona at selection time → warning log + fallback to random

## Files Changed

| File | Change |
|------|--------|
| `feature-session-summary/src/types.ts` | Add `pinnedPersona?: string` to personas config |
| `feature-session-summary/src/handlers/persona-selection.ts` | Early-exit for pinned persona |
| `sidekick-cli/src/commands/persona.ts` | Add `pin`/`unpin` handlers + help text |
| `assets/sidekick/defaults/features/session-summary.defaults.yaml` | Add `pinnedPersona: ""` default |
| + corresponding test files | |

## Test Plan

### Unit: persona-selection.test.ts
- Pinned persona found → returns pinned, skips random
- Pinned persona not found → logs warning, falls back to random
- Pinned persona empty → random selection (no pin)
- Pin bypasses allowList/blockList

### CLI: persona.test.ts
- `persona pin valid-id` → writes to project config
- `persona pin valid-id --scope=user` → writes to user config
- `persona pin invalid-id` → error, persona not found
- `persona unpin` → removes from project config
- `persona unpin --scope=user` → removes from user config
- `persona unpin` when no pin → success (idempotent)
