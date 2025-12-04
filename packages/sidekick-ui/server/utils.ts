/**
 * Shared utilities for API handlers.
 *
 * Pure functions for parsing and filtering log content.
 */

import { existsSync } from 'fs'
import { resolve } from 'path'
import type { FilterOptions, ApiContext } from './types'
import { DEFAULT_PATHS, SESSIONS_PATHS, STATE_PATHS } from './types'

/**
 * Parse NDJSON and extract unique session IDs.
 */
export function extractSessionIds(content: string): string[] {
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
export function filterLogContent(content: string, options: FilterOptions): string {
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
export function findLogsPath(logsPath: string | undefined, preferProject: boolean, cwd: string): string | null {
  if (logsPath) {
    const resolved = resolve(cwd, logsPath)
    return existsSync(resolved) ? resolved : null
  }

  // Check project-local first
  if (preferProject) {
    const projectPath = resolve(cwd, DEFAULT_PATHS.project)
    if (existsSync(projectPath)) {
      return projectPath
    }
  }

  // Fall back to user directory
  if (existsSync(DEFAULT_PATHS.user)) {
    return DEFAULT_PATHS.user
  }

  return null
}

/**
 * Find the sessions directory, preferring project-local over user.
 */
export function findSessionsPath(preferProject: boolean, cwd: string): string | null {
  // Check project-local first
  if (preferProject) {
    const projectPath = resolve(cwd, SESSIONS_PATHS.project)
    if (existsSync(projectPath)) {
      return projectPath
    }
  }

  // Fall back to user directory
  if (existsSync(SESSIONS_PATHS.user)) {
    return SESSIONS_PATHS.user
  }

  return null
}

/**
 * Find the state directory, preferring project-local over user.
 */
export function findStatePath(preferProject: boolean, cwd: string): string | null {
  // Check project-local first
  if (preferProject) {
    const projectPath = resolve(cwd, STATE_PATHS.project)
    if (existsSync(projectPath)) {
      return projectPath
    }
  }

  // Fall back to user directory
  if (existsSync(STATE_PATHS.user)) {
    return STATE_PATHS.user
  }

  return null
}

/**
 * Create JSON Response with proper headers.
 */
export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

/**
 * Create NDJSON Response with proper headers.
 */
export function ndjsonResponse(content: string, headers?: Record<string, string>, status = 200): Response {
  return new Response(content, {
    status,
    headers: { 'Content-Type': 'application/x-ndjson', ...headers },
  })
}

/**
 * Create error Response.
 */
export function errorResponse(message: string, status = 500): Response {
  return jsonResponse({ error: message }, status)
}

/**
 * Parse filter options from query params.
 */
export function parseFilterOptions(query: Record<string, string | undefined>): FilterOptions {
  return {
    since: query.since ? parseInt(query.since, 10) : undefined,
    sessionId: query.sessionId ?? undefined,
  }
}

/**
 * Validate session ID format (basic alphanumeric + common separators).
 * Prevents path traversal and regex injection.
 */
export function isValidSessionId(sessionId: string): boolean {
  return /^[\w-]+$/.test(sessionId) && sessionId.length <= 64
}

/**
 * Create context from resolved paths.
 */
export function createContext(
  logsPath: string | null,
  sessionsPath: string | null,
  statePath: string | null
): ApiContext {
  return { logsPath, sessionsPath, statePath }
}
