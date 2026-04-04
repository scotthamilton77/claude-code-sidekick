import { useState, useEffect } from 'react'
import { toErrorMessage } from '../utils/toErrorMessage'
import type { SidekickEvent } from '../types'

export interface UseTimelineResult {
  events: SidekickEvent[]
  loading: boolean
  error: string | null
}

export function useTimeline(
  projectId: string | null,
  sessionId: string | null
): UseTimelineResult {
  const [events, setEvents] = useState<SidekickEvent[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId || !sessionId) {
      setEvents([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchTimeline() {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId!)}/sessions/${encodeURIComponent(sessionId!)}/timeline`
        )
        if (!res.ok) {
          throw new Error(`Failed to fetch timeline: ${res.status}`)
        }
        const { events: apiEvents } = (await res.json()) as { events: SidekickEvent[] }
        if (!cancelled) {
          setEvents(apiEvents)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(toErrorMessage(err))
          setEvents([])
          setLoading(false)
        }
      }
    }

    fetchTimeline()

    return () => {
      cancelled = true
    }
  }, [projectId, sessionId])

  return { events, loading, error }
}
