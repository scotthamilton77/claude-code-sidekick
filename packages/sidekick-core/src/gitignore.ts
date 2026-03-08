// packages/sidekick-core/src/gitignore.ts
/**
 * Gitignore management utilities for sidekick setup.
 *
 * Manages a marked section in .gitignore for sidekick's transient files.
 * Uses comment markers for easy identification and clean removal.
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { GitignoreStatus } from '@sidekick/types'

// Section markers for .gitignore
export const SIDEKICK_SECTION_START = '# >>> sidekick'
export const SIDEKICK_SECTION_END = '# <<< sidekick'

// Entries to add to .gitignore
export const GITIGNORE_ENTRIES = [
  '.sidekick/logs/',
  '.sidekick/sessions/',
  '.sidekick/state/',
  '.sidekick/setup-status.json',
  '.sidekick/.env',
  '.sidekick/.env.local',
  '.sidekick/sidekick*.pid',
  '.sidekick/sidekick*.token',
  '.sidekick/*.local.yaml',
  '.sidekick/features.yaml',
]

export interface GitignoreResult {
  status: 'installed' | 'already-installed' | 'error'
  entriesAdded?: string[]
  error?: string
}

/**
 * Install the sidekick section to .gitignore.
 *
 * Creates the file if it doesn't exist. Idempotent - returns 'already-installed'
 * if section is complete. Repairs incomplete sections automatically.
 */
export async function installGitignoreSection(projectDir: string): Promise<GitignoreResult> {
  const gitignorePath = path.join(projectDir, '.gitignore')

  let content = ''
  try {
    content = await fs.readFile(gitignorePath, 'utf-8')
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
      return { status: 'error', error: `Failed to read .gitignore: ${(err as Error).message}` }
    }
    // File doesn't exist, will create
  }

  // Check current status using full validation
  const status = await detectGitignoreStatus(projectDir)

  if (status === 'installed') {
    return { status: 'already-installed' }
  }

  // If incomplete, remove the old section first before reinstalling
  if (status === 'incomplete') {
    await removeGitignoreSection(projectDir)
    // Re-read content after removal
    try {
      content = await fs.readFile(gitignorePath, 'utf-8')
    } catch {
      content = ''
    }
  }

  // Build section
  const section = ['', SIDEKICK_SECTION_START, ...GITIGNORE_ENTRIES, SIDEKICK_SECTION_END].join('\n')

  const newContent = content.trimEnd() + section + '\n'

  try {
    await fs.writeFile(gitignorePath, newContent)
    return { status: 'installed', entriesAdded: GITIGNORE_ENTRIES }
  } catch (err) {
    return { status: 'error', error: `Failed to write .gitignore: ${(err as Error).message}` }
  }
}

/**
 * Remove the sidekick section from .gitignore.
 *
 * Returns true if section was found and removed, false otherwise.
 */
export async function removeGitignoreSection(projectDir: string): Promise<boolean> {
  const gitignorePath = path.join(projectDir, '.gitignore')

  try {
    const content = await fs.readFile(gitignorePath, 'utf-8')

    const startIdx = content.indexOf(SIDEKICK_SECTION_START)
    const endIdx = content.indexOf(SIDEKICK_SECTION_END)

    if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
      return false // Section not found or malformed
    }

    // Find the start of the line containing the start marker
    const lineStartIdx = content.lastIndexOf('\n', startIdx - 1) + 1

    // Find the end of the line containing the end marker
    const lineEndIdx = content.indexOf('\n', endIdx)
    const actualEndIdx = lineEndIdx === -1 ? content.length : lineEndIdx + 1

    // Remove section
    const before = content.slice(0, lineStartIdx).trimEnd()
    const after = content.slice(actualEndIdx).trimStart()

    const newContent = before + (after ? '\n' + after : '') + '\n'
    await fs.writeFile(gitignorePath, newContent)

    return true
  } catch {
    return false
  }
}

/**
 * Detect the current gitignore status for sidekick.
 *
 * Returns:
 * - 'installed': Section exists with both markers and all required entries
 * - 'incomplete': Section partially exists (missing end marker or entries)
 * - 'missing': No sidekick section found
 */
export async function detectGitignoreStatus(projectDir: string): Promise<GitignoreStatus> {
  const gitignorePath = path.join(projectDir, '.gitignore')

  try {
    const content = await fs.readFile(gitignorePath, 'utf-8')

    const hasStart = content.includes(SIDEKICK_SECTION_START)
    const hasEnd = content.includes(SIDEKICK_SECTION_END)

    // No section at all
    if (!hasStart && !hasEnd) {
      return 'missing'
    }

    // Partial section - missing one marker
    if (!hasStart || !hasEnd) {
      return 'incomplete'
    }

    // Check marker order
    const startIdx = content.indexOf(SIDEKICK_SECTION_START)
    const endIdx = content.indexOf(SIDEKICK_SECTION_END)
    if (endIdx <= startIdx) {
      return 'incomplete'
    }

    // Extract section content between markers
    const sectionContent = content.slice(startIdx, endIdx + SIDEKICK_SECTION_END.length)

    // Check all required entries are present
    const missingEntries = GITIGNORE_ENTRIES.filter((entry) => !sectionContent.includes(entry))
    if (missingEntries.length > 0) {
      return 'incomplete'
    }

    return 'installed'
  } catch {
    return 'missing'
  }
}
