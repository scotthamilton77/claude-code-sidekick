/**
 * Resume Discovery — Find resume messages from previous sessions
 *
 * Extracted from state-reader.ts to isolate cross-session artifact discovery
 * from single-session state reading.
 *
 * Uses dependency injection for StateService to enable testing without
 * file system side effects.
 *
 * @see docs/design/FEATURE-RESUME.md section 3.1 Artifact Discovery
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import { SessionStateAccessor, type StateService } from '@sidekick/core'
import { ResumeMessageDescriptor } from '@sidekick/feature-session-summary'
import type { Logger } from '@sidekick/types'

import type { ResumeMessageState } from './types.js'

/**
 * Discovery result for finding resume messages from previous sessions.
 */
export interface DiscoveryResult {
  /** Resume message data if found */
  data: ResumeMessageState | null
  /** Session ID that the resume message belongs to */
  sessionId: string | null
  /** Source of the data */
  source: 'discovered' | 'not_found'
}

/**
 * Configuration for resume discovery.
 */
export interface ResumeDiscoveryConfig {
  /** Path to .sidekick/sessions/ directory */
  sessionsDir: string
  /** Current session ID to exclude from results */
  currentSessionId: string
  /** Optional logger for diagnostics */
  logger?: Logger
}

/**
 * Discover the most recent resume message from a PREVIOUS session.
 * Scans the sessions directory for other sessions with valid resume-message.json.
 *
 * Per docs/design/FEATURE-RESUME.md section 3.1:
 * - Used when current session is new (no session-summary.json yet)
 * - Returns the most recent OTHER session's resume-message.json
 *
 * Error handling:
 * - ENOENT (missing directory/file): returns not_found silently — expected for new installs
 * - Other errors: logged as warn, returns not_found — prevents statusline crash
 *
 * @param config - Discovery configuration
 * @param stateService - Injected StateService for testability
 * @returns Discovery result with most recent previous session's resume message
 */
export async function discoverPreviousResumeMessage(
  config: ResumeDiscoveryConfig,
  stateService: StateService
): Promise<DiscoveryResult> {
  const NOT_FOUND: DiscoveryResult = { data: null, sessionId: null, source: 'not_found' }

  try {
    // List all session directories
    const entries = await fs.readdir(config.sessionsDir, { withFileTypes: true })
    const sessionDirs = entries.filter((e) => e.isDirectory() && e.name !== config.currentSessionId)

    if (sessionDirs.length === 0) {
      return NOT_FOUND
    }

    // Create accessor for reading resume messages
    const resumeAccessor = new SessionStateAccessor(stateService, ResumeMessageDescriptor)

    // Collect resume messages with their modification times
    const resumeCandidates: { sessionId: string; data: ResumeMessageState; mtime: number }[] = []

    for (const dir of sessionDirs) {
      const result = await resumeAccessor.read(dir.name)

      if (result.source !== 'default' && result.data !== null && result.mtime) {
        resumeCandidates.push({
          sessionId: dir.name,
          data: result.data,
          mtime: result.mtime,
        })
      }
    }

    if (resumeCandidates.length === 0) {
      return NOT_FOUND
    }

    // Sort by mtime descending (most recent first)
    resumeCandidates.sort((a, b) => b.mtime - a.mtime)

    const mostRecent = resumeCandidates[0]
    return {
      data: mostRecent.data,
      sessionId: mostRecent.sessionId,
      source: 'discovered',
    }
  } catch (error: unknown) {
    // ENOENT is expected for new installs where sessions directory doesn't exist yet
    if (isNodeError(error) && error.code === 'ENOENT') {
      return NOT_FOUND
    }

    // Unexpected errors: log as warn to aid debugging without crashing the statusline
    config.logger?.warn('Failed to discover previous resume message', {
      sessionsDir: config.sessionsDir,
      error: error instanceof Error ? error.message : String(error),
    })
    return NOT_FOUND
  }
}

/**
 * Type guard for Node.js system errors with a `code` property.
 */
function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}

/**
 * Create a StateService rooted at the project for cross-session discovery.
 * Helper to construct StateService from sessionsDir path.
 *
 * @param sessionsDir - Path to .sidekick/sessions/ directory
 * @returns Project root path (parent of .sidekick/)
 */
export function projectRootFromSessionsDir(sessionsDir: string): string {
  // sessionsDir is .sidekick/sessions/, parent is .sidekick/, parent of that is project root
  return path.dirname(path.dirname(sessionsDir))
}
