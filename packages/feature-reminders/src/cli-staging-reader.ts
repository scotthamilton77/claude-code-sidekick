/**
 * CLI-Side Staging Reader
 *
 * Lightweight filesystem reader for consuming staged reminders in the CLI process.
 * The CLI cannot access DaemonContext.staging, so it reads files directly.
 *
 * ## Architectural Note
 *
 * This class duplicates some logic from StagingServiceCore because:
 * 1. CLI hooks run in a separate process without DaemonContext
 * 2. StateService is async-only; CLI uses sync I/O for simplicity
 * 3. No logger is available in CLI hook context
 *
 * Path construction and validation are shared via staging-paths module.
 * See staging-paths.ts for the full architectural discussion and future direction.
 *
 * @see docs/design/FEATURE-REMINDERS.md §3.1 Consumption Handlers
 * @see packages/sidekick-core/src/staging-paths.ts
 */

import { existsSync, readdirSync, readFileSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import {
  renameWithTimestampSync,
  getHookDir,
  getReminderPath,
  isValidPathSegment,
  filterActiveReminderFiles,
} from '@sidekick/core'
import type { StagedReminder, RuntimePaths } from '@sidekick/types'
import { StagedReminderSchema } from '@sidekick/types'

export interface StagingReaderOptions {
  paths: RuntimePaths
  sessionId: string
}

/**
 * Read staged reminders from filesystem (CLI-side).
 * This is a read-only interface for CLI consumption.
 *
 * Uses shared path helpers from staging-paths module for consistency
 * with StagingServiceCore, but performs sync I/O directly (no StateService).
 */
export class CLIStagingReader {
  private readonly stateDir: string
  private readonly sessionId: string

  constructor(options: StagingReaderOptions) {
    // State dir is under projectConfigDir (matches Daemon's StagingService)
    // Consumption handlers only run in project scope, so this is always defined
    if (!options.paths.projectConfigDir) {
      throw new Error('CLIStagingReader requires project scope (projectConfigDir must be defined)')
    }
    this.stateDir = options.paths.projectConfigDir
    this.sessionId = options.sessionId
  }

  /**
   * List all staged reminders for a hook, sorted by priority (highest first).
   * Excludes consumed reminders (files with timestamp suffix like `name.1234567890.json`).
   */
  listReminders(hookName: string): StagedReminder[] {
    if (!isValidPathSegment(hookName)) return []
    const hookDir = getHookDir(this.stateDir, this.sessionId, hookName)
    if (!existsSync(hookDir)) return []

    // Filter to active reminder files (excludes consumed files with timestamp suffix)
    const files = filterActiveReminderFiles(readdirSync(hookDir))
    const reminders: StagedReminder[] = []

    for (const file of files) {
      try {
        const content = readFileSync(join(hookDir, file), 'utf-8')
        const parsed = StagedReminderSchema.safeParse(JSON.parse(content))
        if (parsed.success) {
          reminders.push(parsed.data)
        }
        // Skip invalid files silently (CLI context, no logger available)
      } catch {
        // Skip malformed files silently (CLI context, no logger available)
      }
    }

    return reminders.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Delete a reminder file (for non-persistent consumption).
   */
  deleteReminder(hookName: string, reminderName: string): void {
    if (!isValidPathSegment(hookName) || !isValidPathSegment(reminderName)) return
    const path = getReminderPath(this.stateDir, this.sessionId, hookName, reminderName)
    if (existsSync(path)) {
      unlinkSync(path)
    }
  }

  /**
   * Rename a consumed reminder file to preserve consumption history.
   * Renames {reminderName}.json to {reminderName}.{timestamp}.json
   * This allows Daemon to determine reactivation timing.
   */
  renameReminder(hookName: string, reminderName: string): void {
    if (!isValidPathSegment(hookName) || !isValidPathSegment(reminderName)) return
    const src = getReminderPath(this.stateDir, this.sessionId, hookName, reminderName)
    renameWithTimestampSync(src)
  }
}
