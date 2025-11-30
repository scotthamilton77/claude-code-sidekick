/**
 * Vite API Plugin
 *
 * Development middleware for serving Sidekick log files.
 * Enables the UI to read local log files during development.
 *
 * API Endpoints:
 * - GET /api/logs/cli - Returns cli.log content
 * - GET /api/logs/supervisor - Returns supervisor.log content
 * - GET /api/logs/sessions - Returns list of unique session IDs
 * - GET /api/config - Returns paths configuration
 *
 * Query params:
 * - ?since=<timestamp> - Return only lines after timestamp (for polling)
 * - ?sessionId=<id> - Filter to specific session
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §2.2 Data Flow
 */

import type { Plugin, ViteDevServer } from 'vite'
import { existsSync, readFileSync, statSync } from 'fs'
import { join, resolve } from 'path'
import type { IncomingMessage, ServerResponse } from 'http'

// Default log directory paths
const DEFAULT_PATHS = {
  user: join(process.env.HOME ?? '~', '.sidekick', 'logs'),
  project: '.sidekick/logs',
}

interface ApiConfig {
  /** Base path for sidekick logs. Defaults to .sidekick/logs or ~/.sidekick/logs */
  logsPath?: string
  /** Whether to look for project-local logs first */
  preferProject?: boolean
}

/**
 * Parse NDJSON and extract unique session IDs.
 */
function extractSessionIds(content: string): string[] {
  const sessions = new Set<string>()
  const lines = content.split('\n')

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>
      const ctx = parsed.context as Record<string, unknown> | undefined
      const sessionId = ctx?.sessionId ?? ctx?.session_id
      if (typeof sessionId === 'string') {
        sessions.add(sessionId)
      }
    } catch {
      // Skip malformed lines
    }
  }

  return Array.from(sessions)
}

/**
 * Filter NDJSON lines by timestamp and session.
 */
function filterLogContent(content: string, options: { since?: number; sessionId?: string }): string {
  const lines = content.split('\n')
  const filtered: string[] = []

  for (const line of lines) {
    if (!line.trim()) continue
    try {
      const parsed = JSON.parse(line) as Record<string, unknown>

      // Filter by timestamp
      if (options.since !== undefined) {
        const time = parsed.time as number | undefined
        if (time !== undefined && time <= options.since) {
          continue
        }
      }

      // Filter by session
      if (options.sessionId !== undefined) {
        const ctx = parsed.context as Record<string, unknown> | undefined
        const lineSessionId = ctx?.sessionId ?? ctx?.session_id
        if (lineSessionId !== options.sessionId) {
          continue
        }
      }

      filtered.push(line)
    } catch {
      // Skip malformed lines
    }
  }

  return filtered.join('\n')
}

/**
 * Find the logs directory, preferring project-local over user.
 */
function findLogsPath(config: ApiConfig, cwd: string): string | null {
  if (config.logsPath) {
    const resolved = resolve(cwd, config.logsPath)
    return existsSync(resolved) ? resolved : null
  }

  // Check project-local first
  if (config.preferProject !== false) {
    const projectPath = resolve(cwd, DEFAULT_PATHS.project)
    if (existsSync(projectPath)) {
      return projectPath
    }
  }

  // Fall back to user directory
  const userPath = DEFAULT_PATHS.user
  if (existsSync(userPath)) {
    return userPath
  }

  return null
}

/**
 * Send JSON response.
 */
function sendJson(res: ServerResponse, data: unknown, status = 200): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(data))
}

/**
 * Send NDJSON response.
 */
function sendNdjson(res: ServerResponse, content: string, status = 200): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/x-ndjson')
  res.end(content)
}

/**
 * Send error response.
 */
function sendError(res: ServerResponse, message: string, status = 500): void {
  sendJson(res, { error: message }, status)
}

/**
 * Create the Vite API plugin.
 */
export function sidekickApiPlugin(config: ApiConfig = {}): Plugin {
  let logsPath: string | null = null

  return {
    name: 'sidekick-api',
    configureServer(server: ViteDevServer) {
      // Find logs path on server start
      logsPath = findLogsPath(config, server.config.root)

      server.middlewares.use((req: IncomingMessage, res: ServerResponse, next: () => void) => {
        const url = new URL(req.url ?? '/', `http://${req.headers.host}`)

        // Only handle /api routes
        if (!url.pathname.startsWith('/api/')) {
          return next()
        }

        // Parse query params
        const since = url.searchParams.get('since')
        const sessionId = url.searchParams.get('sessionId')
        const filterOptions = {
          since: since ? parseInt(since, 10) : undefined,
          sessionId: sessionId ?? undefined,
        }

        // GET /api/config
        if (url.pathname === '/api/config') {
          return sendJson(res, {
            logsPath,
            available: logsPath !== null,
            defaultPaths: DEFAULT_PATHS,
          })
        }

        // GET /api/logs/sessions
        if (url.pathname === '/api/logs/sessions') {
          if (!logsPath) {
            return sendJson(res, { sessions: [], error: 'Logs directory not found' })
          }

          const sessions = new Set<string>()

          // Extract from both log files
          for (const file of ['cli.log', 'supervisor.log']) {
            const filePath = join(logsPath, file)
            if (existsSync(filePath)) {
              const content = readFileSync(filePath, 'utf-8')
              for (const id of extractSessionIds(content)) {
                sessions.add(id)
              }
            }
          }

          return sendJson(res, { sessions: Array.from(sessions) })
        }

        // GET /api/logs/cli
        if (url.pathname === '/api/logs/cli') {
          if (!logsPath) {
            return sendError(res, 'Logs directory not found', 404)
          }

          const filePath = join(logsPath, 'cli.log')
          if (!existsSync(filePath)) {
            return sendNdjson(res, '', 200) // Empty is OK - no logs yet
          }

          try {
            const content = readFileSync(filePath, 'utf-8')
            const filtered = filterLogContent(content, filterOptions)
            const stat = statSync(filePath)
            res.setHeader('X-File-Mtime', stat.mtimeMs.toString())
            return sendNdjson(res, filtered)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return sendError(res, `Failed to read cli.log: ${msg}`)
          }
        }

        // GET /api/logs/supervisor
        if (url.pathname === '/api/logs/supervisor') {
          if (!logsPath) {
            return sendError(res, 'Logs directory not found', 404)
          }

          const filePath = join(logsPath, 'supervisor.log')
          if (!existsSync(filePath)) {
            return sendNdjson(res, '', 200) // Empty is OK - no logs yet
          }

          try {
            const content = readFileSync(filePath, 'utf-8')
            const filtered = filterLogContent(content, filterOptions)
            const stat = statSync(filePath)
            res.setHeader('X-File-Mtime', stat.mtimeMs.toString())
            return sendNdjson(res, filtered)
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err)
            return sendError(res, `Failed to read supervisor.log: ${msg}`)
          }
        }

        // Unknown API route
        return sendError(res, 'Not found', 404)
      })
    },
  }
}

export default sidekickApiPlugin
