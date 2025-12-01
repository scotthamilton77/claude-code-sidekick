/**
 * GET /api/sessions/:sessionId/compaction-history - Returns compaction history.
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { jsonResponse, errorResponse, isValidSessionId } from '../utils'

export async function handleCompactionHistory(request: ApiRequest): Promise<Response> {
  const { sessionsPath } = request.ctx
  const { sessionId } = request.params

  // Validate session ID format
  if (!isValidSessionId(sessionId)) {
    return errorResponse('Invalid session ID format', 400)
  }

  if (!sessionsPath) {
    return jsonResponse({ history: [], error: 'Sessions directory not found' })
  }

  const historyPath = join(sessionsPath, sessionId, 'state', 'compaction-history.json')
  if (!existsSync(historyPath)) {
    // Empty history is OK
    return jsonResponse({ history: [] })
  }

  try {
    const content = await readFile(historyPath, 'utf-8')
    const history = JSON.parse(content) as unknown[]
    return jsonResponse({ history })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read compaction history: ${msg}`)
  }
}
