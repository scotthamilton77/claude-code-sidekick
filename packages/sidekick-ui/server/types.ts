/**
 * Shared types for API plugin handlers.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §2.2 Data Flow
 */

import type { IRequest } from 'itty-router'

/** Resolved paths for log and session directories */
export interface ApiContext {
  logsPath: string | null
  sessionsPath: string | null
}

/** Default log directory paths */
export const DEFAULT_PATHS = {
  user: `${process.env.HOME ?? '~'}/.sidekick/logs`,
  project: '.sidekick/logs',
} as const

/** Sessions directory paths (sibling to logs) */
export const SESSIONS_PATHS = {
  user: `${process.env.HOME ?? '~'}/.sidekick/sessions`,
  project: '.sidekick/sessions',
} as const

/** Extended request with context and typed params */
export interface ApiRequest extends IRequest {
  ctx: ApiContext
  query: Record<string, string | undefined>
}

/** Filter options for log content */
export interface FilterOptions {
  since?: number
  sessionId?: string
}

/** API response types */
export interface ConfigResponse {
  logsPath: string | null
  available: boolean
  defaultPaths: typeof DEFAULT_PATHS
}

export interface SessionsResponse {
  sessions: string[]
  error?: string
}

export interface ErrorResponse {
  error: string
}
