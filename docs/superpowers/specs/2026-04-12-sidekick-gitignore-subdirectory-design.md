# Sidekick .gitignore Migration to .sidekick/.gitignore

**Date:** 2026-04-12  
**Status:** Approved  
**Scope:** `packages/sidekick-core`, `packages/sidekick-cli`, `packages/types`

---

## Problem

During project setup, Sidekick currently appends a marked section to the project's root `.gitignore`. This modifies a file owned by the user, which is intrusive — especially in projects with strict file ownership, monorepos with managed ignore files, or teams that review `.gitignore` changes carefully.

All Sidekick ignore entries are scoped to `.sidekick/` paths. Git honors `.gitignore` files in subdirectories, applying them relative to the directory they live in. A `.sidekick/.gitignore` file with relative paths is functionally equivalent — without touching any user-owned files.

---

## Goals

1. New installs write `.sidekick/.gitignore` instead of modifying root `.gitignore`
2. Existing installs with the legacy root section continue working — no forced migration
3. `doctor` detects the legacy format and warns with a clear migration message
4. `doctor --fix` migrates: creates `.sidekick/.gitignore`, removes root section
5. `uninstall` cleans up either format

---

## Non-Goals

- Auto-migration on install or daemon start (forward-only change)
- Static template file for `.gitignore` content (entries are stable, detection is coupled)
- User customization of the generated `.sidekick/.gitignore`

---

## Data Model

### `GitignoreStatusSchema` (`packages/types/src/setup-status.ts`)

Add `'legacy'` to the existing enum:

```typescript
export const GitignoreStatusSchema = z.enum([
  'unknown',      // Setup hasn't checked yet (legacy projects)
  'missing',      // Not installed in any format
  'incomplete',   // File exists but missing expected entries
  'installed',    // .sidekick/.gitignore present with all entries (new format)
  'legacy',       // Root .gitignore has old marked section — functional, migrate recommended
])
```

`'legacy'` means the old format is present and functional. Doctor warns; wizard does not re-prompt.

---

## Architecture

### `packages/sidekick-core/src/gitignore.ts`

**`GITIGNORE_ENTRIES`** — Change from `.sidekick/`-prefixed paths to relative paths:

```typescript
export const GITIGNORE_ENTRIES = [
  'logs/',
  'sessions/',
  'state/',
  'setup-status.json',
  '.env',
  '.env.local',
  'sidekick*.pid',
  'sidekick*.token',
  '*.local.yaml',
]
```

**`installGitignoreSection(projectDir)`** — Writes `.sidekick/.gitignore`:
- Ensures `.sidekick/` directory exists (using `mkdir` with `recursive: true`)
- **Fully overwrites the file** on every install/repair — file is entirely managed by Sidekick, no user additions preserved (user customization is a non-goal)
- Writes all `GITIGNORE_ENTRIES` with a managed-file header comment
- Returns `'already-installed'` if file exists with all entries
- Self-repairs if file exists but entries are incomplete
- Does NOT touch root `.gitignore`

**`detectGitignoreStatus(projectDir)`** — Checks new format first, then legacy:
1. If `.sidekick/.gitignore` exists → verify entries → `'installed'` or `'incomplete'`
2. Else check root `.gitignore` for `# >>> sidekick` marker → `'legacy'` (marker-only check — no entry verification; legacy entries use `.sidekick/`-prefixed paths which differ from current `GITIGNORE_ENTRIES`)
3. Else → `'missing'`

**`removeGitignoreSection(projectDir)`** — Updated to remove new format:
- Deletes `.sidekick/.gitignore` if present
- Also removes root section if legacy format detected (handles either format cleanly)

**New: `detectLegacyGitignoreSection(projectDir): Promise<boolean>`**
- Reads root `.gitignore`, returns true if `# >>> sidekick` section is present
- Used by doctor and uninstall

**New: `removeLegacyGitignoreSection(projectDir): Promise<boolean>`**
- Removes the marked section from root `.gitignore`
- Returns true if section was found and removed
- Existing logic from current `removeGitignoreSection` moved here

### `packages/types/src/setup-status.ts`

- Add `'legacy'` to `GitignoreStatusSchema` as above

### `packages/sidekick-cli/src/commands/setup/doctor.ts`

**Gitignore check (without `--fix`):**

| Status | Output |
|--------|--------|
| `'installed'` | `✓ Gitignore: installed (.sidekick/.gitignore)` |
| `'legacy'` | `⚠ Gitignore: legacy section found in root .gitignore — run sidekick doctor --fix --only=gitignore to migrate` |
| `'incomplete'` | `⚠ Gitignore: incomplete` (existing behavior) |
| `'missing'` | `✗ Gitignore: missing` (existing behavior) |

