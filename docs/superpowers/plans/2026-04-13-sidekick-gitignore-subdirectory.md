# Sidekick .gitignore Migration to .sidekick/.gitignore — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace root `.gitignore` modification with a `.sidekick/.gitignore` file, and add legacy detection/migration to `doctor`.

**Architecture:** New installs write `.sidekick/.gitignore` with relative paths. `detectGitignoreStatus` checks the new file first, then falls back to marker detection in root `.gitignore` (returning `'legacy'`). `doctor --fix` migrates legacy installs. Uninstall handles both formats.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Zod, Vitest

**Spec:** `docs/superpowers/specs/2026-04-12-sidekick-gitignore-subdirectory-design.md`

---

## File Map

| File | Action | What changes |
|------|--------|--------------|
| `packages/types/src/setup-status.ts` | Modify | Add `'legacy'` to `GitignoreStatusSchema` |
| `packages/sidekick-core/src/gitignore.ts` | Rewrite | New functions, new file target, relative paths |
| `packages/sidekick-core/src/index.ts` | Modify | Export new functions and constant |
| `packages/sidekick-core/src/__tests__/gitignore.test.ts` | Rewrite | New test suite for new behavior |
| `packages/sidekick-cli/src/commands/setup/index.ts` | Modify | Treat `'legacy'` as already-configured |
| `packages/sidekick-cli/src/commands/setup/doctor.ts` | Modify | Legacy warning + updated fix logic |
| `packages/sidekick-cli/src/commands/uninstall.ts` | Modify | Summary detection for both formats |

> **Note:** `packages/sidekick-cli/src/commands/setup/scripted.ts` requires no changes — it stores `installGitignoreSection` return values which remain `'installed'/'already-installed'/'error'`, and its fallback `existingProject?.gitignore ?? 'unknown'` already preserves any stored `'legacy'` status transparently.

---

## Task 1: Add `'legacy'` to `GitignoreStatusSchema`

**Files:**
- Modify: `packages/types/src/setup-status.ts:124-129`

This is the foundation — the new status value must exist before any other task compiles.

- [ ] **Step 1: Write the failing typecheck**

Before editing, verify the current enum:

```bash
cd /path/to/project
grep -A 6 "GitignoreStatusSchema" packages/types/src/setup-status.ts
```

Expected output: enum has 4 values, no `'legacy'`.

- [ ] **Step 2: Add `'legacy'` to the enum**

In `packages/types/src/setup-status.ts`, replace lines 121–130:

```typescript
/**
 * Gitignore setup status for project.
 */
export const GitignoreStatusSchema = z.enum([
  'unknown',     // Setup hasn't checked yet (legacy projects)
  'missing',     // User declined or entries not present
  'incomplete',  // Section exists but missing end marker or required entries
  'installed',   // .sidekick/.gitignore present with all entries (new format)
  'legacy',      // Root .gitignore has old marked section — functional, migrate recommended
])
export type GitignoreStatus = z.infer<typeof GitignoreStatusSchema>
```

- [ ] **Step 3: Verify typecheck passes**

```bash
pnpm --filter @sidekick/types build
```

Expected: build succeeds, no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/types/src/setup-status.ts
git commit -m "feat(types): add 'legacy' to GitignoreStatusSchema"
```

---

## Task 2: Rewrite `gitignore.ts` Core Logic

**Files:**
- Rewrite: `packages/sidekick-core/src/gitignore.ts`
- Modify: `packages/sidekick-core/src/index.ts:184-192`

This task replaces all core gitignore logic. The key changes:
- `GITIGNORE_ENTRIES` uses relative paths (no `.sidekick/` prefix)
- `installGitignoreSection` writes `.sidekick/.gitignore`, never touches root `.gitignore`
- `detectGitignoreStatus` checks new format first, then legacy marker
- `removeGitignoreSection` handles both formats
- New: `detectLegacyGitignoreSection`, `removeLegacyGitignoreSection`

- [ ] **Step 1: Replace `gitignore.ts` with new implementation**

Replace the entire contents of `packages/sidekick-core/src/gitignore.ts`:

```typescript
// packages/sidekick-core/src/gitignore.ts
/**
 * Gitignore management utilities for sidekick setup.
 *
 * New format: writes .sidekick/.gitignore with relative paths.
 * Legacy format: marked section in project root .gitignore (detected and removed, never written).
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { GitignoreStatus } from '@sidekick/types'

// Markers for legacy root .gitignore section (detect/remove only — no longer written)
export const SIDEKICK_SECTION_START = '# >>> sidekick'
export const SIDEKICK_SECTION_END = '# <<< sidekick'

// Header written to .sidekick/.gitignore
export const SIDEKICK_GITIGNORE_HEADER = '# Sidekick — managed file, do not edit manually'

// Entries written to .sidekick/.gitignore (relative paths — apply within .sidekick/)
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

export interface GitignoreResult {
  status: 'installed' | 'already-installed' | 'error'
  entriesAdded?: string[]
  error?: string
}

/**
 * Install sidekick gitignore rules by writing .sidekick/.gitignore.
 *
 * Fully overwrites the file on every repair — it is entirely managed by Sidekick.
 * Idempotent: returns 'already-installed' if all entries are present.
 * Does NOT touch the project root .gitignore.
 */
