import { useState, useEffect } from 'react'
import { toErrorMessage } from '../utils/toErrorMessage'
import type { StateSnapshot } from '../types'

export interface UseStateSnapshotsResult {
  snapshots: StateSnapshot[]
  loading: boolean
  error: string | null
}

export function useStateSnapshots(projectId: string | null, sessionId: string | null): UseStateSnapshotsResult {
  const [snapshots, setSnapshots] = useState<StateSnapshot[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId || !sessionId) {
      setSnapshots([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchStateSnapshots() {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId!)}/sessions/${encodeURIComponent(sessionId!)}/state-snapshots`
        )
        if (!res.ok) {
          throw new Error(`Failed to fetch state snapshots: ${res.status}`)
        }
        const { snapshots: apiSnapshots } = (await res.json()) as { snapshots: StateSnapshot[] }
        if (!cancelled) {
          setSnapshots(apiSnapshots)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(toErrorMessage(err))
          setSnapshots([])
          setLoading(false)
        }
      }
    }

    fetchStateSnapshots()

    return () => {
      cancelled = true
    }
  }, [projectId, sessionId])

  return { snapshots, loading, error }
}
