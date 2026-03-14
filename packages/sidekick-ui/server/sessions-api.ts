import { readdir, readFile, stat, access } from 'node:fs/promises'
import { exec } from 'node:child_process'
import { join, basename } from 'node:path'

/** Heartbeat recency threshold (matches daemon's 5s interval) */
const ACTIVE_THRESHOLD_MS = 5_000

/** Session state recency for "active" status */
const SESSION_ACTIVE_THRESHOLD_MS = 30_000

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
 * Get git branch for a project directory.
 * Returns 'unknown' if git command fails.
 */
function getGitBranch(projectDir: string): Promise<string> {
  return new Promise((resolve) => {
    exec('git branch --show-current', { cwd: projectDir }, (err, stdout) => {
      if (err) {
        resolve('unknown')
        return
      }
      resolve(stdout.trim())
    })
  })
}

/**
 * List all registered projects from the sidekick project registry.
 */
export async function listProjects(registryRoot: string): Promise<ApiProject[]> {
  let dirents
  try {
    dirents = await readdir(registryRoot, { withFileTypes: true })
  } catch {
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
      } catch {
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
    } catch {
      // Skip entries with invalid registry.json
    }
  }

  return projects
}

/**
 * Look up a single project by its registry directory name.
 * Avoids calling listProjects() (which runs git branch for every project).
 */
export async function getProjectById(registryRoot: string, projectId: string): Promise<ApiProject | null> {
  const entryFile = join(registryRoot, projectId, 'registry.json')
  try {
    const raw = await readFile(entryFile, 'utf-8')
    const entry = JSON.parse(raw) as { path: string; displayName: string; lastActive: string }

    try {
      await access(entry.path)
    } catch {
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
  } catch {
    return null
  }
}

/**
 * List all sessions for a project by scanning its .sidekick/sessions/ directory.
 */
export async function listSessions(projectDir: string, isProjectActive = false): Promise<ApiSession[]> {
  const sessionsDir = join(projectDir, '.sidekick', 'sessions')

  let dirents
  try {
    dirents = await readdir(sessionsDir, { withFileTypes: true })
  } catch {
    return []
  }

  const sessions: ApiSession[] = []

  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue

    const sessionDir = join(sessionsDir, dirent.name)

    // Get session directory mtime for date (skip on TOCTOU race)
    let dirStat
    try {
      dirStat = await stat(sessionDir)
    } catch {
      continue // directory disappeared between readdir and stat
    }
    const date = dirStat.mtime.toISOString()

    // Determine if session is active
    const isRecentlyModified = Date.now() - dirStat.mtime.getTime() < SESSION_ACTIVE_THRESHOLD_MS
    const status: 'active' | 'completed' = isProjectActive && isRecentlyModified ? 'active' : 'completed'

    // Try to read session-summary.json
    const shortId = dirent.name.slice(0, 8)
    let title = `${shortId} — No Title` // fallback
    let intent: string | undefined
    let intentConfidence: number | undefined

    try {
      const summaryPath = join(sessionDir, 'state', 'session-summary.json')
      const raw = await readFile(summaryPath, 'utf-8')
      const summary = JSON.parse(raw) as {
        session_title?: string
        latest_intent?: string
        latest_intent_confidence?: number
      }
      if (summary.session_title) title = `${shortId} — ${summary.session_title}`
      if (summary.latest_intent) intent = summary.latest_intent
      if (summary.latest_intent_confidence != null) intentConfidence = summary.latest_intent_confidence
    } catch {
      // Use fallback title
    }

    // Try to read session-persona.json
    let persona: string | undefined
    try {
      const personaPath = join(sessionDir, 'state', 'session-persona.json')
      const raw = await readFile(personaPath, 'utf-8')
      const personaData = JSON.parse(raw) as { persona_id?: string }
      if (personaData.persona_id) persona = personaData.persona_id
    } catch {
      // No persona set
    }

    sessions.push({ id: dirent.name, title, date, status, persona, intent, intentConfidence })
  }

  // Sort newest first (by ISO date string, descending)
  sessions.sort((a, b) => b.date.localeCompare(a.date))

  return sessions
}
