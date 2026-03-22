import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Plugin, ViteDevServer } from 'vite'
import { createRouter } from './router.js'
import type { ApiContext } from './types.js'
import { toRequest, writeResponse } from './utils.js'

export function sidekickApiPlugin(): Plugin {
  return {
    name: 'sidekick-api',
    configureServer(server: ViteDevServer) {
      const ctx: ApiContext = { registryRoot: join(homedir(), '.sidekick', 'projects') }
      const router = createRouter(ctx)
      server.middlewares.use((req, res, next) => {
        if (!req.url?.startsWith('/api/')) { next(); return }
        // MUST return the promise (not void) so tests can await it
        return router.fetch(toRequest(req, ctx))
          .then(response => {
            if (response) return writeResponse(response, res)
            next()
          })
          .catch((err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err)
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `Internal error: ${msg}` }))
          })
      })
    },
  }
}

// Temporary re-export for backward compat (removed in Task 6)
export { isValidPathSegment } from './utils.js'
