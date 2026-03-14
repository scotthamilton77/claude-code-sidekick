import { access } from 'node:fs/promises'
import type { ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { listProjects, getProjectById, listSessions } from './sessions-api.js'
import { parseTimelineEvents } from './timeline-api.js'
import { parseTranscriptLines } from './transcript-api.js'

/**
 * Validate that a string is a safe single path segment (no traversal).
 *
 * Rejects empty strings, `.`, `..`, strings containing path separators,
 * and strings where basename differs from the input. Only allows
 * alphanumeric characters, dots, hyphens, and underscores.
 */
export function isValidPathSegment(s: string): boolean {
  if (s === '') return false
  if (s === '.' || s === '..') return false
  if (s.includes('/') || s.includes('\\')) return false
  if (basename(s) !== s) return false
  return /^[a-zA-Z0-9._-]+$/.test(s)
}

/** Sidekick project registry root (user-scope) */
const REGISTRY_ROOT = join(homedir(), '.sidekick', 'projects')

/** Write a JSON error response. */
function sendError(res: ServerResponse, status: number, message: string): void {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify({ error: message }))
}

/**
 * Decode a URI component and validate it as a safe path segment.
 * Returns the decoded string, or null if invalid.
 * Throws URIError for malformed percent-encoding (caller should catch as 400).
 */
function validateAndDecode(encoded: string): string | null {
  const decoded = decodeURIComponent(encoded)
  return isValidPathSegment(decoded) ? decoded : null
}

/**
 * Vite plugin that serves session data from the sidekick filesystem.
 *
 * Routes:
 *   GET /api/projects — list all registered projects
 *   GET /api/projects/:id/sessions — list sessions for a project
 *   GET /api/projects/:projectId/sessions/:sessionId/timeline — timeline events
 *   GET /api/projects/:projectId/sessions/:sessionId/transcript — transcript lines
 */
export function sessionsApiPlugin(): Plugin {
  return {
    name: 'sidekick-sessions-api',

    configureServer(server: ViteDevServer) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith('/api/')) {
          next()
          return
        }

        try {
          // Strip query string for route matching
          const { pathname } = new URL(req.url!, 'http://localhost')

          // GET /api/projects
          if (pathname === '/api/projects' && req.method === 'GET') {
            const projects = await listProjects(REGISTRY_ROOT)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ projects }))
            return
          }

          // GET /api/projects/:id/sessions
          const sessionsMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sessions$/)
          if (sessionsMatch && req.method === 'GET') {
            const projectId = validateAndDecode(sessionsMatch[1])
            if (!projectId) {
              sendError(res, 400, `Invalid project ID format`)
              return
            }

            const project = await getProjectById(REGISTRY_ROOT, projectId)
            if (!project) {
              sendError(res, 404, `Project not found: ${projectId}`)
              return
            }

            const sessions = await listSessions(project.projectDir, project.active)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ sessions }))
            return
          }

          // GET /api/projects/:projectId/sessions/:sessionId/timeline
          const timelineMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/timeline$/)
          if (timelineMatch && req.method === 'GET') {
            const projectId = validateAndDecode(timelineMatch[1])
            if (!projectId) {
              sendError(res, 400, `Invalid project ID format`)
              return
            }

            const sessionId = validateAndDecode(timelineMatch[2])
            if (!sessionId) {
              sendError(res, 400, `Invalid session ID format`)
              return
            }

            const project = await getProjectById(REGISTRY_ROOT, projectId)
            if (!project) {
              sendError(res, 404, `Project not found: ${projectId}`)
              return
            }

            // Verify session directory exists
            const sessionDir = join(project.projectDir, '.sidekick', 'sessions', sessionId)
            try {
              await access(sessionDir)
            } catch {
              sendError(res, 404, `Session not found: ${sessionId}`)
              return
            }

            const events = await parseTimelineEvents(project.projectDir, sessionId)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ events }))
            return
          }

          // GET /api/projects/:projectId/sessions/:sessionId/transcript
          const transcriptMatch = pathname.match(/^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/transcript$/)
          if (transcriptMatch && req.method === 'GET') {
            const projectId = validateAndDecode(transcriptMatch[1])
            if (!projectId) {
              sendError(res, 400, `Invalid project ID format`)
              return
            }

            const sessionId = validateAndDecode(transcriptMatch[2])
            if (!sessionId) {
              sendError(res, 400, `Invalid session ID format`)
              return
            }

            const lines = await parseTranscriptLines(projectId, sessionId)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ lines }))
            return
          }

          // Unknown /api/ route
          next()
        } catch (err) {
          if (err instanceof URIError) {
            sendError(res, 400, `Malformed URL encoding`)
            return
          }
          sendError(res, 500, String(err))
        }
      })
    },
  }
}
