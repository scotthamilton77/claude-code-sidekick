/**
 * Staging Service Implementation
 *
 * Implements the StagingService interface for atomic file staging of reminders.
 * This service is used by the Supervisor to stage reminders that will be
 * consumed by the CLI on subsequent hook invocations.
 *
 * Key responsibilities:
 * - Atomic writes (temp file + rename) to prevent partial reads
 * - Nested directory creation for staging paths
 * - Suppression marker management (.suppressed files)
 * - ReminderStaged event logging for observability
 *
 * @see docs/design/flow.md §2.2 Staging Pattern
 * @see docs/design/FEATURE-REMINDERS.md §3.3 Data Models
 */

import { existsSync, mkdirSync, readdirSync, renameSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { readFile, writeFile, rename, rm, unlink, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import type { StagingService, StagedReminder, Logger } from '@sidekick/types'
import { LogEvents, logEvent } from './structured-logging'

// ============================================================================
// Types
// ============================================================================

/**
 * Options for creating a StagingServiceImpl.
 */
export interface StagingServiceOptions {
  /** Session ID for path construction */
  sessionId: string
  /** Base state directory (e.g., .sidekick) */
  stateDir: string
  /** Logger for observability */
  logger: Logger
  /** Optional scope for logging context */
  scope?: 'project' | 'user'
}

/**
 * Marker filename for hook suppression.
 */
const SUPPRESSED_MARKER = '.suppressed'

/**
 * Validate a path segment to prevent path traversal attacks.
 * Rejects segments containing path separators or parent directory references.
 *
 * @throws Error if segment contains path traversal characters
 */
function validatePathSegment(segment: string, name: string): void {
  if (!segment) {
    throw new Error(`${name} cannot be empty`)
  }
  if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
    throw new Error(`Invalid ${name}: path traversal characters not allowed`)
  }
  // Reject hidden files/directories (starting with .)
  if (segment.startsWith('.')) {
    throw new Error(`Invalid ${name}: cannot start with '.'`)
  }
}

// ============================================================================
// StagingServiceImpl
// ============================================================================

/**
 * Implementation of StagingService.
 *
 * Provides atomic file staging for the reminder system. Files are written
 * to `.sidekick/sessions/{session_id}/stage/{hook_name}/{reminder_name}.json`.
 */
export class StagingServiceImpl implements StagingService {
  private readonly stagingRoot: string

  constructor(private readonly options: StagingServiceOptions) {
    this.stagingRoot = join(options.stateDir, 'sessions', options.sessionId, 'stage')
  }

  // ============================================================================
  // Public API
  // ============================================================================

  /**
   * Stage a reminder for a specific hook.
   * Uses atomic writes (temp file + rename) to prevent partial reads.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  async stageReminder(hookName: string, reminderName: string, data: StagedReminder): Promise<void> {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const hookDir = this.getHookDir(hookName)
    const reminderPath = join(hookDir, `${reminderName}.json`)

    // Ensure directory exists
    await this.ensureDir(hookDir)

    // Write atomically: temp file + rename with cleanup on failure
    const tempPath = `${reminderPath}.${this.generateTempSuffix()}.tmp`
    const content = JSON.stringify(data, null, 2)

    await writeFile(tempPath, content, 'utf-8')
    try {
      await rename(tempPath, reminderPath)
    } catch (err) {
      // Clean up orphaned temp file
      try {
        await unlink(tempPath)
      } catch {
        // Ignore cleanup failure
      }
      throw err
    }

    // Log ReminderStaged event
    const event = LogEvents.reminderStaged(
      {
        sessionId: this.options.sessionId,
        scope: this.options.scope,
        hook: hookName,
      },
      {
        reminderName: data.name,
        hookName,
        blocking: data.blocking,
        priority: data.priority,
        persistent: data.persistent,
      },
      { stagingPath: reminderPath }
    )
    logEvent(this.options.logger, event)
  }

  /**
   * Read a staged reminder.
   * Returns null if the reminder doesn't exist.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  async readReminder(hookName: string, reminderName: string): Promise<StagedReminder | null> {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const reminderPath = join(this.getHookDir(hookName), `${reminderName}.json`)

    if (!existsSync(reminderPath)) {
      return null
    }

    try {
      const content = await readFile(reminderPath, 'utf-8')
      return JSON.parse(content) as StagedReminder
    } catch (err) {
      this.options.logger.warn('Failed to read staged reminder', {
        hookName,
        reminderName,
        path: reminderPath,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }
  }

  /**
   * List all staged reminders for a hook.
   * Returns reminders sorted by priority (highest first).
   * Excludes consumed reminders (files with timestamp suffix like `name.1234567890.json`).
   *
   * @throws Error if hookName contains path traversal characters
   */
  async listReminders(hookName: string): Promise<StagedReminder[]> {
    validatePathSegment(hookName, 'hookName')

    const hookDir = this.getHookDir(hookName)

    if (!existsSync(hookDir)) {
      return []
    }

    // Filter to .json files, excluding consumed files (name.{timestamp}.json)
    // Consumed files have a numeric timestamp suffix before .json
    const files = readdirSync(hookDir).filter((f) => f.endsWith('.json') && !/\.\d+\.json$/.test(f))
    const reminders: StagedReminder[] = []

    for (const file of files) {
      const reminderPath = join(hookDir, file)
      try {
        const content = await readFile(reminderPath, 'utf-8')
        reminders.push(JSON.parse(content) as StagedReminder)
      } catch {
        // Skip malformed files
        this.options.logger.warn('Skipping malformed reminder file', { path: reminderPath })
      }
    }

    // Sort by priority (highest first)
    return reminders.sort((a, b) => b.priority - a.priority)
  }

  /**
   * Clear all staged reminders for a hook (or all hooks).
   *
   * @throws Error if hookName contains path traversal characters
   */
  async clearStaging(hookName?: string): Promise<void> {
    if (hookName) {
      validatePathSegment(hookName, 'hookName')
      // Clear specific hook directory
      const hookDir = this.getHookDir(hookName)
      if (existsSync(hookDir)) {
        await rm(hookDir, { recursive: true })
      }
    } else {
      // Clear entire staging root
      if (existsSync(this.stagingRoot)) {
        await rm(this.stagingRoot, { recursive: true })
      }
    }
  }

  /**
   * Suppress a hook (marker file prevents reminder injection).
   * Creates `.suppressed` marker in the hook's staging directory.
   *
   * @throws Error if hookName contains path traversal characters
   */
  async suppressHook(hookName: string): Promise<void> {
    validatePathSegment(hookName, 'hookName')

    const hookDir = this.getHookDir(hookName)
    const markerPath = join(hookDir, SUPPRESSED_MARKER)

    // Ensure directory exists
    await this.ensureDir(hookDir)

    // Create marker file (empty file is sufficient)
    await writeFile(markerPath, '', 'utf-8')

    this.options.logger.debug('Created suppression marker', { hookName, markerPath })
  }

  /**
   * Check if a hook is suppressed.
   *
   * @throws Error if hookName contains path traversal characters
   */
  isHookSuppressed(hookName: string): Promise<boolean> {
    validatePathSegment(hookName, 'hookName')

    const markerPath = join(this.getHookDir(hookName), SUPPRESSED_MARKER)
    return Promise.resolve(existsSync(markerPath))
  }

  /**
   * Clear suppression for a hook.
   * Deletes the `.suppressed` marker if it exists.
   *
   * @throws Error if hookName contains path traversal characters
   */
  async clearSuppression(hookName: string): Promise<void> {
    validatePathSegment(hookName, 'hookName')

    const markerPath = join(this.getHookDir(hookName), SUPPRESSED_MARKER)
    if (existsSync(markerPath)) {
      await unlink(markerPath)
      this.options.logger.debug('Cleared suppression marker', { hookName, markerPath })
    }
  }

  /**
   * Delete a specific staged reminder.
   * Used after consumption of one-shot reminders.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  async deleteReminder(hookName: string, reminderName: string): Promise<void> {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const reminderPath = join(this.getHookDir(hookName), `${reminderName}.json`)
    if (existsSync(reminderPath)) {
      await unlink(reminderPath)
    }
  }

  /**
   * List consumed reminder files for a specific reminder ID.
   * Consumed files have pattern: {reminderName}.{timestamp}.json
   * Returns reminders sorted by timestamp (newest first).
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  async listConsumedReminders(hookName: string, reminderName: string): Promise<StagedReminder[]> {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const hookDir = this.getHookDir(hookName)
    if (!existsSync(hookDir)) {
      return []
    }

    // Pattern: {reminderName}.{timestamp}.json where timestamp is unix ms
    const pattern = new RegExp(`^${reminderName}\\.(\\d+)\\.json$`)
    const files = readdirSync(hookDir)
      .filter((f) => pattern.test(f))
      .map((f) => ({
        file: f,
        timestamp: parseInt(pattern.exec(f)![1], 10),
      }))
      .sort((a, b) => b.timestamp - a.timestamp) // newest first

    const reminders: StagedReminder[] = []
    for (const { file } of files) {
      const reminderPath = join(hookDir, file)
      try {
        const content = await readFile(reminderPath, 'utf-8')
        reminders.push(JSON.parse(content) as StagedReminder)
      } catch {
        // Skip malformed files
        this.options.logger.warn('Skipping malformed consumed reminder file', { path: reminderPath })
      }
    }

    return reminders
  }

  /**
   * Get the most recently consumed reminder for a specific reminder ID.
   * Used by staging handlers to determine if reactivation is needed.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  async getLastConsumed(hookName: string, reminderName: string): Promise<StagedReminder | null> {
    const consumed = await this.listConsumedReminders(hookName, reminderName)
    return consumed.length > 0 ? consumed[0] : null
  }

  // ============================================================================
  // Synchronous API (for CLI usage where async is inconvenient)
  // ============================================================================

  /**
   * Stage a reminder synchronously.
   * Prefer the async version when possible.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  stageReminderSync(hookName: string, reminderName: string, data: StagedReminder): void {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const hookDir = this.getHookDir(hookName)
    const reminderPath = join(hookDir, `${reminderName}.json`)

    // Ensure directory exists
    this.ensureDirSync(hookDir)

    // Write atomically with cleanup on failure
    const tempPath = `${reminderPath}.${this.generateTempSuffix()}.tmp`
    const content = JSON.stringify(data, null, 2)

    writeFileSync(tempPath, content, 'utf-8')
    try {
      renameSync(tempPath, reminderPath)
    } catch (err) {
      // Clean up orphaned temp file
      try {
        unlinkSync(tempPath)
      } catch {
        // Ignore cleanup failure
      }
      throw err
    }

    // Log ReminderStaged event
    const event = LogEvents.reminderStaged(
      {
        sessionId: this.options.sessionId,
        scope: this.options.scope,
        hook: hookName,
      },
      {
        reminderName: data.name,
        hookName,
        blocking: data.blocking,
        priority: data.priority,
        persistent: data.persistent,
      },
      { stagingPath: reminderPath }
    )
    logEvent(this.options.logger, event)
  }

  /**
   * Clear staging synchronously.
   *
   * @throws Error if hookName contains path traversal characters
   */
  clearStagingSync(hookName?: string): void {
    if (hookName) {
      validatePathSegment(hookName, 'hookName')
      const hookDir = this.getHookDir(hookName)
      if (existsSync(hookDir)) {
        rmSync(hookDir, { recursive: true })
      }
    } else {
      if (existsSync(this.stagingRoot)) {
        rmSync(this.stagingRoot, { recursive: true })
      }
    }
  }

  /**
   * Suppress a hook synchronously.
   *
   * @throws Error if hookName contains path traversal characters
   */
  suppressHookSync(hookName: string): void {
    validatePathSegment(hookName, 'hookName')

    const hookDir = this.getHookDir(hookName)
    const markerPath = join(hookDir, SUPPRESSED_MARKER)

    this.ensureDirSync(hookDir)
    writeFileSync(markerPath, '', 'utf-8')
  }

  /**
   * Check if a hook is suppressed (synchronous).
   *
   * @throws Error if hookName contains path traversal characters
   */
  isHookSuppressedSync(hookName: string): boolean {
    validatePathSegment(hookName, 'hookName')

    const markerPath = join(this.getHookDir(hookName), SUPPRESSED_MARKER)
    return existsSync(markerPath)
  }

  /**
   * Clear suppression synchronously.
   *
   * @throws Error if hookName contains path traversal characters
   */
  clearSuppressionSync(hookName: string): void {
    validatePathSegment(hookName, 'hookName')

    const markerPath = join(this.getHookDir(hookName), SUPPRESSED_MARKER)
    if (existsSync(markerPath)) {
      unlinkSync(markerPath)
    }
  }

  /**
   * Delete a reminder synchronously.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  deleteReminderSync(hookName: string, reminderName: string): void {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const reminderPath = join(this.getHookDir(hookName), `${reminderName}.json`)
    if (existsSync(reminderPath)) {
      unlinkSync(reminderPath)
    }
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Get the staging directory for a hook.
   */
  private getHookDir(hookName: string): string {
    return join(this.stagingRoot, hookName)
  }

  /**
   * Ensure a directory exists (async).
   */
  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
    }
  }

  /**
   * Ensure a directory exists (sync).
   */
  private ensureDirSync(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true })
    }
  }

  /**
   * Generate a random suffix for temp files.
   */
  private generateTempSuffix(): string {
    return randomBytes(8).toString('hex')
  }

  // ============================================================================
  // Getters for Testing
  // ============================================================================

  /**
   * Get the staging root path (for testing/debugging).
   */
  getStagingRoot(): string {
    return this.stagingRoot
  }
}
