/**
 * Daemon Status Hook
 *
 * React hook for fetching and polling Sidekick Daemon status.
 * Provides real-time daemon health, memory usage, queue depth, and active tasks.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.E System Health
 * @see docs/design/DAEMON.md §3 Status Endpoint
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import type { DaemonStatusWithHealth } from '@sidekick/types'

// ============================================================================
// Types
// ============================================================================

export interface DaemonStatusState {
  /** Current daemon status (null if never loaded) */
  status: DaemonStatusWithHealth | null
  /** Whether daemon is online */
  isOnline: boolean
  /** Whether initial load is in progress */
  isLoading: boolean
  /** Error message if fetch failed (distinct from offline) */
  error: string | null
  /** Status history for sparklines (last 20 entries) */
  statusHistory: DaemonStatusWithHealth[]
  /** Last successful fetch timestamp */
  lastFetch: number | null
}

export interface DaemonStatusActions {
  /** Manually refresh status from API */
  refresh: () => Promise<void>
}

export interface DaemonStatusConfig {
  /** Polling interval in ms (default: 5000) */
  pollInterval?: number
  /** History size for sparklines (default: 20) */
  historySize?: number
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchDaemonStatus(): Promise<DaemonStatusWithHealth> {
  const res = await fetch('/api/daemon/status')
  if (!res.ok) {
    throw new Error(`Daemon status fetch failed: ${res.status}`)
  }
  return res.json() as Promise<DaemonStatusWithHealth>
}

// ============================================================================
// Hook Implementation
// ============================================================================

const DEFAULT_POLL_INTERVAL = 5000
const DEFAULT_HISTORY_SIZE = 20

export function useDaemonStatus(
  config: DaemonStatusConfig = {}
): DaemonStatusState & DaemonStatusActions {
  const { pollInterval = DEFAULT_POLL_INTERVAL, historySize = DEFAULT_HISTORY_SIZE } = config

  // State
  const [status, setStatus] = useState<DaemonStatusWithHealth | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [statusHistory, setStatusHistory] = useState<DaemonStatusWithHealth[]>([])
  const [lastFetch, setLastFetch] = useState<number | null>(null)

  // Refs for polling
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch status from API
  const fetchStatus = useCallback(async () => {
    try {
      const newStatus = await fetchDaemonStatus()

      // Update current status
      setStatus(newStatus)
      setError(null)
      setLastFetch(Date.now())

      // Add to history (keep last N entries)
      setStatusHistory((prev) => {
        const updated = [...prev, newStatus]
        return updated.slice(-historySize)
      })
    } catch (err) {
      // API fetch error is distinct from offline status
      setError(err instanceof Error ? err.message : 'Failed to fetch daemon status')
      setStatus(null)
    } finally {
      setIsLoading(false)
    }
  }, [historySize])

  // Manual refresh action
  const refresh = useCallback(async () => {
    setIsLoading(true)
    await fetchStatus()
  }, [fetchStatus])

  // Initial fetch on mount
  useEffect(() => {
    void fetchStatus()
  }, [fetchStatus])

  // Polling effect
  useEffect(() => {
    // Start polling immediately
    pollTimerRef.current = setInterval(() => {
      void fetchStatus()
    }, pollInterval)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [pollInterval, fetchStatus])

  // Derive isOnline from current status
  const isOnline = status?.isOnline ?? false

  return {
    // State
    status,
    isOnline,
    isLoading,
    error,
    statusHistory,
    lastFetch,
    // Actions
    refresh,
  }
}

export default useDaemonStatus
