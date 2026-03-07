/**
 * Shared utilities for API handlers.
 *
 * Pure functions for parsing and filtering log content.
 */

import { existsSync } from 'fs'
import { homedir } from 'os'
import { resolve } from 'path'
import type { FilterOptions, ApiContext } from './types'
import { DEFAULT_PATHS, SESSIONS_PATHS, STATE_PATHS } from './types'

/**
 * Get user-scope directory path with optional override for testing.
 */
function getUserPath(subdir: string, homeDir?: string): string {
  const home = homeDir ?? process.env.HOME ?? homedir()
  return resolve(home, '.sidekick', subdir)
}

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
 *
 * @param logsPath - Explicit logs path override
 * @param preferProject - Whether to prefer project-local over user
 * @param cwd - Current working directory (project root)
 * @param homeDir - Home directory override (for testing)
 */
export function findLogsPath(
  logsPath: string | undefined,
  preferProject: boolean,
  cwd: string,
  homeDir?: string
): string | null {
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
  const userPath = getUserPath('logs', homeDir)
  if (existsSync(userPath)) {
    return userPath
  }

  return null
}

/**
 * Find the sessions directory, preferring project-local over user.
 *
 * @param preferProject - Whether to prefer project-local over user
 * @param cwd - Current working directory (project root)
 * @param homeDir - Home directory override (for testing)
 */
export function findSessionsPath(preferProject: boolean, cwd: string, homeDir?: string): string | null {
  // Check project-local first
  if (preferProject) {
    const projectPath = resolve(cwd, SESSIONS_PATHS.project)
    if (existsSync(projectPath)) {
      return projectPath
    }
  }

  // Fall back to user directory
  const userPath = getUserPath('sessions', homeDir)
  if (existsSync(userPath)) {
    return userPath
  }

  return null
}

/**
 * Find the state directory, preferring project-local over user.
 *
 * @param preferProject - Whether to prefer project-local over user
 * @param cwd - Current working directory (project root)
 * @param homeDir - Home directory override (for testing)
 */
export function findStatePath(preferProject: boolean, cwd: string, homeDir?: string): string | null {
  // Check project-local first
  if (preferProject) {
    const projectPath = resolve(cwd, STATE_PATHS.project)
    if (existsSync(projectPath)) {
      return projectPath
    }
  }

  // Fall back to user directory
  const userPath = getUserPath('state', homeDir)
  if (existsSync(userPath)) {
    return userPath
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
 *
 * Security constraints:
 * - Only word characters (\w = [a-zA-Z0-9_]) and hyphens
 * - Max 64 characters (reasonable session ID length)
 * - No null bytes, path separators, or special characters
 */
export function isValidSessionId(sessionId: string | undefined): boolean {
  if (!sessionId || typeof sessionId !== 'string') {
    return false
  }

  // Reject empty, too short, or too long
  if (sessionId.length === 0 || sessionId.length > 64) {
    return false
  }

  // Reject path traversal patterns
  if (sessionId.includes('..') || sessionId.includes('/') || sessionId.includes('\\')) {
    return false
  }

  // Reject null bytes (path truncation attack)
  if (sessionId.includes('\0') || sessionId.includes('%00')) {
    return false
  }

  // Only allow safe characters: alphanumeric, underscore, hyphen
  return /^[\w-]+$/.test(sessionId)
}

/**
 * Validate hook name format.
 * Prevents path traversal in stage directory access.
 *
 * Security constraints:
 * - Only PascalCase hook names (SessionStart, UserPromptSubmit, etc.)
 * - Max 64 characters
 * - No path separators or special characters
 */
export function isValidHookName(hookName: string | undefined): boolean {
  if (!hookName || typeof hookName !== 'string') {
    return false
  }

  // Reject empty, too short, or too long
  if (hookName.length === 0 || hookName.length > 64) {
    return false
  }

  // Reject path traversal patterns
  if (hookName.includes('..') || hookName.includes('/') || hookName.includes('\\')) {
    return false
  }

  // Reject null bytes
  if (hookName.includes('\0') || hookName.includes('%00')) {
    return false
  }

  // Only allow PascalCase identifiers (letters only, must start with uppercase)
  return /^[A-Z][a-zA-Z]+$/.test(hookName)
}

/**
 * Validate timestamp format.
 * Prevents injection and overflow attacks.
 *
 * Security constraints:
 * - Only positive integers
 * - Reasonable range (Unix epoch to far future)
 * - No scientific notation or special characters
 */
export function isValidTimestamp(timestamp: string | undefined): boolean {
  if (!timestamp || typeof timestamp !== 'string') {
    return false
  }

  // Only allow digits
  if (!/^\d+$/.test(timestamp)) {
    return false
  }

  const num = parseInt(timestamp, 10)

  // Reject invalid numbers
  if (isNaN(num) || !isFinite(num)) {
    return false
  }

  // Reasonable range: Unix epoch (1970) to year 2100
  // In milliseconds: 0 to ~4100000000000
  if (num < 0 || num > 4100000000000) {
    return false
  }

  return true
}

/**
 * Validate filename format for staged reminder files.
 * Prevents directory traversal in reminder file access.
 *
 * Security constraints:
 * - Only alphanumeric, underscore, hyphen, dot
 * - Must end with .json
 * - No path separators
 * - Max 255 characters (filesystem limit)
 */
export function isValidFilename(filename: string | undefined): boolean {
  if (!filename || typeof filename !== 'string') {
    return false
  }

  // Reject empty or too long (filesystem limit)
  if (filename.length === 0 || filename.length > 255) {
    return false
  }

  // Must end with .json
  if (!filename.endsWith('.json')) {
    return false
  }

  // Reject path traversal patterns
  if (filename.includes('..') || filename.includes('/') || filename.includes('\\')) {
    return false
  }

  // Reject null bytes
  if (filename.includes('\0') || filename.includes('%00')) {
    return false
  }

  // Only allow safe filename characters: alphanumeric, underscore, hyphen, dot
  return /^[\w.-]+\.json$/.test(filename)
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

// Re-export types for convenience
export type { ApiContext, ApiRequest } from './types'
