/**
 * Sessions CLI Command
 *
 * Lists all daemon-tracked sessions with metadata.
 *
 * Usage:
 *   sidekick sessions [--format=json|table]
 */

import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { Writable } from 'node:stream'
import type { Logger } from '@sidekick/core'
import { StateService } from '@sidekick/core'
import type { SessionSummaryState, SessionPersonaState } from '@sidekick/types'

export interface SessionsCommandOptions {
  /** Output format: 'json' (default) or 'table' */
  format?: 'json' | 'table'
}

export interface SessionInfo {
  /** Session ID (UUID) */
  sessionId: string
  /** Session title from LLM analysis */
  title: string | null
  /** Current intent from LLM analysis */
  intent: string | null
  /** ISO8601 timestamp of last summary update */
  lastUpdated: string | null
  /** Active persona ID (if any) */
  personaId: string | null
  /** Session directory modification time */
  modifiedAt: string
}

export interface SessionsCommandResult {
  exitCode: number
  output: string
}

/**
 * Read session summary state file if it exists.
 */
async function readSessionSummary(sessionStateDir: string): Promise<SessionSummaryState | null> {
  const summaryPath = path.join(sessionStateDir, 'session-summary.json')
  try {
    const content = await fs.readFile(summaryPath, 'utf-8')
    return JSON.parse(content) as SessionSummaryState
  } catch {
    return null
  }
}

/**
 * Read session persona state file if it exists.
 */
async function readSessionPersona(sessionStateDir: string): Promise<SessionPersonaState | null> {
  const personaPath = path.join(sessionStateDir, 'session-persona.json')
  try {
    const content = await fs.readFile(personaPath, 'utf-8')
    return JSON.parse(content) as SessionPersonaState
  } catch {
    return null
  }
}

/**
 * Handle the sessions CLI command.
 *
 * Lists all sessions with their metadata (title, intent, persona, last updated).
 */
export async function handleSessionsCommand(
  projectRoot: string,
  logger: Logger,
  stdout: Writable,
  options: SessionsCommandOptions = {}
): Promise<SessionsCommandResult> {
  const format = options.format ?? 'json'
  const stateService = new StateService(projectRoot)
  const sessionsDir = stateService.sessionsDir()

  logger.debug('Listing sessions', { sessionsDir })

  try {
    // Check if sessions directory exists
    try {
      await fs.access(sessionsDir)
    } catch {
      // No sessions directory - return empty list
      const result = { sessions: [], count: 0 }
      stdout.write(JSON.stringify(result, null, 2) + '\n')
      return { exitCode: 0, output: JSON.stringify(result) }
    }

    // List all session directories
    const entries = await fs.readdir(sessionsDir, { withFileTypes: true })
    const sessionDirs = entries.filter((e) => e.isDirectory())

    // Collect session info
    const sessions: SessionInfo[] = []

    for (const entry of sessionDirs) {
      const sessionId = entry.name
      const sessionRootDir = stateService.sessionRootDir(sessionId)
      const sessionStateDir = stateService.sessionStateDir(sessionId)

      // Get directory modification time
      let modifiedAt: string
      try {
        const stats = await fs.stat(sessionRootDir)
        modifiedAt = stats.mtime.toISOString()
      } catch {
        modifiedAt = new Date().toISOString()
      }

      // Read session metadata
      const summary = await readSessionSummary(sessionStateDir)
      const persona = await readSessionPersona(sessionStateDir)

      sessions.push({
        sessionId,
        title: summary?.session_title ?? null,
        intent: summary?.latest_intent ?? null,
        lastUpdated: summary?.timestamp ?? null,
        personaId: persona?.persona_id ?? null,
        modifiedAt,
      })
    }

    // Sort by modification time (most recent first)
    sessions.sort((a, b) => new Date(b.modifiedAt).getTime() - new Date(a.modifiedAt).getTime())

    if (format === 'table') {
      // Human-readable table format
      if (sessions.length === 0) {
        stdout.write('No sessions found.\n')
      } else {
        stdout.write(`Sessions (${sessions.length}):\n\n`)
        for (const session of sessions) {
          const title = session.title ?? '(no title)'
          const persona = session.personaId ? `[${session.personaId}]` : ''
          const modified = new Date(session.modifiedAt).toLocaleString()
          stdout.write(`  ${session.sessionId}\n`)
          stdout.write(`    Title: ${title} ${persona}\n`)
          if (session.intent) {
            stdout.write(`    Intent: ${session.intent}\n`)
          }
          stdout.write(`    Modified: ${modified}\n\n`)
        }
      }
    } else {
      // JSON format (default)
      const result = { sessions, count: sessions.length }
      stdout.write(JSON.stringify(result, null, 2) + '\n')
    }

    logger.info('Listed sessions', { count: sessions.length })
    return { exitCode: 0, output: JSON.stringify({ count: sessions.length }) }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    logger.error('Failed to list sessions', { error: errorMsg })
    stdout.write(JSON.stringify({ error: errorMsg }, null, 2) + '\n')
    return { exitCode: 1, output: errorMsg }
  }
}
