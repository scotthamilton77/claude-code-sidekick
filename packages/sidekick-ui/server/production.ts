#!/usr/bin/env node
/**
 * Production Server for Sidekick Monitoring UI
 *
 * Serves built SPA from dist/ and hosts API endpoints at /api/*.
 * Standalone Node server using native http module (zero dependencies).
 *
 * Usage:
 *   node server/production.js [--port PORT] [--prefer-user]
 *
 * Options:
 *   --port PORT        Server port (default: 3000)
 *   --prefer-user      Prefer ~/.sidekick over .sidekick for logs/state
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §2.2 Data Flow
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'http'
import { readFile, stat } from 'fs/promises'
import { join, extname } from 'path'
import type { IRequest } from 'itty-router'
import { createRouter, toRequest, writeResponse } from './api-plugin'
import { findLogsPath, findSessionsPath, findStatePath } from './utils'
import type { ApiContext } from './types'

// DIST_DIR is relative to the server/ directory (production.js will be in server/)
const DIST_DIR = join(__dirname, '..', 'dist')

/** MIME types for common file extensions */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.eot': 'application/vnd.ms-fontobject',
}

/** Get MIME type from file extension */
function getMimeType(filePath: string): string {
  const ext = extname(filePath).toLowerCase()
  return MIME_TYPES[ext] || 'application/octet-stream'
}

/** Serve static file from dist directory */
async function serveStatic(filePath: string, res: ServerResponse): Promise<boolean> {
  try {
    const fullPath = join(DIST_DIR, filePath)

    // Security: prevent directory traversal
    if (!fullPath.startsWith(DIST_DIR)) {
      return false
    }

    const stats = await stat(fullPath)
    if (!stats.isFile()) {
      return false
    }

    const content = await readFile(fullPath)
    const mimeType = getMimeType(fullPath)

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': content.length,
      'Cache-Control': 'public, max-age=31536000', // 1 year for assets
    })
    res.end(content)
    return true
  } catch {
    return false
  }
}

/** Serve SPA index.html (fallback for client-side routes) */
async function serveIndex(res: ServerResponse): Promise<void> {
  try {
    const indexPath = join(DIST_DIR, 'index.html')
    const content = await readFile(indexPath, 'utf-8')

    res.writeHead(200, {
      'Content-Type': 'text/html',
      'Cache-Control': 'no-cache', // Don't cache index.html
    })
    res.end(content)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    res.writeHead(500, { 'Content-Type': 'text/plain' })
    res.end(`Failed to serve index.html: ${msg}`)
  }
}

/** Parse CLI arguments */
interface CliArgs {
  port: number
  preferProject: boolean
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2)
  let port = 3000
  let preferProject = true

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--port' && i + 1 < args.length) {
      port = parseInt(args[i + 1], 10)
      i++
    } else if (arg === '--prefer-user') {
      preferProject = false
    }
  }

  return { port, preferProject }
}

/** Main server entry point */
function main(): void {
  const { port, preferProject } = parseArgs()

  // Resolve paths on startup
  const ctx: ApiContext = {
    logsPath: findLogsPath(undefined, preferProject, process.cwd()),
    sessionsPath: findSessionsPath(preferProject, process.cwd()),
    statePath: findStatePath(preferProject, process.cwd()),
  }

  console.log(
    [
      'Sidekick Monitoring UI - Production Server',
      `  Dist directory: ${DIST_DIR}`,
      `  Logs path: ${ctx.logsPath ?? '(not found)'}`,
      `  Sessions path: ${ctx.sessionsPath ?? '(not found)'}`,
      `  State path: ${ctx.statePath ?? '(not found)'}`,
    ].join('\n')
  )

  // Create API router
  const router = createRouter()

  // Create HTTP server
  const server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = req.url ?? '/'

    // Handle API routes
    if (url.startsWith('/api/')) {
      const request = toRequest(req, ctx)

      void (async () => {
        try {
          const response = (await router.fetch(request as unknown as IRequest)) as Response | undefined

          if (response) {
            await writeResponse(response, res)
          } else {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Not found' }))
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: `Internal error: ${msg}` }))
        }
      })()
      return
    }

    // Handle static files and SPA fallback
    void (async () => {
      // Try serving exact file first
      const filePath = url === '/' ? 'index.html' : url.slice(1)
      const served = await serveStatic(filePath, res)

      if (!served) {
        // SPA fallback: serve index.html for unknown routes
        await serveIndex(res)
      }
    })()
  })

  // Start server
  server.listen(port, () => {
    console.log(`  Server listening on http://localhost:${port}\n`)
  })

  // Graceful shutdown handler
  const shutdown = (): void => {
    console.log('\nShutting down server...')
    server.close(() => {
      console.log('Server closed')
      process.exit(0)
    })
  }

  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

// Execute main - no async so no catch needed, errors will throw
try {
  main()
} catch (err: unknown) {
  console.error('Fatal error:', err)
  process.exit(1)
}
