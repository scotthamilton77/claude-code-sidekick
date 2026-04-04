import { useState, useEffect } from 'react'
import { toErrorMessage } from '../utils/toErrorMessage'
import type { TranscriptLine } from '../types'

export interface UseTranscriptResult {
  lines: TranscriptLine[]
  loading: boolean
  error: string | null
}

export function useTranscript(
  projectId: string | null,
  sessionId: string | null
): UseTranscriptResult {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!projectId || !sessionId) {
      setLines([])
      setLoading(false)
      setError(null)
      return
    }

    let cancelled = false
    setLoading(true)
    setError(null)

    async function fetchTranscript() {
      try {
        const res = await fetch(
          `/api/projects/${encodeURIComponent(projectId!)}/sessions/${encodeURIComponent(sessionId!)}/transcript`
        )
        if (!res.ok) {
          throw new Error(`Failed to fetch transcript: ${res.status}`)
        }
        const { lines: apiLines } = (await res.json()) as { lines: TranscriptLine[] }
        if (!cancelled) {
          setLines(apiLines)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(toErrorMessage(err))
          setLines([])
          setLoading(false)
        }
      }
    }

    fetchTranscript()

    return () => {
      cancelled = true
    }
  }, [projectId, sessionId])

  return { lines, loading, error }
}
