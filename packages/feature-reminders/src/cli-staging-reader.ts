/**
 * CLI-Side Staging Reader
 *
 * Lightweight filesystem reader for consuming staged reminders in the CLI process.
 * The CLI cannot access SupervisorContext.staging, so it reads files directly.
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { StagedReminder, RuntimePaths } from '@sidekick/types'

const SUPPRESSED_MARKER = '.suppressed'

/**
 * Validate a path segment to prevent path traversal attacks.
 * Only allows alphanumeric, hyphens, and underscores.
 */
function isValidPathSegment(segment: string): boolean {
  return /^[\w-]+$/.test(segment) && !segment.includes('..')
}

export interface StagingReaderOptions {
  paths: RuntimePaths
  sessionId: string
}

/**
 * Read staged reminders from filesystem (CLI-side).
 * This is a read-only interface for CLI consumption.
 */
export class CLIStagingReader {
  private readonly stagingRoot: string

  constructor(options: StagingReaderOptions) {
    // State dir is under projectConfigDir (matches Supervisor's StagingService)
    // Consumption handlers only run in project scope, so this is always defined
    if (!options.paths.projectConfigDir) {
      throw new Error('CLIStagingReader requires project scope (projectConfigDir must be defined)')
    }
    this.stagingRoot = join(options.paths.projectConfigDir, 'sessions', options.sessionId, 'stage')
  }

  /**
   * Check if hook is suppressed and clear if so.
   * Returns true if suppressed (and cleared), false otherwise.
   */
  checkAndClearSuppression(hookName: string): boolean {
    if (!isValidPathSegment(hookName)) return false
    const markerPath = join(this.stagingRoot, hookName, SUPPRESSED_MARKER)
    if (existsSync(markerPath)) {
      unlinkSync(markerPath)
      return true
    }
    return false
  }

  /**
   * List all staged reminders for a hook, sorted by priority (highest first).
   */
  listReminders(hookName: string): StagedReminder[] {
    if (!isValidPathSegment(hookName)) return []
    const hookDir = join(this.stagingRoot, hookName)
    if (!existsSync(hookDir)) return []

    const files = readdirSync(hookDir).filter((f) => f.endsWith('.json'))
    const reminders: StagedReminder[] = []

    for (const file of files) {
      try {
        const content = readFileSync(join(hookDir, file), 'utf-8')
        reminders.push(JSON.parse(content) as StagedReminder)
      } catch {
        // Skip malformed files
      }
    }

    return reminders.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Delete a reminder file (for non-persistent consumption).
   */
  deleteReminder(hookName: string, reminderName: string): void {
    if (!isValidPathSegment(hookName) || !isValidPathSegment(reminderName)) return
    const path = join(this.stagingRoot, hookName, `${reminderName}.json`)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }
}
