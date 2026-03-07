/**
 * GET /api/sessions/:sessionId/state/session-summary - Returns session summary.
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { jsonResponse, errorResponse, isValidSessionId } from '../utils'

export async function handleSessionSummary(request: ApiRequest): Promise<Response> {
  const { sessionsPath } = request.ctx
  const { sessionId } = request.params

  // Validate session ID format
  if (!isValidSessionId(sessionId)) {
    return errorResponse('Invalid session ID format', 400)
  }

  if (!sessionsPath) {
    return jsonResponse({ error: 'Sessions directory not found' })
  }

  const summaryPath = join(sessionsPath, sessionId, 'state', 'session-summary.json')
  if (!existsSync(summaryPath)) {
    // No summary yet - return empty
    return jsonResponse({})
  }

  try {
    const content = await readFile(summaryPath, 'utf-8')
    const summary = JSON.parse(content) as unknown
    return jsonResponse(summary)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read session summary: ${msg}`)
  }
}
