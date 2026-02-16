/**
 * Daemon Health Utilities
 *
 * Standalone functions for reading, writing, and updating daemon health state.
 * Uses atomic writes (tmp + rename) and log-once transition semantics to
 * eliminate repeated warnings during daemon startup failures.
 *
 * These are intentionally simple file-based functions (not StateService methods)
 * because the CLI hook process needs to read/write health state without
 * instantiating a full StateService.
 *
 * @see docs/plans/2026-02-16-daemon-health-state-design.md
 */

import * as fs from 'node:fs/promises'
import { join, dirname } from 'node:path'
import { DaemonHealthSchema } from '@sidekick/types'
import type { DaemonHealth, DaemonHealthStatus, Logger } from '@sidekick/types'

/** Path to the daemon health state file within a project directory. */
function healthFilePath(projectDir: string): string {
  return join(projectDir, '.sidekick', 'state', 'daemon-health.json')
}

/** Create a default health object with status 'unknown'. */
function defaultHealth(): DaemonHealth {
  return {
    status: 'unknown',
    lastCheckedAt: new Date(0).toISOString(),
  }
}

/**
 * Read the daemon health state from disk.
 * Returns a default `{ status: 'unknown' }` on missing or corrupt file.
 *
 * @param projectDir - Project root directory containing `.sidekick/`
 */
export async function readDaemonHealth(projectDir: string): Promise<DaemonHealth> {
  const path = healthFilePath(projectDir)

  try {
    const content = await fs.readFile(path, 'utf-8')
    const json: unknown = JSON.parse(content)
    const parsed = DaemonHealthSchema.safeParse(json)

    if (!parsed.success) {
      return defaultHealth()
    }

    return parsed.data
  } catch {
    // ENOENT, permission error, JSON parse error — all return default
    return defaultHealth()
  }
}

/**
 * Atomically write daemon health state to disk.
 * Uses tmp file + rename to prevent corruption from partial writes.
 *
 * @param projectDir - Project root directory containing `.sidekick/`
 * @param health - Health state to persist
 */
export async function writeDaemonHealth(projectDir: string, health: DaemonHealth): Promise<void> {
  const path = healthFilePath(projectDir)
  const dir = dirname(path)

  await fs.mkdir(dir, { recursive: true })

  const tmpPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
  const json = JSON.stringify(health, null, 2)

  try {
    await fs.writeFile(tmpPath, json, 'utf-8')
    await fs.rename(tmpPath, path)
  } catch (err) {
    // Best-effort cleanup of temp file
    try {
      await fs.unlink(tmpPath)
    } catch {
      // Ignore cleanup errors
    }
    throw err
  }
}

/**
 * Update daemon health with log-once transition semantics.
 *
 * Reads current state, compares with `newStatus`. Only writes and logs
 * when the status actually changes. This prevents log spam from repeated
 * health checks that report the same status.
 *
 * Transition logging:
 * - To 'healthy': logger.info('Daemon health changed', { from, to })
 * - To 'failed':  logger.error('Daemon health changed: daemon failed to start', { from, to, error })
 *
 * @param projectDir - Project root directory containing `.sidekick/`
 * @param newStatus - The new health status to transition to
 * @param logger - Logger for transition messages
 * @param error - Optional error message (used when transitioning to 'failed')
 * @returns true if status changed (write occurred), false if unchanged or write failed
 */
export async function updateDaemonHealth(
  projectDir: string,
  newStatus: DaemonHealthStatus,
  logger: Logger,
  error?: string
): Promise<boolean> {
  const current = await readDaemonHealth(projectDir)

  // No transition — skip write and log
  if (current.status === newStatus) {
    return false
  }

  const from = current.status
  const to = newStatus

  // Build new health object
  const health: DaemonHealth = {
    status: newStatus,
    lastCheckedAt: new Date().toISOString(),
  }
  if (error !== undefined) {
    health.error = error
  }

  // Attempt atomic write — failures are non-fatal
  try {
    await writeDaemonHealth(projectDir, health)
  } catch (err) {
    logger.warn('Failed to write daemon health', {
      from,
      to,
      error: err instanceof Error ? err.message : String(err),
    })
    return false
  }

  // Log the transition
  if (newStatus === 'failed') {
    logger.error('Daemon health changed: daemon failed to start', { from, to, error })
  } else {
    logger.info('Daemon health changed', { from, to })
  }

  return true
}
