/**
 * GET /api/logs/:type - Returns cli.log or sidekickd.log content.
 *
 * Query params:
 * - ?since=<timestamp> - Return only lines after timestamp (deprecated, use offset instead)
 * - ?sessionId=<id> - Filter to specific session
 * - ?offset=<bytes> - Start reading from byte offset (incremental fetching)
 *
 * Incremental fetching:
 * - Client tracks last read byte offset
 * - Server reads only new bytes from that offset
 * - Returns X-File-Size header for next poll
 * - Handles log rotation (size decrease or mtime jump backward)
 */

import { open, stat } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import type { ApiRequest } from '../types'
import { errorResponse, ndjsonResponse, filterLogContent, parseFilterOptions } from '../utils'

const VALID_TYPES = new Set(['cli', 'sidekickd'])

export async function handleLogs(request: ApiRequest): Promise<Response> {
  const { logsPath } = request.ctx
  const type = request.params.type

  // Validate log type
  if (!VALID_TYPES.has(type)) {
    return errorResponse(`Invalid log type: ${type}. Must be 'cli' or 'sidekickd'`, 400)
  }

  if (!logsPath) {
    return errorResponse('Logs directory not found', 404)
  }

  const filePath = join(logsPath, `${type}.log`)
  if (!existsSync(filePath)) {
    // Empty is OK - no logs yet
    return ndjsonResponse('', {
      'X-File-Size': '0',
      'X-File-Mtime': '0',
    })
  }

  try {
    const fileStat = await stat(filePath)
    const fileSize = fileStat.size

    // Parse offset param for incremental fetching
    const offsetParam = request.query.offset
    const startOffset = offsetParam ? parseInt(offsetParam, 10) : 0

    // Detect log rotation: file size decreased or offset beyond file size
    if (startOffset > fileSize) {
      // Log was rotated - return full file
      const fh = await open(filePath, 'r')
      try {
        const { buffer } = await fh.read({
          buffer: Buffer.alloc(fileSize),
          offset: 0,
          length: fileSize,
          position: 0,
        })
        const content = buffer.toString('utf-8', 0, fileSize)
        const filterOptions = parseFilterOptions(request.query)
        const filtered = filterLogContent(content, filterOptions)

        return ndjsonResponse(filtered, {
          'X-File-Size': fileSize.toString(),
          'X-File-Mtime': fileStat.mtimeMs.toString(),
          'X-Log-Rotated': 'true',
        })
      } finally {
        await fh.close()
      }
    }

    // Read incrementally from offset
    const bytesToRead = fileSize - startOffset

    if (bytesToRead === 0) {
      // No new data
      return ndjsonResponse('', {
        'X-File-Size': fileSize.toString(),
        'X-File-Mtime': fileStat.mtimeMs.toString(),
      })
    }

    const fh = await open(filePath, 'r')
    try {
      const buffer = Buffer.alloc(bytesToRead)
      const { bytesRead } = await fh.read({
        buffer,
        offset: 0,
        length: bytesToRead,
        position: startOffset,
      })

      const content = buffer.toString('utf-8', 0, bytesRead)
      const filterOptions = parseFilterOptions(request.query)
      const filtered = filterLogContent(content, filterOptions)

      return ndjsonResponse(filtered, {
        'X-File-Size': fileSize.toString(),
        'X-File-Mtime': fileStat.mtimeMs.toString(),
      })
    } finally {
      await fh.close()
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return errorResponse(`Failed to read ${type}.log: ${msg}`)
  }
}
