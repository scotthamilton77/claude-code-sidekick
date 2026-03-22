import { access } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { basename, join } from 'node:path'
import { StatusError } from 'itty-router'
import { getProjectById } from './sessions-api.js'
import type { ApiProject } from './sessions-api.js'
import type { ApiContext, ApiRequest } from './types.js'

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
 * Decode a URI-encoded path parameter and validate it as a safe path segment.
 * Returns the decoded string on success.
 * Throws StatusError(400) for invalid segments.
 * Lets URIError propagate for malformed percent-encoding (caller handles as 400).
 */
export function validatePathParam(encoded: string, label: string): string {
  const decoded = decodeURIComponent(encoded)
  if (!isValidPathSegment(decoded)) {
    throw new StatusError(400, `Invalid ${label} format`)
  }
  return decoded
}

/**
 * Look up a project by ID, throwing StatusError(404) if not found.
 */
export async function requireProject(registryRoot: string, projectId: string): Promise<ApiProject> {
  const project = await getProjectById(registryRoot, projectId)
  if (!project) {
    throw new StatusError(404, `Project not found: ${projectId}`)
  }
  return project
}

/**
 * Verify a session directory exists, throwing StatusError(404) if missing.
 */
export async function requireSession(projectDir: string, sessionId: string): Promise<void> {
  const sessionDir = join(projectDir, '.sidekick', 'sessions', sessionId)
  try {
    await access(sessionDir)
  } catch {
    throw new StatusError(404, `Session not found: ${sessionId}`)
  }
}

/**
 * Convert a Node IncomingMessage to an ApiRequest (Web Request with ctx).
 */
export function toRequest(req: IncomingMessage, ctx: ApiContext): ApiRequest {
  const host = req.headers.host || 'localhost'
  const url = `http://${host}${req.url || '/'}`
  const request = new Request(url, { method: req.method }) as ApiRequest
  request.ctx = ctx
  return request
}

/**
 * Write a Web Response to a Node ServerResponse.
 */
export async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.statusCode = response.status
  response.headers.forEach((value, key) => {
    res.setHeader(key, value)
  })
  const body = await response.text()
  res.end(body)
}

/**
 * Convert handler return values to JSON responses.
 * - undefined → undefined (passthrough, lets itty-router continue)
 * - Response → passed through unchanged
 * - plain object → serialized to JSON Response
 */
export function toJsonResponse(data: unknown): Response | undefined {
  if (data === undefined || data === null) return undefined
  if (data instanceof Response) return data
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Global error handler for itty-router catch.
 * - StatusError → its status code
 * - URIError → 400 (malformed URL encoding)
 * - unknown → 500
 */
export function handleError(err: unknown): Response {
  if (err instanceof URIError) {
    return new Response(JSON.stringify({ error: 'Malformed URL encoding' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  if (err instanceof StatusError) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: err.status,
      headers: { 'Content-Type': 'application/json' },
    })
  }
  const message = err instanceof Error ? err.message : String(err)
  return new Response(JSON.stringify({ error: message }), {
    status: 500,
    headers: { 'Content-Type': 'application/json' },
  })
}
