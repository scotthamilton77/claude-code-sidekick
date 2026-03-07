/**
 * useCompactionHistory Hook
 *
 * React hook for fetching compaction history and pre-compact snapshots.
 * Provides data for the Compaction Timeline feature.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.1 Compaction Timeline
 * @see docs/design/TRANSCRIPT-PROCESSING.md §4.2 Compaction History Schema
 */

import { useState, useEffect, useCallback } from 'react'
import type { TranscriptMetrics } from '@sidekick/types'

/**
 * Compaction history entry from compaction-history.json.
 */
export interface CompactionEntry {
  /** Timestamp when compaction occurred (Unix ms) */
  compactedAt: number
  /** Relative path to pre-compact snapshot */
  transcriptSnapshotPath: string
  /** Metrics at the time of compaction */
  metricsAtCompaction: TranscriptMetrics
  /** Line count after compaction */
  postCompactLineCount: number
}

export interface CompactionHistoryState {
  /** Compaction history entries */
  history: CompactionEntry[]
  /** Whether initial load is in progress */
  loading: boolean
  /** Error message if load failed */
  error: string | null
  /** Currently selected compaction entry (for viewing snapshot) */
  selectedCompaction: CompactionEntry | null
  /** Pre-compact snapshot content (NDJSON string) */
  snapshotContent: string | null
  /** Whether snapshot is being loaded */
  loadingSnapshot: boolean
}

export interface CompactionHistoryActions {
  /** Refresh compaction history from API */
  refresh: () => Promise<void>
  /** Select a compaction entry to view its snapshot */
  selectCompaction: (entry: CompactionEntry | null) => void
  /** Load pre-compact snapshot for selected entry */
  loadSnapshot: (entry: CompactionEntry) => Promise<void>
}

/**
 * Fetch compaction history for a session.
 */
async function fetchCompactionHistory(sessionId: string): Promise<CompactionEntry[]> {
  const res = await fetch(`/api/sessions/${sessionId}/compaction-history`)
  if (!res.ok) {
    throw new Error(`Failed to fetch compaction history: ${res.status}`)
  }
  const data = (await res.json()) as { history: CompactionEntry[]; error?: string }
  if (data.error) {
    throw new Error(data.error)
  }
  return data.history
}

/**
 * Fetch pre-compact snapshot content.
 */
async function fetchPreCompactSnapshot(sessionId: string, timestamp: number): Promise<string> {
  const res = await fetch(`/api/sessions/${sessionId}/pre-compact/${timestamp}`)
  if (!res.ok) {
    throw new Error(`Failed to fetch snapshot: ${res.status}`)
  }
  return res.text()
}

/**
 * Hook for managing compaction history data.
 */
export function useCompactionHistory(sessionId: string | null): CompactionHistoryState & CompactionHistoryActions {
  const [history, setHistory] = useState<CompactionEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedCompaction, setSelectedCompaction] = useState<CompactionEntry | null>(null)
  const [snapshotContent, setSnapshotContent] = useState<string | null>(null)
  const [loadingSnapshot, setLoadingSnapshot] = useState(false)

  // Fetch history when session changes
  const refresh = useCallback(async () => {
    if (!sessionId) {
      setHistory([])
      setError(null)
      return
    }

    setLoading(true)
    setError(null)

    try {
      const data = await fetchCompactionHistory(sessionId)
      setHistory(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load compaction history')
      setHistory([])
    } finally {
      setLoading(false)
    }
  }, [sessionId])

  // Load history on mount and when session changes
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Clear selection when session changes
  useEffect(() => {
    setSelectedCompaction(null)
    setSnapshotContent(null)
  }, [sessionId])

  // Select a compaction entry
  const selectCompaction = useCallback((entry: CompactionEntry | null) => {
    setSelectedCompaction(entry)
    if (!entry) {
      setSnapshotContent(null)
    }
  }, [])

  // Load pre-compact snapshot
  const loadSnapshot = useCallback(
    async (entry: CompactionEntry) => {
      if (!sessionId) return

      setLoadingSnapshot(true)
      setSelectedCompaction(entry)

      try {
        const content = await fetchPreCompactSnapshot(sessionId, entry.compactedAt)
        setSnapshotContent(content)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load snapshot')
        setSnapshotContent(null)
      } finally {
        setLoadingSnapshot(false)
      }
    },
    [sessionId]
  )

  return {
    // State
    history,
    loading,
    error,
    selectedCompaction,
    snapshotContent,
    loadingSnapshot,
    // Actions
    refresh,
    selectCompaction,
    loadSnapshot,
  }
}

export default useCompactionHistory