export async function installGitignoreSection(projectDir: string): Promise<GitignoreResult> {
  const status = await detectGitignoreStatus(projectDir)
  if (status === 'installed') {
    return { status: 'already-installed' }
  }

  const sidekickDir = path.join(projectDir, '.sidekick')
  try {
    await fs.mkdir(sidekickDir, { recursive: true })
  } catch (err) {
    return { status: 'error', error: `Failed to create .sidekick directory: ${(err as Error).message}` }
  }

  const content = [SIDEKICK_GITIGNORE_HEADER, ...GITIGNORE_ENTRIES].join('\n') + '\n'

  try {
    await fs.writeFile(path.join(sidekickDir, '.gitignore'), content)
    return { status: 'installed', entriesAdded: GITIGNORE_ENTRIES }
  } catch (err) {
    return { status: 'error', error: `Failed to write .sidekick/.gitignore: ${(err as Error).message}` }
  }
}

/**
 * Detect the current gitignore status for sidekick.
 *
 * Checks new format (.sidekick/.gitignore) first, then legacy root section.
 *
 * Returns:
 * - 'installed':   .sidekick/.gitignore exists with all required entries
 * - 'incomplete':  .sidekick/.gitignore exists but missing one or more entries
 * - 'legacy':      root .gitignore has old marked section (marker-only check)
 * - 'missing':     neither format present
 */
export async function detectGitignoreStatus(projectDir: string): Promise<GitignoreStatus> {
  const sidekickGitignorePath = path.join(projectDir, '.sidekick', '.gitignore')

  try {
    const content = await fs.readFile(sidekickGitignorePath, 'utf-8')
    const missingEntries = GITIGNORE_ENTRIES.filter((entry) => !content.includes(entry))
    return missingEntries.length === 0 ? 'installed' : 'incomplete'
  } catch {
    // .sidekick/.gitignore not found — check for legacy
  }

  const hasLegacy = await detectLegacyGitignoreSection(projectDir)
  return hasLegacy ? 'legacy' : 'missing'
}

/**
 * Remove sidekick gitignore rules.
 *
 * Deletes .sidekick/.gitignore if present.
 * Also removes any legacy root .gitignore section if present.
 * Returns true if at least one artifact was removed.
 */
export async function removeGitignoreSection(projectDir: string): Promise<boolean> {
  let removed = false

  try {
    await fs.unlink(path.join(projectDir, '.sidekick', '.gitignore'))
    removed = true
  } catch {
    // File doesn't exist — nothing to remove
  }

  const legacyRemoved = await removeLegacyGitignoreSection(projectDir)
  return removed || legacyRemoved
}

/**
 * Detect whether the legacy sidekick section exists in root .gitignore.
 *
 * Uses marker-only detection. Legacy entries use .sidekick/-prefixed paths
 * which differ from current GITIGNORE_ENTRIES.
 */
export async function detectLegacyGitignoreSection(projectDir: string): Promise<boolean> {
  try {
    const content = await fs.readFile(path.join(projectDir, '.gitignore'), 'utf-8')
    return content.includes(SIDEKICK_SECTION_START)
  } catch {
    return false
  }
}

/**
 * Remove the legacy sidekick section from root .gitignore.
 *
 * Returns true if section was found and removed, false otherwise.
 */
