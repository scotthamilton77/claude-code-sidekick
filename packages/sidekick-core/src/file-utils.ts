/**
 * File Utilities
 *
 * Shared utilities for timestamped file operations:
 * - Dev mode backups (copy with timestamp) - daemon-side, async
 * - Reminder consumption (rename with timestamp) - CLI-side, sync
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { copyFile, access, rename } from 'node:fs/promises'
import { existsSync, renameSync, copyFileSync } from 'node:fs'
import path from 'node:path'
import type { Logger } from '@sidekick/types'

// ============================================================================
// Timestamp Path Generation (shared)
// ============================================================================

/**
 * Generate a timestamped path: file.json -> file.{timestamp}.json
 * Uses milliseconds to match existing reminder consumption pattern.
 */
export function getTimestampedPath(filePath: string, timestamp: number = Date.now()): string {
  const dir = path.dirname(filePath)
  const ext = path.extname(filePath)
  const basename = path.basename(filePath, ext)
  return path.join(dir, `${basename}.${timestamp}${ext}`)
}

// ============================================================================
// Async Operations (Daemon-side)
// ============================================================================

export interface TimestampedFileOptions {
  logger?: Logger
  timestamp?: number
}

/**
 * Copy file to timestamped backup (async).
 * Returns backup path if created, null if source doesn't exist or copy failed.
 */
export async function copyWithTimestamp(
  filePath: string,
  options: TimestampedFileOptions = {}
): Promise<string | null> {
  const { logger, timestamp = Date.now() } = options
  const backupPath = getTimestampedPath(filePath, timestamp)

  try {
    await access(filePath)
  } catch {
    return null // Source doesn't exist
  }

  try {
    await copyFile(filePath, backupPath)
    logger?.debug('Created timestamped copy', { original: filePath, backup: backupPath })
    return backupPath
  } catch (err) {
    logger?.warn('Failed to create timestamped copy', { filePath, error: String(err) })
    return null
  }
}

/**
 * Rename file to timestamped name (async).
 * Returns new path if renamed, null if source doesn't exist or rename failed.
 */
export async function renameWithTimestamp(
  filePath: string,
  options: TimestampedFileOptions = {}
): Promise<string | null> {
  const { logger, timestamp = Date.now() } = options
  const newPath = getTimestampedPath(filePath, timestamp)

  try {
    await access(filePath)
  } catch {
    return null // Source doesn't exist
  }

  try {
    await rename(filePath, newPath)
    logger?.debug('Renamed to timestamped path', { original: filePath, renamed: newPath })
    return newPath
  } catch (err) {
    logger?.warn('Failed to rename to timestamped path', { filePath, error: String(err) })
    return null
  }
}

// ============================================================================
// Sync Operations (CLI-side)
// ============================================================================

/**
 * Rename file to timestamped name (sync).
 * Used by CLIStagingReader for reminder consumption.
 */
export function renameWithTimestampSync(filePath: string, timestamp: number = Date.now()): string | null {
  if (!existsSync(filePath)) return null
  const newPath = getTimestampedPath(filePath, timestamp)
  try {
    renameSync(filePath, newPath)
    return newPath
  } catch {
    return null
  }
}

/**
 * Copy file to timestamped backup (sync).
 */
export function copyWithTimestampSync(filePath: string, timestamp: number = Date.now()): string | null {
  if (!existsSync(filePath)) return null
  const backupPath = getTimestampedPath(filePath, timestamp)
  try {
    copyFileSync(filePath, backupPath)
    return backupPath
  } catch {
    return null
  }
}
