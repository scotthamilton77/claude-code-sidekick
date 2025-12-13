/**
 * GET /api/sessions/:sessionId/state/session-state - Returns session state.
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { jsonResponse, errorResponse, isValidSessionId } from '../utils'

export async function handleSessionState(request: ApiRequest): Promise<Response> {
  const { sessionsPath } = request.ctx
  const { sessionId } = request.params

  // Validate session ID format
  if (!isValidSessionId(sessionId)) {
    return errorResponse('Invalid session ID format', 400)
  }

  if (!sessionsPath) {
    return jsonResponse({ error: 'Sessions directory not found' })
  }

  const statePath = join(sessionsPath, sessionId, 'state', 'session-state.json')
  if (!existsSync(statePath)) {
    // No session state yet - return empty
    return jsonResponse({})
  }

  try {
    const content = await readFile(statePath, 'utf-8')
    const state = JSON.parse(content) as unknown
    return jsonResponse(state)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read session state: ${msg}`)
  }
}
