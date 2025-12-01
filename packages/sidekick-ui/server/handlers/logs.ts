/**
 * GET /api/logs/:type - Returns cli.log or supervisor.log content.
 *
 * Query params:
 * - ?since=<timestamp> - Return only lines after timestamp
 * - ?sessionId=<id> - Filter to specific session
 */

import { readFile, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { errorResponse, ndjsonResponse, filterLogContent, parseFilterOptions } from '../utils'

const VALID_TYPES = new Set(['cli', 'supervisor'])

export async function handleLogs(request: ApiRequest): Promise<Response> {
  const { logsPath } = request.ctx
  const type = request.params.type

  // Validate log type
  if (!VALID_TYPES.has(type)) {
    return errorResponse(`Invalid log type: ${type}. Must be 'cli' or 'supervisor'`, 400)
  }

  if (!logsPath) {
    return errorResponse('Logs directory not found', 404)
  }

  const filePath = join(logsPath, `${type}.log`)
  if (!existsSync(filePath)) {
    // Empty is OK - no logs yet
    return ndjsonResponse('')
  }

  try {
    const [content, fileStat] = await Promise.all([readFile(filePath, 'utf-8'), stat(filePath)])

    const filterOptions = parseFilterOptions(request.query)
    const filtered = filterLogContent(content, filterOptions)

    return ndjsonResponse(filtered, {
      'X-File-Mtime': fileStat.mtimeMs.toString(),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read ${type}.log: ${msg}`)
  }
}