**Gitignore check (`--fix`):**
1. If `'legacy'`: install `.sidekick/.gitignore`, then call `removeLegacyGitignoreSection`
2. If `'installed'`: check for legacy root section via `detectLegacyGitignoreSection` — if found, call `removeLegacyGitignoreSection` (cleans up redundant legacy section when both formats present)
3. If `'missing'`/`'incomplete'`: install `.sidekick/.gitignore` (existing behavior)
4. Report what was done (`migrated` | `cleaned-legacy` | `installed` | `repaired` | `already-installed`)

### `packages/sidekick-cli/src/commands/uninstall.ts`

- Call updated `removeGitignoreSection` which handles both formats
- Dry-run output describes which format will be cleaned

---

## `.sidekick/.gitignore` File Format

```
# Sidekick — managed file, do not edit manually
logs/
sessions/
state/
setup-status.json
.env
.env.local
sidekick*.pid
sidekick*.token
*.local.yaml
```

The file is committed to the project repo. Other developers who clone the repo benefit from the same ignore rules automatically.

---

## Behavior Summary

`detectGitignoreStatus` checks new format first. If `.sidekick/.gitignore` is present (even if legacy root section also exists), it returns `'installed'`. Legacy is only returned when new format is absent and root section is present.

| Scenario | Install | Doctor | Doctor --fix | Uninstall |
|----------|---------|--------|--------------|-----------|
| New install | Write `.sidekick/.gitignore` | ✓ installed | no-op | Delete `.sidekick/.gitignore` |
| Existing (legacy) | n/a | ⚠ legacy, migrate | Create new, remove root section | Remove root section |
| Both present | n/a | ✓ installed (legacy section silently redundant) | Remove legacy root section | Delete `.sidekick/.gitignore` + remove root section |
| Neither | Write `.sidekick/.gitignore` | ✗ missing | Create new | no-op |

---

## Testing

### `packages/sidekick-core/src/__tests__/gitignore.test.ts`

**Install (new format):**
- Creates `.sidekick/.gitignore` with all expected entries
- Writes header comment line
- Does NOT modify root `.gitignore`
- Idempotent — second call returns `'already-installed'`
- Self-repairs incomplete `.sidekick/.gitignore` (missing entries)

**Detection:**
- `'installed'` when `.sidekick/.gitignore` has all entries
- `'incomplete'` when `.sidekick/.gitignore` exists but missing entries
- `'legacy'` when root `.gitignore` has marked section, no `.sidekick/.gitignore`
- `'missing'` when neither format present
- `'installed'` takes precedence when both formats are present

**Legacy detection (`detectLegacyGitignoreSection`):**
- Returns `true` when root `.gitignore` has `# >>> sidekick` section
- Returns `false` when section absent
- Returns `false` when root `.gitignore` missing

**Legacy removal (`removeLegacyGitignoreSection`):**
- Removes marked section cleanly, preserves surrounding content
- Returns `true` on success, `false` if section not found

**Uninstall:**
- Deletes `.sidekick/.gitignore`
- Removes root section when legacy format present
- Handles neither format gracefully (no error)

### `packages/sidekick-cli/src/__tests__/doctor.test.ts` (or equivalent)

- Reports `⚠ legacy` with migration hint
- `--fix` on legacy: creates `.sidekick/.gitignore` + removes root section
- `--fix` on missing: creates `.sidekick/.gitignore`
- Root `.gitignore` has no Sidekick markers after `--fix`

---

## Migration Path for Existing Installs

No automatic migration. Users with the legacy format:
1. Continue working as-is (`'legacy'` is functional)
2. Migrate when ready: `sidekick doctor --fix --only=gitignore`
3. Commit the new `.sidekick/.gitignore` and the cleaned root `.gitignore`

---

## Files Changed

| File | Change |
|------|--------|
| `packages/types/src/setup-status.ts` | Add `'legacy'` to `GitignoreStatusSchema` |
| `packages/sidekick-core/src/gitignore.ts` | Rewrite install/detect/remove; add legacy helpers |
| `packages/sidekick-core/src/__tests__/gitignore.test.ts` | Update + add tests |
| `packages/sidekick-cli/src/commands/setup/index.ts` | Treat `'legacy'` as `'installed'` — no re-prompt |
| `packages/sidekick-cli/src/commands/setup/scripted.ts` | Handle `'legacy'` in status result |
| `packages/sidekick-cli/src/commands/setup/doctor.ts` | Enhanced gitignore check with legacy warning |
| `packages/sidekick-cli/src/commands/uninstall.ts` | Handle both formats |
