/**
 * Log Service Hook
 *
 * React hook for fetching, parsing, and polling Sidekick log files.
 * Manages log data state and provides live mode polling.
 *
 * @see src/lib/log-parser.ts for NDJSON parsing
 * @see src/lib/event-adapter.ts for UIEvent conversion
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2 Time Travel
 */

import { useState, useEffect, useCallback, useRef } from 'react'
import { parseNdjson, mergeLogStreams, type ParsedLogRecord } from '../lib/log-parser'
import { logRecordsToUIEvents } from '../lib/event-adapter'
import type { UIEvent } from '../types'

// ============================================================================
// Types
// ============================================================================

export interface LogServiceState {
  /** All parsed log records (merged from CLI and Supervisor) */
  records: ParsedLogRecord[]
  /** Converted UIEvents for display */
  events: UIEvent[]
  /** Available session IDs */
  sessions: string[]
  /** Currently selected session ID */
  selectedSession: string | null
  /** Whether initial load is in progress */
  loading: boolean
  /** Error message if load failed */
  error: string | null
  /** Whether live mode polling is active */
  isLive: boolean
  /** Last successful fetch timestamp */
  lastFetch: number | null
  /** Whether API is available */
  apiAvailable: boolean
}

export interface LogServiceActions {
  /** Refresh logs from API */
  refresh: () => Promise<void>
  /** Select a session to filter by */
  selectSession: (sessionId: string | null) => void
  /** Toggle live mode polling */
  toggleLive: () => void
  /** Set live mode explicitly */
  setLive: (isLive: boolean) => void
}

export interface LogServiceConfig {
  /** Polling interval in ms (default: 2000) */
  pollInterval?: number
  /** Auto-start live mode on mount */
  autoLive?: boolean
  /** Initial session ID to filter */
  initialSession?: string
}

// ============================================================================
// API Functions
// ============================================================================

interface ApiConfig {
  logsPath: string | null
  available: boolean
}

interface ApiSessions {
  sessions: string[]
  error?: string
}

async function fetchApiConfig(): Promise<ApiConfig> {
  const res = await fetch('/api/config')
  if (!res.ok) throw new Error(`Config fetch failed: ${res.status}`)
  return res.json() as Promise<ApiConfig>
}

async function fetchSessions(): Promise<string[]> {
  const res = await fetch('/api/logs/sessions')
  if (!res.ok) return []
  const data = (await res.json()) as ApiSessions
  return data.sessions
}

async function fetchLogFile(
  source: 'cli' | 'supervisor',
  options?: { since?: number; sessionId?: string }
): Promise<{ content: string; mtime: number }> {
  const params = new URLSearchParams()
  if (options?.since) params.set('since', options.since.toString())
  if (options?.sessionId) params.set('sessionId', options.sessionId)

  const url = `/api/logs/${source}${params.toString() ? `?${params}` : ''}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Log fetch failed: ${res.status}`)
  }

  const content = await res.text()
  const mtime = parseInt(res.headers.get('X-File-Mtime') ?? '0', 10)

  return { content, mtime }
}

// ============================================================================
// Hook Implementation
// ============================================================================

const DEFAULT_POLL_INTERVAL = 2000

export function useLogService(config: LogServiceConfig = {}): LogServiceState & LogServiceActions {
  const { pollInterval = DEFAULT_POLL_INTERVAL, autoLive = false, initialSession } = config

  // State
  const [records, setRecords] = useState<ParsedLogRecord[]>([])
  const [sessions, setSessions] = useState<string[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(initialSession ?? null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isLive, setIsLive] = useState(autoLive)
  const [lastFetch, setLastFetch] = useState<number | null>(null)
  const [apiAvailable, setApiAvailable] = useState(false)

  // Refs for polling
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMtimeRef = useRef<{ cli: number; supervisor: number }>({ cli: 0, supervisor: 0 })

  // Compute events from records, filtered by session
  const filteredRecords = selectedSession
    ? records.filter((r) => {
        const ctx = r.context
        const sessionId = ctx?.sessionId ?? ctx?.session_id
        return sessionId === selectedSession
      })
    : records

  const events = logRecordsToUIEvents(filteredRecords)

  // Fetch all logs (full refresh)
  const fetchAll = useCallback(async () => {
    try {
      // Check API availability
      const configResult = await fetchApiConfig()
      setApiAvailable(configResult.available)

      if (!configResult.available) {
        setError('Log directory not found. Create .sidekick/logs/ or ~/.sidekick/logs/')
        setLoading(false)
        return
      }

      // Fetch sessions and logs in parallel
      const [sessionsResult, cliResult, supervisorResult] = await Promise.all([
        fetchSessions(),
        fetchLogFile('cli'),
        fetchLogFile('supervisor'),
      ])

      // Parse and merge
      const cliRecords = parseNdjson(cliResult.content)
      const supervisorRecords = parseNdjson(supervisorResult.content)
      const merged = mergeLogStreams(cliRecords, supervisorRecords)

      // Update state
      setSessions(sessionsResult)
      setRecords(merged)
      setError(null)
      setLastFetch(Date.now())
      lastMtimeRef.current = { cli: cliResult.mtime, supervisor: supervisorResult.mtime }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch logs')
    } finally {
      setLoading(false)
    }
  }, [])

  // Poll for new logs (incremental)
  const pollLogs = useCallback(async () => {
    if (!apiAvailable) return

    try {
      // Only fetch if files have changed (check mtime via headers)
      const [cliResult, supervisorResult] = await Promise.all([fetchLogFile('cli'), fetchLogFile('supervisor')])

      // Check if anything changed
      if (cliResult.mtime === lastMtimeRef.current.cli && supervisorResult.mtime === lastMtimeRef.current.supervisor) {
        return // No changes
      }

      // Parse and merge
      const cliRecords = parseNdjson(cliResult.content)
      const supervisorRecords = parseNdjson(supervisorResult.content)
      const merged = mergeLogStreams(cliRecords, supervisorRecords)

      // Update state
      setRecords(merged)
      setLastFetch(Date.now())
      lastMtimeRef.current = { cli: cliResult.mtime, supervisor: supervisorResult.mtime }

      // Update sessions if new ones appeared
      const newSessions = await fetchSessions()
      setSessions(newSessions)
    } catch {
      // Silent fail for polling - don't disturb UI
    }
  }, [apiAvailable])

  // Actions
  const refresh = useCallback(async () => {
    setLoading(true)
    await fetchAll()
  }, [fetchAll])

  const selectSession = useCallback((sessionId: string | null) => {
    setSelectedSession(sessionId)
  }, [])

  const toggleLive = useCallback(() => {
    setIsLive((prev) => !prev)
  }, [])

  // Initial fetch
  useEffect(() => {
    void fetchAll()
  }, [fetchAll])

  // Polling effect
  useEffect(() => {
    if (!isLive) {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
      return
    }

    // Start polling
    pollTimerRef.current = setInterval(() => {
      void pollLogs()
    }, pollInterval)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [isLive, pollInterval, pollLogs])

  return {
    // State
    records,
    events,
    sessions,
    selectedSession,
    loading,
    error,
    isLive,
    lastFetch,
    apiAvailable,
    // Actions
    refresh,
    selectSession,
    toggleLive,
    setLive: setIsLive,
  }
}

export default useLogService
