/**
 * Staging Path Helpers
 *
 * Shared utilities for staging file path construction, validation, and filtering.
 * Used by both StagingServiceCore (daemon-side) and CLIStagingReader (CLI-side).
 *
 * ## Architectural Decision
 *
 * Currently, staging file access is split between two implementations:
 * - StagingServiceCore: Async, uses StateService, has logging (daemon context)
 * - CLIStagingReader: Sync, direct fs calls, no logging (CLI hook context)
 *
 * This duplication exists because:
 * 1. CLI hooks run briefly in a separate process without DaemonContext
 * 2. StateService is async-only; CLI historically used sync I/O for simplicity
 * 3. Logger isn't available in CLI hook context
 *
 * **Future Direction**: Consolidate into a single StagingService accessor:
 * - Make logger optional in StagingServiceCore
 * - Have CLI instantiate StateService + StagingServiceCore directly
 * - Delete CLIStagingReader entirely
 * - Add renameReminder() to StagingService interface
 *
 * This refactoring was deferred as a time vs. acceptable-enough tradeoff.
 * The shared helpers here centralize the business logic while allowing
 * different I/O strategies (async StateService vs sync fs).
 *
 * @see packages/sidekick-core/src/staging-service.ts
 * @see packages/feature-reminders/src/cli-staging-reader.ts
 */

import { join } from 'node:path'

// ============================================================================
// Path Construction
// ============================================================================

/**
 * Get the staging root directory for a session.
 * Layout: `{stateDir}/sessions/{sessionId}/stage`
 */
export function getStagingRoot(stateDir: string, sessionId: string): string {
  return join(stateDir, 'sessions', sessionId, 'stage')
}

/**
 * Get the staging directory for a specific hook.
 * Layout: `{stateDir}/sessions/{sessionId}/stage/{hookName}`
 */
export function getHookDir(stateDir: string, sessionId: string, hookName: string): string {
  return join(getStagingRoot(stateDir, sessionId), hookName)
}

/**
 * Get the path to a specific reminder file.
 * Layout: `{stateDir}/sessions/{sessionId}/stage/{hookName}/{reminderName}.json`
 */
export function getReminderPath(stateDir: string, sessionId: string, hookName: string, reminderName: string): string {
  return join(getHookDir(stateDir, sessionId, hookName), `${reminderName}.json`)
}

// ============================================================================
// Path Validation
// ============================================================================

/**
 * Validate a path segment to prevent path traversal attacks.
 * Rejects segments containing path separators, parent directory references,
 * or hidden file prefixes.
 *
 * @param segment - The path segment to validate
 * @returns true if valid, false otherwise
 */
export function isValidPathSegment(segment: string): boolean {
  if (!segment) return false
  if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) return false
  if (segment.startsWith('.')) return false
  return true
}

/**
 * Validate a path segment, throwing on invalid input.
 * Use this in daemon context where we want explicit errors.
 *
 * @param segment - The path segment to validate
 * @param name - Human-readable name for error messages (e.g., 'hookName')
 * @throws Error if segment is invalid
 */
export function validatePathSegment(segment: string, name: string): void {
  if (!segment) {
    throw new Error(`${name} cannot be empty`)
  }
  if (segment.includes('..') || segment.includes('/') || segment.includes('\\')) {
    throw new Error(`Invalid ${name}: path traversal characters not allowed`)
  }
  if (segment.startsWith('.')) {
    throw new Error(`Invalid ${name}: cannot start with '.'`)
  }
}

// ============================================================================
// File Filtering
// ============================================================================

/**
 * Pattern to identify consumed reminder files.
 * Consumed files have format: `{reminderName}.{timestamp}.json`
 * where timestamp is Unix milliseconds.
 */
export const CONSUMED_FILE_PATTERN = /\.\d+\.json$/

/**
 * Filter a list of filenames to active (non-consumed) reminder files.
 * Excludes consumed files which have a numeric timestamp suffix.
 *
 * @param files - Array of filenames from readdirSync/readdir
 * @returns Filtered array of active reminder filenames
 */
export function filterActiveReminderFiles(files: string[]): string[] {
  return files.filter((f) => f.endsWith('.json') && !CONSUMED_FILE_PATTERN.test(f))
}

/**
 * Create a regex pattern to match consumed files for a specific reminder.
 * Pattern: `^{reminderName}\.(\d+)\.json$`
 *
 * @param reminderName - The reminder name to match
 * @returns RegExp that captures the timestamp in group 1
 */
export function createConsumedFilePattern(reminderName: string): RegExp {
  return new RegExp(`^${reminderName}\\.(\\d+)\\.json$`)
}

/**
 * Extract timestamp from a consumed reminder filename.
 *
 * @param filename - The filename to parse
 * @param reminderName - The reminder name to match
 * @returns The timestamp in milliseconds, or null if not a consumed file
 */
export function extractConsumedTimestamp(filename: string, reminderName: string): number | null {
  const pattern = createConsumedFilePattern(reminderName)
  const match = pattern.exec(filename)
  return match ? parseInt(match[1], 10) : null
}
