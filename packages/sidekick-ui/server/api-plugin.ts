import { access } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, basename } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { listProjects, getProjectById, listSessions } from './sessions-api.js'
import { parseTimelineEvents } from './timeline-api.js'

/** Sidekick project registry root (user-scope) */
const REGISTRY_ROOT = join(homedir(), '.sidekick', 'projects')

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

/**
 * Vite plugin that serves session data from the sidekick filesystem.
 *
 * Routes:
 *   GET /api/projects — list all registered projects
 *   GET /api/projects/:id/sessions — list sessions for a project
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

        // Strip query string for route matching
        const { pathname } = new URL(req.url!, 'http://localhost')

        try {
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
            const projectId = decodeURIComponent(sessionsMatch[1])

            // Validate projectId format (safe path segment)
            if (!isValidPathSegment(projectId)) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Invalid project ID format: ${projectId}` }))
              return
            }

            const project = await getProjectById(REGISTRY_ROOT, projectId)

            if (!project) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Project not found: ${projectId}` }))
              return
            }

            const sessions = await listSessions(project.projectDir, project.active)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ sessions }))
            return
          }

          // GET /api/projects/:projectId/sessions/:sessionId/timeline
          const timelineMatch = pathname.match(
            /^\/api\/projects\/([^/]+)\/sessions\/([^/]+)\/timeline$/
          )
          if (timelineMatch && req.method === 'GET') {
            const projectId = decodeURIComponent(timelineMatch[1])
            const sessionId = decodeURIComponent(timelineMatch[2])

            // Validate projectId format (safe path segment)
            if (!isValidPathSegment(projectId)) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Invalid project ID format: ${projectId}` }))
              return
            }

            // Validate sessionId format (safe path segment)
            if (!isValidPathSegment(sessionId)) {
              res.statusCode = 400
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Invalid session ID format: ${sessionId}` }))
              return
            }

            const project = await getProjectById(REGISTRY_ROOT, projectId)
            if (!project) {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Project not found: ${projectId}` }))
              return
            }

            // Verify session directory exists
            const sessionDir = join(project.projectDir, '.sidekick', 'sessions', sessionId)
            try {
              await access(sessionDir)
            } catch {
              res.statusCode = 404
              res.setHeader('Content-Type', 'application/json')
              res.end(JSON.stringify({ error: `Session not found: ${sessionId}` }))
              return
            }

            const events = await parseTimelineEvents(project.projectDir, sessionId)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ events }))
            return
          }

          // Unknown /api/ route
          next()
        } catch (err) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: String(err) }))
        }
      })
    },
  }
}
