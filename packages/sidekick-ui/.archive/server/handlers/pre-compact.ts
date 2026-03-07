/**
 * GET /api/sessions/:sessionId/pre-compact/:timestamp - Returns pre-compact snapshot.
 */

import { readFile } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { errorResponse, ndjsonResponse, isValidSessionId, isValidTimestamp } from '../utils'

export async function handlePreCompact(request: ApiRequest): Promise<Response> {
  const { sessionsPath } = request.ctx
  const { sessionId, timestamp } = request.params

  // Validate session ID format
  if (!isValidSessionId(sessionId)) {
    return errorResponse('Invalid session ID format', 400)
  }

  // Validate timestamp format
  if (!isValidTimestamp(timestamp)) {
    return errorResponse('Invalid timestamp format', 400)
  }

  if (!sessionsPath) {
    return errorResponse('Sessions directory not found', 404)
  }

  const snapshotPath = join(sessionsPath, sessionId, 'transcripts', `pre-compact-${timestamp}.jsonl`)
  if (!existsSync(snapshotPath)) {
    return errorResponse('Pre-compact snapshot not found', 404)
  }

  try {
    const content = await readFile(snapshotPath, 'utf-8')
    return ndjsonResponse(content)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read pre-compact snapshot: ${msg}`)
  }
}
