/**
 * Staging Service Implementation
 *
 * Implements the StagingService interface for atomic file staging of reminders.
 * This service is used by the Daemon to stage reminders that will be
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

import { existsSync, readdirSync } from 'node:fs'
import { rm, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { StagingService, StagedReminder, Logger, MinimalStateService } from '@sidekick/types'
import { StagedReminderSchema } from '@sidekick/types'
import { LogEvents, logEvent } from './structured-logging'
import { StateNotFoundError } from './state/errors.js'
import {
  getStagingRoot as buildStagingRoot,
  getHookDir as buildHookDir,
  getReminderPath as buildReminderPath,
  validatePathSegment,
  filterActiveReminderFiles,
  extractConsumedTimestamp,
} from './staging-paths.js'

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
  /** StateService for atomic writes with schema validation */
  stateService: MinimalStateService
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
  // Path Helpers (delegate to shared staging-paths module)
  // ============================================================================

  /**
   * Get the staging root for a session.
   */
  getStagingRoot(sessionId: string): string {
    return buildStagingRoot(this.options.stateDir, sessionId)
  }

  /**
   * Get the staging directory for a hook within a session.
   */
  private getHookDirPath(sessionId: string, hookName: string): string {
    return buildHookDir(this.options.stateDir, sessionId, hookName)
  }

  /**
   * Get the path to a specific reminder file.
   */
  private getReminderFilePath(sessionId: string, hookName: string, reminderName: string): string {
    return buildReminderPath(this.options.stateDir, sessionId, hookName, reminderName)
  }

  /**
   * Ensure a directory exists.
   */
  private async ensureDir(dir: string): Promise<void> {
    if (!existsSync(dir)) {
      await mkdir(dir, { recursive: true })
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

    const hookDir = this.getHookDirPath(sessionId, hookName)
    const reminderPath = this.getReminderFilePath(sessionId, hookName, reminderName)

    // Ensure directory exists
    await this.ensureDir(hookDir)

    // Atomic write with schema validation
    await this.options.stateService.write(reminderPath, data, StagedReminderSchema)

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

    const reminderPath = this.getReminderFilePath(sessionId, hookName, reminderName)

    try {
      const result = await this.options.stateService.read(reminderPath, StagedReminderSchema)
      return result.data
    } catch (err) {
      if (err instanceof StateNotFoundError) {
        return null
      }
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

    const hookDir = this.getHookDirPath(sessionId, hookName)

    if (!existsSync(hookDir)) {
      return []
    }

    // Filter to active reminder files (excludes consumed files with timestamp suffix)
    const files = filterActiveReminderFiles(readdirSync(hookDir))
    const reminders: StagedReminder[] = []

    for (const file of files) {
      const reminderPath = join(hookDir, file)
      try {
        const result = await this.options.stateService.read(reminderPath, StagedReminderSchema)
        reminders.push(result.data)
      } catch (err) {
        if (err instanceof StateNotFoundError) {
          // File was deleted between listing and reading, skip
          continue
        }
        // StateCorruptError or other validation/parse errors
        this.options.logger.warn('Skipping invalid reminder file', {
          path: reminderPath,
          error: err instanceof Error ? err.message : String(err),
        })
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
      const hookDir = this.getHookDirPath(sessionId, hookName)
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

    const reminderPath = this.getReminderFilePath(sessionId, hookName, reminderName)
    await this.options.stateService.delete(reminderPath)
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

    const hookDir = this.getHookDirPath(sessionId, hookName)
    if (!existsSync(hookDir)) {
      return []
    }

    // Find consumed files matching {reminderName}.{timestamp}.json pattern
    const files = readdirSync(hookDir)
      .map((f) => ({ file: f, timestamp: extractConsumedTimestamp(f, reminderName) }))
      .filter((entry): entry is { file: string; timestamp: number } => entry.timestamp !== null)
      .sort((a, b) => b.timestamp - a.timestamp) // newest first

    const reminders: StagedReminder[] = []
    for (const { file } of files) {
      const reminderPath = join(hookDir, file)
      try {
        const result = await this.options.stateService.read(reminderPath, StagedReminderSchema)
        reminders.push(result.data)
      } catch (err) {
        if (err instanceof StateNotFoundError) {
          // File was deleted between listing and reading, skip
          continue
        }
        // StateCorruptError or other validation/parse errors
        this.options.logger.warn('Skipping invalid consumed reminder file', {
          path: reminderPath,
          error: err instanceof Error ? err.message : String(err),
        })
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
