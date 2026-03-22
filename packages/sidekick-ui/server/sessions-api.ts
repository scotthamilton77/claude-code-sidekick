import { readdir, readFile, stat, access } from 'node:fs/promises'
import { join, basename } from 'node:path'
import type { Logger } from '@sidekick/types'
import { getGitBranch } from './git-branch-cache.js'

/** Heartbeat recency threshold (matches daemon's 5s interval) */
const ACTIVE_THRESHOLD_MS = 5_000

/** Session state recency for "active" status */
const SESSION_ACTIVE_THRESHOLD_MS = 30_000

/** Parse JSON from a PromiseSettledResult, logging on read failure or parse error. */
function parseJsonResult<T>(
  result: PromiseSettledResult<string>,
  failureMsg: string,
  sessionId: string,
  logger?: Logger,
): T | undefined {
  if (result.status === 'fulfilled') {
    try {
      return JSON.parse(result.value) as T
    } catch (err) {
      logger?.debug(failureMsg, {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  } else {
    logger?.debug(failureMsg, {
      sessionId,
      error: result.reason instanceof Error ? result.reason.message : String(result.reason),
    })
  }
  return undefined
}

export interface ApiProject {
  id: string
  name: string
  projectDir: string
  branch: string
  active: boolean
}

export interface ApiSession {
  id: string
  title: string
  date: string
  status: 'active' | 'completed'
  persona?: string
  intent?: string
  intentConfidence?: number
}

/**
 * List all registered projects from the sidekick project registry.
 */
export async function listProjects(registryRoot: string, logger?: Logger): Promise<ApiProject[]> {
  let dirents
  try {
    dirents = await readdir(registryRoot, { withFileTypes: true })
  } catch (err) {
    logger?.warn('Failed to read registry directory', {
      registryRoot,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  const projects: ApiProject[] = []

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue

    const registryFile = join(registryRoot, dirent.name, 'registry.json')
    try {
      const raw = await readFile(registryFile, 'utf-8')
      const entry = JSON.parse(raw) as {
        path: string
        displayName: string
        lastActive: string
      }

      // Check if project directory still exists
      try {
        await access(entry.path)
      } catch (err) {
        logger?.debug('Project directory not accessible', {
          projectDir: entry.path,
          error: err instanceof Error ? err.message : String(err),
        })
        continue // skip projects whose directory is gone
      }

      // Filter out private/temp directories by default
      if (dirent.name.startsWith('-private')) continue

      const lastActiveMs = new Date(entry.lastActive).getTime()
      const active = Date.now() - lastActiveMs < ACTIVE_THRESHOLD_MS

      const branch = await getGitBranch(entry.path)

      projects.push({
        id: dirent.name,
        name: entry.displayName || basename(entry.path),
        projectDir: entry.path,
        branch,
        active,
      })
    } catch (err) {
      logger?.warn('Failed to parse registry entry', {
        registryFile,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return projects
}

/**
 * Look up a single project by its registry directory name.
 * Avoids calling listProjects() (which runs git branch for every project).
 */
export async function getProjectById(registryRoot: string, projectId: string, logger?: Logger): Promise<ApiProject | null> {
  const entryFile = join(registryRoot, projectId, 'registry.json')
  try {
    const raw = await readFile(entryFile, 'utf-8')
    const entry = JSON.parse(raw) as { path: string; displayName: string; lastActive: string }

    try {
      await access(entry.path)
    } catch (err) {
      logger?.debug('Project directory not accessible', {
        projectDir: entry.path,
        error: err instanceof Error ? err.message : String(err),
      })
      return null
    }

    if (projectId.startsWith('-private')) return null

    const lastActiveMs = new Date(entry.lastActive).getTime()
    const active = Date.now() - lastActiveMs < ACTIVE_THRESHOLD_MS
    const branch = await getGitBranch(entry.path)

    return {
      id: projectId,
      name: entry.displayName || basename(entry.path),
      projectDir: entry.path,
      branch,
      active,
    }
  } catch (err) {
    logger?.warn('Failed to read project registry', {
      projectId,
      error: err instanceof Error ? err.message : String(err),
    })
    return null
  }
}

/**
 * List all sessions for a project by scanning its .sidekick/sessions/ directory.
 */
export async function listSessions(projectDir: string, isProjectActive = false, logger?: Logger): Promise<ApiSession[]> {
  const sessionsDir = join(projectDir, '.sidekick', 'sessions')

  let dirents
  try {
    dirents = await readdir(sessionsDir, { withFileTypes: true })
  } catch (err) {
    logger?.debug('Sessions directory not readable', {
      sessionsDir,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }

  const sessionPromises = dirents
    .filter(dirent => dirent.isDirectory())
    .map(async (dirent): Promise<ApiSession | null> => {
      const sessionDir = join(sessionsDir, dirent.name)

      // Get session directory mtime for date (skip on TOCTOU race)
      let dirStat
      try {
        dirStat = await stat(sessionDir)
      } catch (err) {
        logger?.debug('Session directory disappeared during scan', {
          sessionDir,
          error: err instanceof Error ? err.message : String(err),
        })
        return null
      }
      const date = dirStat.mtime.toISOString()

      const isRecentlyModified = Date.now() - dirStat.mtime.getTime() < SESSION_ACTIVE_THRESHOLD_MS
      const status: 'active' | 'completed' = isProjectActive && isRecentlyModified ? 'active' : 'completed'

      const shortId = dirent.name.slice(0, 8)

      const summaryPath = join(sessionDir, 'state', 'session-summary.json')
      const personaPath = join(sessionDir, 'state', 'session-persona.json')

      // allSettled so one file failure doesn't block the other
      const [summaryResult, personaResult] = await Promise.allSettled([
        readFile(summaryPath, 'utf-8'),
        readFile(personaPath, 'utf-8'),
      ])

      let title = `${shortId} — No Title`
      let intent: string | undefined
      let intentConfidence: number | undefined

      const summaryData = parseJsonResult<{
        session_title?: string
        latest_intent?: string
        latest_intent_confidence?: number
      }>(summaryResult, 'Session summary not available', dirent.name, logger)

      if (summaryData) {
        if (summaryData.session_title) title = `${shortId} — ${summaryData.session_title}`
        if (summaryData.latest_intent) intent = summaryData.latest_intent
        if (summaryData.latest_intent_confidence != null) intentConfidence = summaryData.latest_intent_confidence
      }

      const personaData = parseJsonResult<{ persona_id?: string }>(
        personaResult, 'Session persona not available', dirent.name, logger,
      )
      const persona = personaData?.persona_id

      return { id: dirent.name, title, date, status, persona, intent, intentConfidence }
    })

  const results = await Promise.all(sessionPromises)
  const sessions = results.filter((s): s is ApiSession => s !== null)

  // Sort newest first (by ISO date string, descending)
  sessions.sort((a, b) => b.date.localeCompare(a.date))

  return sessions
}
