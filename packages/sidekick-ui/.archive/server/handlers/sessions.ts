/**
 * GET /api/logs/sessions - Returns list of unique session IDs.
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest, SessionsResponse } from '../types'
import { jsonResponse, extractSessionIds } from '../utils'

export async function handleSessions(request: ApiRequest): Promise<Response> {
  const { logsPath } = request.ctx

  if (!logsPath) {
    const response: SessionsResponse = { sessions: [], error: 'Logs directory not found' }
    return jsonResponse(response)
  }

  const sessions = new Set<string>()

  // Extract from both log files
  for (const file of ['cli.log', 'sidekickd.log']) {
    const filePath = join(logsPath, file)
    if (existsSync(filePath)) {
      try {
        const content = await readFile(filePath, 'utf-8')
        for (const id of extractSessionIds(content)) {
          sessions.add(id)
        }
      } catch {
        // Skip unreadable files
      }
    }
  }

  const response: SessionsResponse = { sessions: Array.from(sessions) }
  return jsonResponse(response)
}
