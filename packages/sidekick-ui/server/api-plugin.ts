import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { listProjects, listSessions } from './sessions-api.js'

/** Sidekick project registry root (user-scope) */
const REGISTRY_ROOT = join(homedir(), '.sidekick', 'projects')

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

        try {
          // GET /api/projects
          if (req.url === '/api/projects' && req.method === 'GET') {
            const projects = await listProjects(REGISTRY_ROOT)
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ projects }))
            return
          }

          // GET /api/projects/:id/sessions
          const sessionsMatch = req.url.match(/^\/api\/projects\/([^/]+)\/sessions$/)
          if (sessionsMatch && req.method === 'GET') {
            const projectId = decodeURIComponent(sessionsMatch[1])
            const projects = await listProjects(REGISTRY_ROOT)
            const project = projects.find(p => p.id === projectId)

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
