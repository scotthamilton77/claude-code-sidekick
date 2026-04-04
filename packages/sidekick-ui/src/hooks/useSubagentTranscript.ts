import { useState, useEffect } from 'react'
import { toErrorMessage } from '../utils/toErrorMessage'
import type { TranscriptLine } from '../types'

interface SubagentMeta {
  agentType?: string
  worktreePath?: string
  parentToolUseId?: string
}

export interface UseSubagentTranscriptResult {
  lines: TranscriptLine[]
  meta: SubagentMeta
  loading: boolean
  error: string | null
}

/**
 * Fetch a subagent's transcript from the API.
 */
export function useSubagentTranscript(
  projectId: string,
  sessionId: string,
  agentId: string,
): UseSubagentTranscriptResult {
  const [lines, setLines] = useState<TranscriptLine[]>([])
  const [meta, setMeta] = useState<SubagentMeta>({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchData() {
      setLoading(true)
      setError(null)

      try {
        const url = `/api/projects/${encodeURIComponent(projectId)}/sessions/${encodeURIComponent(sessionId)}/subagents/${encodeURIComponent(agentId)}/transcript`
        const res = await fetch(url)
        if (!res.ok) {
          throw new Error(`Failed to fetch subagent transcript: ${res.status}`)
        }
        const data = await res.json() as { lines: TranscriptLine[]; meta: SubagentMeta }
        if (!cancelled) {
          setLines(data.lines)
          setMeta(data.meta ?? {})
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(toErrorMessage(err))
          setLoading(false)
        }
      }
    }

    fetchData()
    return () => { cancelled = true }
  }, [projectId, sessionId, agentId])

  return { lines, meta, loading, error }
}
