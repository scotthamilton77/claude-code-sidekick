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
  '.sidekick/.env',
  '.sidekick/.env.local',
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
 * if section already exists.
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

  // Check if section already exists
  if (content.includes(SIDEKICK_SECTION_START)) {
    return { status: 'already-installed' }
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
 */
export async function detectGitignoreStatus(projectDir: string): Promise<GitignoreStatus> {
  const gitignorePath = path.join(projectDir, '.gitignore')

  try {
    const content = await fs.readFile(gitignorePath, 'utf-8')
    return content.includes(SIDEKICK_SECTION_START) ? 'installed' : 'missing'
  } catch {
    return 'missing'
  }
}
