/**
 * GET /api/config - Returns paths configuration.
 */

import type { ApiRequest, ConfigResponse } from '../types'
import { DEFAULT_PATHS } from '../types'
import { jsonResponse } from '../utils'

export function handleConfig(request: ApiRequest): Response {
  const { logsPath } = request.ctx

  const response: ConfigResponse = {
    logsPath,
    available: logsPath !== null,
    defaultPaths: DEFAULT_PATHS,
  }

  return jsonResponse(response)
}
