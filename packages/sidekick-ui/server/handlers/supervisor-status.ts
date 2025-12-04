/**
 * GET /api/supervisor/status - Returns supervisor status with offline detection.
 *
 * Reads the supervisor heartbeat file from `.sidekick/state/supervisor-status.json`
 * and includes file mtime for offline detection (> 30s = offline).
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.E System Health
 * @see docs/design/SUPERVISOR.md §4.6 Heartbeat Mechanism
 */

import { readFile, stat } from 'fs/promises'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { jsonResponse, errorResponse } from '../utils'
import type { SupervisorStatus, SupervisorStatusWithHealth } from '@sidekick/types'

/** Threshold for offline detection (30 seconds per MONITORING-UI.md §3.2.E) */
const OFFLINE_THRESHOLD_MS = 30 * 1000

/**
 * Handle GET /api/supervisor/status request.
 */
export async function handleSupervisorStatus(request: ApiRequest): Promise<Response> {
  const { statePath } = request.ctx

  if (!statePath) {
    return errorResponse('State directory not found', 404)
  }

  const statusFilePath = join(statePath, 'supervisor-status.json')

  try {
    // Read file content and stat in parallel
    const [content, fileStat] = await Promise.all([readFile(statusFilePath, 'utf-8'), stat(statusFilePath)])

    const status = JSON.parse(content) as SupervisorStatus
    const fileMtime = fileStat.mtimeMs
    const now = Date.now()

    // Determine if supervisor is online based on file mtime
    const isOnline = now - fileMtime < OFFLINE_THRESHOLD_MS

    const response: SupervisorStatusWithHealth = {
      ...status,
      isOnline,
      fileMtime,
    }

    return jsonResponse(response)
  } catch (err) {
    // File not found means supervisor hasn't started yet
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      return jsonResponse({
        isOnline: false,
        error: 'Supervisor status file not found - supervisor may not be running',
      })
    }

    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read supervisor status: ${msg}`, 500)
  }
}