export async function removeLegacyGitignoreSection(projectDir: string): Promise<boolean> {
  const rootGitignorePath = path.join(projectDir, '.gitignore')

  try {
    const content = await fs.readFile(rootGitignorePath, 'utf-8')

    const startIdx = content.indexOf(SIDEKICK_SECTION_START)
    const endIdx = content.indexOf(SIDEKICK_SECTION_END)

    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      return false
    }

    const lineStartIdx = content.lastIndexOf('\n', startIdx - 1) + 1
    const lineEndIdx = content.indexOf('\n', endIdx)
    const actualEndIdx = lineEndIdx === -1 ? content.length : lineEndIdx + 1

    const before = content.slice(0, lineStartIdx).trimEnd()
    const after = content.slice(actualEndIdx).trimStart()

    const newContent = before + (after ? '\n' + after : '') + '\n'
    await fs.writeFile(rootGitignorePath, newContent)
    return true
  } catch {
    return false
  }
}
```

- [ ] **Step 2: Update `packages/sidekick-core/src/index.ts` exports**

Replace the gitignore export block (lines 184–192 in current file):

```typescript
export {
  installGitignoreSection,
  removeGitignoreSection,
  detectGitignoreStatus,
  detectLegacyGitignoreSection,
  removeLegacyGitignoreSection,
  SIDEKICK_SECTION_START,
  SIDEKICK_SECTION_END,
  SIDEKICK_GITIGNORE_HEADER,
  GITIGNORE_ENTRIES,
  type GitignoreResult,
} from './gitignore'
```

- [ ] **Step 3: Verify core package builds**

```bash
pnpm --filter @sidekick/core build
```

Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add packages/sidekick-core/src/gitignore.ts packages/sidekick-core/src/index.ts
git commit -m "feat(core): rewrite gitignore to use .sidekick/.gitignore; add legacy detection"
```

---

## Task 3: Rewrite `gitignore.test.ts`

**Files:**
- Rewrite: `packages/sidekick-core/src/__tests__/gitignore.test.ts`

The entire test suite is replaced. Tests now verify behavior against `.sidekick/.gitignore` instead of the root `.gitignore`.

- [ ] **Step 1: Write the new test suite**

Replace the entire contents of `packages/sidekick-core/src/__tests__/gitignore.test.ts`:

