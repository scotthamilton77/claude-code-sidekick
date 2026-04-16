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
 *
 * If the legacy format is present (root .gitignore section), this installs the
 * new format alongside it. Use removeLegacyGitignoreSection to clean up afterward.
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
    // Fall through to legacy check.
    // ENOENT: file not present. Other errors (EACCES, EISDIR, etc.) are treated
    // the same — can't determine new-format status, so check legacy.
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
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      throw err
    }
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
