import { useState, useEffect } from 'react'
import type { Project, Session } from '../types'

interface ApiProject {
  id: string
  name: string
  projectDir: string
  branch: string
  active: boolean
}

interface ApiSession {
  id: string
  title: string
  date: string
  status: 'active' | 'completed'
  persona?: string
  intent?: string
  intentConfidence?: number
}

export interface UseSessionsResult {
  projects: Project[]
  loading: boolean
  error: string | null
}

/**
 * Fetch session data from the Vite dev server API.
 * Maps API responses into the existing Project/Session types.
 */
/**
 * Format ISO date string to mm/dd/yyyy hh:mm am/pm in the OS timezone.
 */
function formatDate(isoDate: string): string {
  const d = new Date(isoDate)
  return d.toLocaleString('en-US', {
    month: '2-digit',
    day: '2-digit',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  })
}

export function useSessions(): UseSessionsResult {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      try {
        // Fetch projects
        const projectsRes = await fetch('/api/projects')
        if (!projectsRes.ok) {
          throw new Error(`Failed to fetch projects: ${projectsRes.status}`)
        }
        const { projects: apiProjects } = (await projectsRes.json()) as {
          projects: ApiProject[]
        }

        // Fetch sessions for each project in parallel
        const projectsWithSessions = await Promise.all(
          apiProjects.map(async (apiProject): Promise<Project> => {
            let sessions: Session[] = []

            try {
              const sessionsRes = await fetch(`/api/projects/${encodeURIComponent(apiProject.id)}/sessions`)
              if (sessionsRes.ok) {
                const { sessions: apiSessions } = (await sessionsRes.json()) as {
                  sessions: ApiSession[]
                }
                sessions = apiSessions.map(
                  (s): Session => ({
                    id: s.id,
                    title: s.title,
                    date: formatDate(s.date),
                    dateRaw: s.date,
                    branch: apiProject.branch,
                    projectId: apiProject.id,
                    persona: s.persona,
                    intent: s.intent,
                    intentConfidence: s.intentConfidence,
                    status: s.status,
                    // Empty collections — populated by later tracer bullets
                    transcriptLines: [],
                    sidekickEvents: [],
                    ledStates: new Map(),
                    stateSnapshots: [],
                  })
                )
              }
            } catch {
              // Silently skip sessions for this project on error
            }

            return {
              id: apiProject.id,
              name: apiProject.name,
              projectDir: apiProject.projectDir,
              sessions,
            }
          })
        )

        if (!cancelled) {
          setProjects(projectsWithSessions)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : String(err))
          setLoading(false)
        }
      }
    }

    fetchData()

    return () => {
      cancelled = true
    }
  }, [])

  return { projects, loading, error }
}