```typescript
// packages/sidekick-core/src/__tests__/gitignore.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as path from 'node:path'
import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import {
  installGitignoreSection,
  removeGitignoreSection,
  detectGitignoreStatus,
  detectLegacyGitignoreSection,
  removeLegacyGitignoreSection,
  SIDEKICK_SECTION_START,
  SIDEKICK_SECTION_END,
  SIDEKICK_GITIGNORE_HEADER,
  GITIGNORE_ENTRIES,
} from '../gitignore'

describe('gitignore utilities', () => {
  const testDir = path.join(__dirname, 'gitignore-test-tmp')
  const sidekickDir = path.join(testDir, '.sidekick')
  const sidekickGitignore = path.join(sidekickDir, '.gitignore')
  const rootGitignore = path.join(testDir, '.gitignore')

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true })
  })

  describe('installGitignoreSection', () => {
    it('creates .sidekick/.gitignore with header and all entries', async () => {
      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('installed')
      expect(result.entriesAdded).toEqual(GITIGNORE_ENTRIES)

      const content = readFileSync(sidekickGitignore, 'utf-8')
      expect(content).toContain(SIDEKICK_GITIGNORE_HEADER)
      for (const entry of GITIGNORE_ENTRIES) {
        expect(content).toContain(entry)
      }
    })

    it('creates .sidekick/ directory if it does not exist', async () => {
      expect(existsSync(sidekickDir)).toBe(false)

      await installGitignoreSection(testDir)

      expect(existsSync(sidekickDir)).toBe(true)
      expect(existsSync(sidekickGitignore)).toBe(true)
    })

    it('does NOT touch root .gitignore', async () => {
      writeFileSync(rootGitignore, 'node_modules/\n')

      await installGitignoreSection(testDir)

      expect(readFileSync(rootGitignore, 'utf-8')).toBe('node_modules/\n')
    })

    it('does NOT create root .gitignore when none exists', async () => {
      await installGitignoreSection(testDir)

      expect(existsSync(rootGitignore)).toBe(false)
    })

    it('returns already-installed when all entries are present', async () => {
      await installGitignoreSection(testDir)

      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('already-installed')
    })

    it('repairs incomplete .sidekick/.gitignore by overwriting', async () => {
      mkdirSync(sidekickDir, { recursive: true })
      writeFileSync(sidekickGitignore, '# partial\nlogs/\n')

      const result = await installGitignoreSection(testDir)

      expect(result.status).toBe('installed')
      const content = readFileSync(sidekickGitignore, 'utf-8')
      for (const entry of GITIGNORE_ENTRIES) {
        expect(content).toContain(entry)
      }
    })

    it('is idempotent — entries appear exactly once', async () => {
      await installGitignoreSection(testDir)
      await installGitignoreSection(testDir)

      const content = readFileSync(sidekickGitignore, 'utf-8')
      for (const entry of GITIGNORE_ENTRIES) {
        expect(content.split(entry).length - 1).toBe(1)
      }
    })
  })

  describe('detectGitignoreStatus', () => {
    it('returns installed when .sidekick/.gitignore has all entries', async () => {
      await installGitignoreSection(testDir)

      expect(await detectGitignoreStatus(testDir)).toBe('installed')
    })

    it('returns incomplete when .sidekick/.gitignore exists but missing entries', async () => {
      mkdirSync(sidekickDir, { recursive: true })
      writeFileSync(sidekickGitignore, 'logs/\nsessions/\n') // missing 7 entries

      expect(await detectGitignoreStatus(testDir)).toBe('incomplete')
    })

    it('returns legacy when root .gitignore has sidekick markers, no .sidekick/.gitignore', async () => {
      const legacy = `node_modules/\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`
      writeFileSync(rootGitignore, legacy)

      expect(await detectGitignoreStatus(testDir)).toBe('legacy')
    })

    it('returns missing when neither format present', async () => {
      expect(await detectGitignoreStatus(testDir)).toBe('missing')
    })

    it('returns missing when root .gitignore exists without sidekick section', async () => {
      writeFileSync(rootGitignore, 'node_modules/\n.env\n')

      expect(await detectGitignoreStatus(testDir)).toBe('missing')
    })

    it('returns installed when both formats present (new format takes precedence)', async () => {
      await installGitignoreSection(testDir)
      writeFileSync(rootGitignore, `${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`)

      expect(await detectGitignoreStatus(testDir)).toBe('installed')
    })
  })

  describe('detectLegacyGitignoreSection', () => {
    it('returns true when root .gitignore contains sidekick start marker', async () => {
      writeFileSync(
        rootGitignore,
        `node_modules/\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`
      )

      expect(await detectLegacyGitignoreSection(testDir)).toBe(true)
    })

    it('returns false when root .gitignore has no sidekick marker', async () => {
      writeFileSync(rootGitignore, 'node_modules/\n')

      expect(await detectLegacyGitignoreSection(testDir)).toBe(false)
    })

    it('returns false when root .gitignore does not exist', async () => {
      expect(await detectLegacyGitignoreSection(testDir)).toBe(false)
    })
  })

  describe('removeLegacyGitignoreSection', () => {
    it('removes sidekick section and preserves surrounding content', async () => {
      writeFileSync(
        rootGitignore,
        `node_modules/\n\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n.env\n`
      )

      const result = await removeLegacyGitignoreSection(testDir)

      expect(result).toBe(true)
      const content = readFileSync(rootGitignore, 'utf-8')
      expect(content).not.toContain(SIDEKICK_SECTION_START)
      expect(content).not.toContain(SIDEKICK_SECTION_END)
      expect(content).toContain('node_modules/')
      expect(content).toContain('.env')
    })

    it('returns false when section is not present', async () => {
      writeFileSync(rootGitignore, 'node_modules/\n')

      expect(await removeLegacyGitignoreSection(testDir)).toBe(false)
    })

    it('returns false when root .gitignore does not exist', async () => {
      expect(await removeLegacyGitignoreSection(testDir)).toBe(false)
    })

    it('returns false when markers are malformed (end before start)', async () => {
      writeFileSync(
        rootGitignore,
        `${SIDEKICK_SECTION_END}\n.sidekick/logs/\n${SIDEKICK_SECTION_START}\n`
      )

      expect(await removeLegacyGitignoreSection(testDir)).toBe(false)
      // File unchanged
      const content = readFileSync(rootGitignore, 'utf-8')
      expect(content).toContain(SIDEKICK_SECTION_START)
    })
  })

  describe('removeGitignoreSection', () => {
    it('deletes .sidekick/.gitignore', async () => {
      await installGitignoreSection(testDir)

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(true)
      expect(existsSync(sidekickGitignore)).toBe(false)
    })

    it('removes legacy root section when only legacy format present', async () => {
      writeFileSync(
        rootGitignore,
        `node_modules/\n${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`
      )

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(true)
      expect(readFileSync(rootGitignore, 'utf-8')).not.toContain(SIDEKICK_SECTION_START)
    })

    it('removes both formats when both present', async () => {
      await installGitignoreSection(testDir)
      writeFileSync(rootGitignore, `${SIDEKICK_SECTION_START}\n.sidekick/logs/\n${SIDEKICK_SECTION_END}\n`)

      const result = await removeGitignoreSection(testDir)

      expect(result).toBe(true)
      expect(existsSync(sidekickGitignore)).toBe(false)
      expect(readFileSync(rootGitignore, 'utf-8')).not.toContain(SIDEKICK_SECTION_START)
    })

    it('returns false when neither format present', async () => {
      expect(await removeGitignoreSection(testDir)).toBe(false)
    })
  })

  describe('constants', () => {
    it('GITIGNORE_ENTRIES uses relative paths (no .sidekick/ prefix)', () => {
      for (const entry of GITIGNORE_ENTRIES) {
        expect(entry).not.toMatch(/^\.sidekick\//)
      }
    })

    it('includes all expected entries', () => {
      expect(GITIGNORE_ENTRIES).toContain('logs/')
      expect(GITIGNORE_ENTRIES).toContain('sessions/')
      expect(GITIGNORE_ENTRIES).toContain('state/')
      expect(GITIGNORE_ENTRIES).toContain('setup-status.json')
      expect(GITIGNORE_ENTRIES).toContain('.env')
      expect(GITIGNORE_ENTRIES).toContain('.env.local')
      expect(GITIGNORE_ENTRIES).toContain('sidekick*.pid')
      expect(GITIGNORE_ENTRIES).toContain('sidekick*.token')
      expect(GITIGNORE_ENTRIES).toContain('*.local.yaml')
    })

    it('SIDEKICK_GITIGNORE_HEADER is a comment line', () => {
      expect(SIDEKICK_GITIGNORE_HEADER).toMatch(/^#/)
    })
  })
})
```

- [ ] **Step 2: Run tests**

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```

Expected: all tests in `gitignore.test.ts` pass. If any fail, the implementation in Task 2 has a bug — fix there, not in the tests.

- [ ] **Step 3: Commit**

```bash
git add packages/sidekick-core/src/__tests__/gitignore.test.ts
git commit -m "test(core): rewrite gitignore tests for .sidekick/.gitignore behavior"
```

---

## Task 4: Update `setup/index.ts` — Treat `'legacy'` as Configured

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/index.ts:190-194`

The wizard must not re-prompt users who already have the legacy format installed. Currently only `'installed'` is treated as already-done; add `'legacy'`.

- [ ] **Step 1: Update the early-return check in `runStep3Gitignore`**

In `packages/sidekick-cli/src/commands/setup/index.ts`, find (line ~190):

```typescript
  if (currentStatus === 'installed') {
    if (!force) {
      printStatus(ctx, 'success', 'Sidekick entries already present in .gitignore')
    }
    return 'installed'
  }
```

Replace with:

```typescript
  if (currentStatus === 'installed' || currentStatus === 'legacy') {
    if (!force) {
      printStatus(ctx, 'success', 'Sidekick entries already present in .gitignore')
    }
    return currentStatus
  }
```

- [ ] **Step 2: Build the CLI package to check for type errors**

```bash
pnpm --filter @sidekick/cli build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/index.ts
git commit -m "feat(cli): treat legacy gitignore format as already-configured in setup wizard"
```

---

## Task 5: Update `setup/doctor.ts` — Legacy Warning + Fix Logic

**Files:**
- Modify: `packages/sidekick-cli/src/commands/setup/doctor.ts:15-21` (imports)
- Modify: `packages/sidekick-cli/src/commands/setup/doctor.ts:312-321` (detection output)
- Modify: `packages/sidekick-cli/src/commands/setup/doctor.ts:139-149` (fix logic)

- [ ] **Step 1: Add new imports to `doctor.ts`**

Find the gitignore import block (around line 15–21):

```typescript
import {
  SetupStatusService,
  installGitignoreSection,
  detectGitignoreStatus,
  findZombieDaemons,
  killZombieDaemons,
  USER_STATUS_FILENAME,
```

Add `detectLegacyGitignoreSection` and `removeLegacyGitignoreSection`:

```typescript
import {
  SetupStatusService,
  installGitignoreSection,
  detectGitignoreStatus,
  detectLegacyGitignoreSection,
  removeLegacyGitignoreSection,
  findZombieDaemons,
  killZombieDaemons,
  USER_STATUS_FILENAME,
```

- [ ] **Step 2: Update the gitignore detection output**

Find (around line 313–320):

```typescript
  if (shouldRun('gitignore')) {
    promises.push(
      detectGitignoreStatus(projectDir).then((result) => {
        gitignore = result
        const gitignoreIcon = result === 'installed' ? '✓' : '⚠'
        stdout.write(`${gitignoreIcon} Gitignore: ${result}\n`)
      })
    )
  }
```

Replace with:

```typescript
  if (shouldRun('gitignore')) {
    promises.push(
      detectGitignoreStatus(projectDir).then((result) => {
        gitignore = result
        const gitignoreIcon = result === 'installed' ? '✓' : '⚠'
        const gitignoreMessage =
          result === 'legacy'
            ? `legacy section found in root .gitignore — run sidekick doctor --fix --only=gitignore to migrate`
            : result
        stdout.write(`${gitignoreIcon} Gitignore: ${gitignoreMessage}\n`)
      })
    )
  }
```

- [ ] **Step 3: Update the gitignore fix logic**

Find the `shouldFix('gitignore')` block (around line 139):

```typescript
  // Fix: Missing/incomplete gitignore
  if (shouldFix('gitignore') && gitignore !== null && gitignore !== 'installed') {
    stdout.write('Fixing: Gitignore\n')
    const result = await installGitignoreSection(projectDir)
    if (result.status === 'error') {
      stdout.write(`  ⚠ Failed to update .gitignore: ${result.error}\n`)
    } else {
      stdout.write('  ✓ Gitignore configured\n')
      fixedCount++
    }
  }
```

Replace with:

```typescript
  // Fix: Missing/incomplete/legacy gitignore
  if (shouldFix('gitignore') && gitignore !== null) {
    if (gitignore === 'legacy') {
      stdout.write('Fixing: Gitignore (migrating legacy format)\n')
      const result = await installGitignoreSection(projectDir)
      if (result.status === 'error') {
        stdout.write(`  ⚠ Failed to create .sidekick/.gitignore: ${result.error}\n`)
      } else {
        await removeLegacyGitignoreSection(projectDir)
        stdout.write('  ✓ Migrated to .sidekick/.gitignore and removed legacy root section\n')
        fixedCount++
      }
    } else if (gitignore === 'installed') {
      const hasLegacy = await detectLegacyGitignoreSection(projectDir)
      if (hasLegacy) {
        stdout.write('Fixing: Gitignore (removing redundant legacy section)\n')
        await removeLegacyGitignoreSection(projectDir)
        stdout.write('  ✓ Removed legacy section from root .gitignore\n')
        fixedCount++
      }
    } else {
      // 'missing' or 'incomplete'
      stdout.write('Fixing: Gitignore\n')
      const result = await installGitignoreSection(projectDir)
      if (result.status === 'error') {
        stdout.write(`  ⚠ Failed to update .sidekick/.gitignore: ${result.error}\n`)
      } else {
        stdout.write('  ✓ Gitignore configured\n')
        fixedCount++
      }
    }
  }
```

- [ ] **Step 4: Build CLI to verify**

```bash
pnpm --filter @sidekick/cli build
```

Expected: build succeeds, no type errors.

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-cli/src/commands/setup/doctor.ts
git commit -m "feat(cli): doctor detects legacy gitignore format and migrates via --fix"
```

---

## Task 6: Update `uninstall.ts` — Summary Detection for Both Formats

**Files:**
- Modify: `packages/sidekick-cli/src/commands/uninstall.ts:389-395`

The uninstall summary pre-scan checks what artifacts exist before asking the user to confirm. It needs to detect `.sidekick/.gitignore` (new format) as well as the legacy root section.

The actual removal at line 231 (`removeGitignoreSection(projectDir)`) already handles both formats because it was rewritten in Task 2 — no change needed there.

- [ ] **Step 1: Update the summary detection block**

Find (around line 389–395):

```typescript
    // .gitignore
    if (!devModeActive) {
      const gitignore = await readFileOrNull(path.join(projectDir, '.gitignore'))
      if (gitignore?.includes('# >>> sidekick')) {
        summary.project.push({ label: '.gitignore', details: 'sidekick section' })
      }
    }
```

Replace with:

```typescript
    // .gitignore — check new format (.sidekick/.gitignore) and legacy root section
    if (!devModeActive) {
      const sidekickGitignore = await readFileOrNull(path.join(projectDir, '.sidekick', '.gitignore'))
      const rootGitignore = await readFileOrNull(path.join(projectDir, '.gitignore'))
      if (sidekickGitignore !== null) {
        summary.project.push({ label: '.sidekick/.gitignore', details: 'sidekick managed file' })
      } else if (rootGitignore?.includes('# >>> sidekick')) {
        summary.project.push({ label: '.gitignore', details: 'sidekick section' })
      }
    }
```

- [ ] **Step 2: Build CLI to verify**

```bash
pnpm --filter @sidekick/cli build
```

Expected: build succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/sidekick-cli/src/commands/uninstall.ts
git commit -m "feat(cli): uninstall detects .sidekick/.gitignore in summary scan"
```

---

## Task 7: Full Verification

- [ ] **Step 1: Full build and typecheck**

```bash
pnpm build && pnpm typecheck
```

Expected: no errors across all packages.

- [ ] **Step 2: Lint**

```bash
pnpm lint
```

Expected: no lint errors.

- [ ] **Step 3: Run core tests**

```bash
pnpm --filter @sidekick/core test -- --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'
```

Expected: all tests pass.

- [ ] **Step 4: Run CLI tests (if present)**

```bash
pnpm --filter @sidekick/cli test 2>/dev/null || echo "No CLI tests to run"
```

- [ ] **Step 5: Smoke test — install creates correct file**

> Note: `pnpm sidekick` must be run from the project root (`/path/to/claude-code-sidekick`). Create the smoke project first, then run sidekick targeting it. The `--project-dir` pattern below is illustrative — use whatever invocation runs the local build against a temp project.

```bash
SMOKE=/tmp/sidekick-smoke-test
mkdir -p "$SMOKE" && cd "$SMOKE" && git init && cd -
# From sidekick project root:
pnpm sidekick setup --gitignore --no-statusline --no-personas
# Verify:
cat "$SMOKE/.sidekick/.gitignore"
cat "$SMOKE/.gitignore" 2>/dev/null || echo "root .gitignore not created — correct"
```

Expected: `$SMOKE/.sidekick/.gitignore` contains all entries and the managed-file header. Root `.gitignore` either does not exist or is unchanged.

- [ ] **Step 6: Smoke test — doctor detects legacy**

```bash
SMOKE=/tmp/sidekick-smoke-test
printf '# >>> sidekick\n.sidekick/logs/\n# <<< sidekick\n' > "$SMOKE/.gitignore"
rm -f "$SMOKE/.sidekick/.gitignore"
# From sidekick project root:
pnpm sidekick doctor --only=gitignore
```

Expected output contains: `⚠ Gitignore: legacy section found in root .gitignore — run sidekick doctor --fix --only=gitignore to migrate`

- [ ] **Step 7: Smoke test — doctor --fix migrates legacy**

```bash
# From sidekick project root:
pnpm sidekick doctor --fix --only=gitignore
cat "$SMOKE/.sidekick/.gitignore"
grep "sidekick" "$SMOKE/.gitignore" 2>/dev/null || echo "root .gitignore has no sidekick section — correct"
```

Expected: `$SMOKE/.sidekick/.gitignore` now exists with all entries. Root `.gitignore` has no sidekick markers.

- [ ] **Step 8: Clean up smoke test**

```bash
rm -rf /tmp/sidekick-smoke-test
```
