/**
 * Staging Service Implementation
 *
 * Implements the StagingService interface for atomic file staging of reminders.
 * This service is used by the Supervisor to stage reminders that will be
 * consumed by the CLI on subsequent hook invocations.
 *
 * Architecture:
 * - StagingServiceCore: Stateless singleton, takes sessionId on each call
 * - SessionScopedStagingService: Lightweight per-session wrapper, injects sessionId
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
 * Options for creating a StagingServiceCore.
 */
export interface StagingServiceCoreOptions {
  /** Base state directory (e.g., .sidekick) */
  stateDir: string
  /** Logger for observability */
  logger: Logger
  /** Optional scope for logging context */
  scope?: 'project' | 'user'
}

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

/**
 * Generate a random suffix for temp files.
 */
function generateTempSuffix(): string {
  return randomBytes(8).toString('hex')
}

// ============================================================================
// StagingServiceCore - Stateless singleton, takes sessionId on each call
// ============================================================================

/**
 * Core staging service implementation.
 *
 * Stateless singleton that takes sessionId as the first parameter on every method.
 * Used by SessionScopedStagingService wrappers to provide per-session instances.
 *
 * Files are written to `.sidekick/sessions/{session_id}/stage/{hook_name}/{reminder_name}.json`.
 */
export class StagingServiceCore {
  constructor(private readonly options: StagingServiceCoreOptions) {}

  // ============================================================================
  // Path Helpers
  // ============================================================================

  /**
   * Get the staging root for a session.
   */
  getStagingRoot(sessionId: string): string {
    return join(this.options.stateDir, 'sessions', sessionId, 'stage')
  }

  /**
   * Get the staging directory for a hook within a session.
   */
  private getHookDir(sessionId: string, hookName: string): string {
    return join(this.getStagingRoot(sessionId), hookName)
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

  // ============================================================================
  // Async Public API
  // ============================================================================

  /**
   * Stage a reminder for a specific hook.
   * Uses atomic writes (temp file + rename) to prevent partial reads.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  async stageReminder(sessionId: string, hookName: string, reminderName: string, data: StagedReminder): Promise<void> {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const hookDir = this.getHookDir(sessionId, hookName)
    const reminderPath = join(hookDir, `${reminderName}.json`)

    // Ensure directory exists
    await this.ensureDir(hookDir)

    // Write atomically: temp file + rename with cleanup on failure
    const tempPath = `${reminderPath}.${generateTempSuffix()}.tmp`
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
        sessionId,
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
  async readReminder(sessionId: string, hookName: string, reminderName: string): Promise<StagedReminder | null> {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const reminderPath = join(this.getHookDir(sessionId, hookName), `${reminderName}.json`)

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
  async listReminders(sessionId: string, hookName: string): Promise<StagedReminder[]> {
    validatePathSegment(hookName, 'hookName')

    const hookDir = this.getHookDir(sessionId, hookName)

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
  async clearStaging(sessionId: string, hookName?: string, _options?: { logger?: Logger }): Promise<void> {
    // Note: logger available via _options?.logger for future use
    if (hookName) {
      validatePathSegment(hookName, 'hookName')
      // Clear specific hook directory
      const hookDir = this.getHookDir(sessionId, hookName)
      if (existsSync(hookDir)) {
        await rm(hookDir, { recursive: true })
      }
    } else {
      // Clear entire staging root
      const stagingRoot = this.getStagingRoot(sessionId)
      if (existsSync(stagingRoot)) {
        await rm(stagingRoot, { recursive: true })
      }
    }
  }

  /**
   * Delete a specific staged reminder.
   * Used after consumption of one-shot reminders.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  async deleteReminder(sessionId: string, hookName: string, reminderName: string): Promise<void> {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const reminderPath = join(this.getHookDir(sessionId, hookName), `${reminderName}.json`)
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
  async listConsumedReminders(sessionId: string, hookName: string, reminderName: string): Promise<StagedReminder[]> {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const hookDir = this.getHookDir(sessionId, hookName)
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
  async getLastConsumed(sessionId: string, hookName: string, reminderName: string): Promise<StagedReminder | null> {
    const consumed = await this.listConsumedReminders(sessionId, hookName, reminderName)
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
  stageReminderSync(sessionId: string, hookName: string, reminderName: string, data: StagedReminder): void {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const hookDir = this.getHookDir(sessionId, hookName)
    const reminderPath = join(hookDir, `${reminderName}.json`)

    // Ensure directory exists
    this.ensureDirSync(hookDir)

    // Write atomically with cleanup on failure
    const tempPath = `${reminderPath}.${generateTempSuffix()}.tmp`
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
        sessionId,
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
  clearStagingSync(sessionId: string, hookName?: string): void {
    if (hookName) {
      validatePathSegment(hookName, 'hookName')
      const hookDir = this.getHookDir(sessionId, hookName)
      if (existsSync(hookDir)) {
        rmSync(hookDir, { recursive: true })
      }
    } else {
      const stagingRoot = this.getStagingRoot(sessionId)
      if (existsSync(stagingRoot)) {
        rmSync(stagingRoot, { recursive: true })
      }
    }
  }

  /**
   * Delete a reminder synchronously.
   *
   * @throws Error if hookName or reminderName contain path traversal characters
   */
  deleteReminderSync(sessionId: string, hookName: string, reminderName: string): void {
    validatePathSegment(hookName, 'hookName')
    validatePathSegment(reminderName, 'reminderName')

    const reminderPath = join(this.getHookDir(sessionId, hookName), `${reminderName}.json`)
    if (existsSync(reminderPath)) {
      unlinkSync(reminderPath)
    }
  }
}

// ============================================================================
// SessionScopedStagingService - Per-session wrapper implementing StagingService
// ============================================================================

/**
 * Session-scoped staging service wrapper.
 *
 * Implements the StagingService interface by delegating to StagingServiceCore
 * with the sessionId injected automatically. Created per-session by the ServiceFactory.
 *
 * This is a lightweight wrapper - the core logic lives in StagingServiceCore.
 */
export class SessionScopedStagingService implements StagingService {
  constructor(
    private readonly core: StagingServiceCore,
    private readonly sessionId: string,
    private readonly scope?: 'project' | 'user'
  ) {}

