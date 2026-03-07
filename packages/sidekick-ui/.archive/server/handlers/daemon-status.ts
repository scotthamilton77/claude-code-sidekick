/**
 * GET /api/daemon/status - Returns daemon status with offline detection.
 *
 * Reads the daemon heartbeat file from `.sidekick/state/daemon-status.json`
 * and includes file mtime for offline detection (> 30s = offline).
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.E System Health
 * @see docs/design/DAEMON.md §4.6 Heartbeat Mechanism
 */

import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { jsonResponse, errorResponse } from '../utils'
import type { DaemonStatus, DaemonStatusWithHealth } from '@sidekick/types'

/** Threshold for offline detection (30 seconds per MONITORING-UI.md §3.2.E) */
const OFFLINE_THRESHOLD_MS = 30 * 1000

/**
 * Handle GET /api/daemon/status request.
 */
export async function handleDaemonStatus(request: ApiRequest): Promise<Response> {
  const { statePath } = request.ctx

  if (!statePath) {
    // No state directory = daemon never started, return offline status gracefully
    return jsonResponse({
      isOnline: false,
      error: 'State directory not found - daemon may not be running',
    })
  }

  const statusFilePath = join(statePath, 'daemon-status.json')

  try {
    // Read file content and stat in parallel
    const [content, fileStat] = await Promise.all([readFile(statusFilePath, 'utf-8'), stat(statusFilePath)])

    const status = JSON.parse(content) as DaemonStatus
    const fileMtime = fileStat.mtimeMs
    const now = Date.now()

    // Determine if daemon is online based on file mtime
    const isOnline = now - fileMtime < OFFLINE_THRESHOLD_MS

    const response: DaemonStatusWithHealth = {
      ...status,
      isOnline,
      fileMtime,
    }

    return jsonResponse(response)
  } catch (err) {
    // File not found means daemon hasn't started yet
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return jsonResponse({
        isOnline: false,
        error: 'Daemon status file not found - daemon may not be running',
      })
    }

    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read daemon status: ${msg}`, 500)
  }
}
