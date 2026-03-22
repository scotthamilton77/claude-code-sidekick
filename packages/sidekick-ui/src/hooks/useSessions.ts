import { useState, useEffect, useMemo, useRef } from 'react'
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

export interface SessionError {
  projectId: string
  projectName: string
  error: string
}

export interface UseSessionsResult {
  projects: Project[]
  loading: boolean
  error: string | null
  sessionErrors: SessionError[]
}

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

/** Detect meaningful data changes between fetches — excludes client-side state (transcriptLines, ledStates, etc.) that's always empty at fetch time. */
export function buildProjectsFingerprint(projects: Project[]): string {
  return JSON.stringify(
    projects.map((p) => ({
      id: p.id,
      name: p.name,
      projectDir: p.projectDir,
      sessionLoadError: p.sessionLoadError,
      sessions: p.sessions.map((s) => ({
        id: s.id,
        title: s.title,
        dateRaw: s.dateRaw,
        branch: s.branch,
        projectId: s.projectId,
        persona: s.persona,
        intent: s.intent,
        intentConfidence: s.intentConfidence,
        status: s.status,
      })),
    }))
  )
}

export function useSessions(): UseSessionsResult {
  const [projects, setProjects] = useState<Project[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const prevFingerprintRef = useRef<string>('')

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
              if (!sessionsRes.ok) {
                return {
                  id: apiProject.id,
                  name: apiProject.name,
                  projectDir: apiProject.projectDir,
                  sessions,
                  sessionLoadError: `Failed to fetch sessions: ${sessionsRes.status}`,
                }
              }
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
            } catch (sessionErr) {
              const errorMsg = sessionErr instanceof Error ? sessionErr.message : String(sessionErr)
              return {
                id: apiProject.id,
                name: apiProject.name,
                projectDir: apiProject.projectDir,
                sessions,
                sessionLoadError: errorMsg,
              }
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
          const fingerprint = buildProjectsFingerprint(projectsWithSessions)
          if (fingerprint !== prevFingerprintRef.current) {
            prevFingerprintRef.current = fingerprint
            setProjects(projectsWithSessions)
          }
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

  const sessionErrors = useMemo<SessionError[]>(
    () =>
      projects
        .filter((p) => p.sessionLoadError != null)
        .map((p) => ({
          projectId: p.id,
          projectName: p.name,
          error: p.sessionLoadError!,
        })),
    [projects]
  )

  return { projects, loading, error, sessionErrors }
}