  // ============================================================================
  // StagingService Interface Implementation (delegates to core)
  // ============================================================================

  async stageReminder(hookName: string, reminderName: string, data: StagedReminder): Promise<void> {
    return this.core.stageReminder(this.sessionId, hookName, reminderName, data)
  }

  async readReminder(hookName: string, reminderName: string): Promise<StagedReminder | null> {
    return this.core.readReminder(this.sessionId, hookName, reminderName)
  }

  async listReminders(hookName: string): Promise<StagedReminder[]> {
    return this.core.listReminders(this.sessionId, hookName)
  }

  async clearStaging(hookName?: string, options?: { logger?: Logger }): Promise<void> {
    return this.core.clearStaging(this.sessionId, hookName, options)
  }

  async deleteReminder(hookName: string, reminderName: string): Promise<void> {
    return this.core.deleteReminder(this.sessionId, hookName, reminderName)
  }

  async listConsumedReminders(hookName: string, reminderName: string): Promise<StagedReminder[]> {
    return this.core.listConsumedReminders(this.sessionId, hookName, reminderName)
  }

  async getLastConsumed(hookName: string, reminderName: string): Promise<StagedReminder | null> {
    return this.core.getLastConsumed(this.sessionId, hookName, reminderName)
  }

  // ============================================================================
  // Synchronous API (extends StagingService for convenience)
  // ============================================================================

  stageReminderSync(hookName: string, reminderName: string, data: StagedReminder): void {
    return this.core.stageReminderSync(this.sessionId, hookName, reminderName, data)
  }

  clearStagingSync(hookName?: string): void {
    return this.core.clearStagingSync(this.sessionId, hookName)
  }

  deleteReminderSync(hookName: string, reminderName: string): void {
    return this.core.deleteReminderSync(this.sessionId, hookName, reminderName)
  }

  // ============================================================================
  // Getters for Testing
  // ============================================================================

  /**
   * Get the staging root path (for testing/debugging).
   */
  getStagingRoot(): string {
    return this.core.getStagingRoot(this.sessionId)
  }

  /**
   * Get the session ID (for testing/debugging).
   */
  getSessionId(): string {
    return this.sessionId
  }

  /**
   * Get the scope (for testing/debugging).
   */
  getScope(): 'project' | 'user' | undefined {
    return this.scope
  }
}
