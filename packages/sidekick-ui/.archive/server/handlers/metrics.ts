/**
 * GET /api/sessions/:sessionId/metrics - Returns current transcript metrics.
 */

import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { jsonResponse, errorResponse, isValidSessionId } from '../utils'

export async function handleMetrics(request: ApiRequest): Promise<Response> {
  const { sessionsPath } = request.ctx
  const { sessionId } = request.params

  // Validate session ID format
  if (!isValidSessionId(sessionId)) {
    return errorResponse('Invalid session ID format', 400)
  }

  if (!sessionsPath) {
    return jsonResponse({ metrics: null, error: 'Sessions directory not found' })
  }

  const metricsPath = join(sessionsPath, sessionId, 'state', 'transcript-metrics.json')
  if (!existsSync(metricsPath)) {
    // No metrics yet
    return jsonResponse({ metrics: null })
  }

  try {
    const [content, fileStat] = await Promise.all([readFile(metricsPath, 'utf-8'), stat(metricsPath)])

    const metrics = JSON.parse(content) as unknown
    return new Response(JSON.stringify({ metrics }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'X-File-Mtime': fileStat.mtimeMs.toString(),
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read metrics: ${msg}`)
  }
}
