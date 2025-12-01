/**
 * Vite API Plugin
 *
 * Development middleware for serving Sidekick log files.
 * Enables the UI to read local log files during development.
 *
 * API Endpoints:
 * - GET /api/config - Returns paths configuration
 * - GET /api/logs/sessions - Returns list of unique session IDs
 * - GET /api/logs/:type - Returns cli.log or supervisor.log content
 * - GET /api/sessions/:sessionId/compaction-history - Returns compaction history
 * - GET /api/sessions/:sessionId/metrics - Returns current transcript metrics
 * - GET /api/sessions/:sessionId/pre-compact/:timestamp - Returns pre-compact snapshot
 *
 * Query params (for /api/logs/:type):
 * - ?since=<timestamp> - Return only lines after timestamp (for polling)
 * - ?sessionId=<id> - Filter to specific session
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §2.2 Data Flow
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.1 Compaction Timeline
 */

import type { Plugin, ViteDevServer } from 'vite'
import type { IncomingMessage, ServerResponse } from 'http'
import { Router, type IRequest, type RouterType } from 'itty-router'
import type { ApiContext, ApiRequest } from './types'
import { findLogsPath, findSessionsPath, errorResponse } from './utils'
import {
  handleConfig,
  handleSessions,
  handleLogs,
  handleCompactionHistory,
  handleMetrics,
  handlePreCompact,
} from './handlers'

export interface ApiConfig {
  /** Base path for sidekick logs. Defaults to .sidekick/logs or ~/.sidekick/logs */
  logsPath?: string
  /** Whether to look for project-local logs first */
  preferProject?: boolean
}

/**
 * Create the itty-router with all API routes.
 */
function createRouter(): RouterType<ApiRequest> {
  const router = Router<ApiRequest>({ base: '/api' })

  // Config endpoint
  router.get('/config', handleConfig)

  // Log endpoints
  router.get('/logs/sessions', handleSessions)
  router.get('/logs/:type', handleLogs)

  // Session endpoints
  router.get('/sessions/:sessionId/compaction-history', handleCompactionHistory)
  router.get('/sessions/:sessionId/metrics', handleMetrics)
  router.get('/sessions/:sessionId/pre-compact/:timestamp', handlePreCompact)

  // 404 fallback
  router.all('*', () => errorResponse('Not found', 404))

  return router
}

/**
 * Convert Node IncomingMessage to Request-like object for itty-router.
 */
function toRequest(req: IncomingMessage, ctx: ApiContext): ApiRequest {
  const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

  // Parse query params into simple object
  const query: Record<string, string | undefined> = {}
  url.searchParams.forEach((value, key) => {
    query[key] = value
  })

  return {
    method: req.method ?? 'GET',
    url: url.href,
    params: {},
    query,
    ctx,
  } as ApiRequest
}

/**
 * Write Response to ServerResponse.
 */
async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status

  // Copy headers
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })

  // Write body
  const body = await response.text()
  res.end(body)
}

/**
 * Create the Vite API plugin.
 */
export function sidekickApiPlugin(config: ApiConfig = {}): Plugin {
  const router = createRouter()
  let ctx: ApiContext = { logsPath: null, sessionsPath: null }

  return {
    name: 'sidekick-api',
    configureServer(server: ViteDevServer) {
      // Resolve paths on server start
      const preferProject = config.preferProject !== false
      ctx = {
        logsPath: findLogsPath(config.logsPath, preferProject, server.config.root),
        sessionsPath: findSessionsPath(preferProject, server.config.root),
      }

      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        // Only handle /api routes
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }

        const request = toRequest(req, ctx)

        // Handle async routing without returning the promise
        void (async () => {
          try {
            const response = (await router.fetch(request as unknown as IRequest)) as Response | undefined

            if (response) {
              await writeResponse(response, res)
            } else {
              // Should not happen with our catch-all route
              next()
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `Internal error: ${msg}` }))
          }
        })()
      })
    },
  }
}

export default sidekickApiPlugin
