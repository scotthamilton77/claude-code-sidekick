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

import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { parseNdjson, mergeLogStreams, NdjsonStreamParser, type ParsedLogRecord } from '../lib/log-parser'
import { logRecordsToUIEvents } from '../lib/event-adapter'
import type { UIEvent } from '../types'
import { TimeTravelStore, type ReplayState } from '../lib/replay-engine'

// ============================================================================
// Types
// ============================================================================

export interface LogServiceState {
  /** All parsed log records (merged from CLI and daemon) */
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
  /** TimeTravelStore for replay-based state inspection */
  timeTravelStore: TimeTravelStore
  /** Get replay state at a specific timestamp */
  getStateAt: (timestamp: number) => ReplayState
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
  source: 'cli' | 'sidekickd',
  options?: { since?: number; sessionId?: string; offset?: number }
): Promise<{ content: string; mtime: number; fileSize: number; rotated: boolean }> {
  const params = new URLSearchParams()
  if (options?.since) params.set('since', options.since.toString())
  if (options?.sessionId) params.set('sessionId', options.sessionId)
  if (options?.offset !== undefined) params.set('offset', options.offset.toString())

  const url = `/api/logs/${source}${params.toString() ? `?${params}` : ''}`
  const res = await fetch(url)

  if (!res.ok) {
    throw new Error(`Log fetch failed: ${res.status}`)
  }

  const content = await res.text()
  const mtime = parseInt(res.headers.get('X-File-Mtime') ?? '0', 10)
  const fileSize = parseInt(res.headers.get('X-File-Size') ?? '0', 10)
  const rotated = res.headers.get('X-Log-Rotated') === 'true'

  return { content, mtime, fileSize, rotated }
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

  // Refs for polling and incremental fetching
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastMtimeRef = useRef<{ cli: number; sidekickd: number }>({ cli: 0, sidekickd: 0 })
  const lastOffsetRef = useRef<{ cli: number; sidekickd: number }>({ cli: 0, sidekickd: 0 })
  const streamParserRef = useRef<{ cli: NdjsonStreamParser; sidekickd: NdjsonStreamParser }>({
    cli: new NdjsonStreamParser(),
    sidekickd: new NdjsonStreamParser(),
  })

  // TimeTravelStore instance (stable across renders)
  const timeTravelStore = useMemo(() => new TimeTravelStore(), [])

  // Compute events from records, filtered by session
  const filteredRecords = selectedSession
    ? records.filter((r) => {
        const ctx = r.context
        const sessionId = ctx?.sessionId ?? ctx?.session_id
        return sessionId === selectedSession
      })
    : records

  const events = logRecordsToUIEvents(filteredRecords)

  // Update TimeTravelStore when filtered records change
  useEffect(() => {
    timeTravelStore.load(filteredRecords)
  }, [filteredRecords, timeTravelStore])

  // Callback to get state at a specific timestamp
  const getStateAt = useCallback(
    (timestamp: number): ReplayState => {
      return timeTravelStore.getStateAt(timestamp)
    },
    [timeTravelStore]
  )

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
      const [sessionsResult, cliResult, daemonResult] = await Promise.all([
        fetchSessions(),
        fetchLogFile('cli'),
        fetchLogFile('sidekickd'),
      ])

      // Reset streaming parsers on full refresh
      streamParserRef.current.cli.reset()
      streamParserRef.current.sidekickd.reset()

      // Parse and merge
      const cliRecords = parseNdjson(cliResult.content)
      const daemonRecords = parseNdjson(daemonResult.content)
      const merged = mergeLogStreams(cliRecords, daemonRecords)

      // Update state and tracking
      setSessions(sessionsResult)
      setRecords(merged)
      setError(null)
      setLastFetch(Date.now())
      lastMtimeRef.current = { cli: cliResult.mtime, sidekickd: daemonResult.mtime }
      lastOffsetRef.current = { cli: cliResult.fileSize, sidekickd: daemonResult.fileSize }
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
      // Fetch only new content from last offset
      const [cliResult, daemonResult] = await Promise.all([
        fetchLogFile('cli', { offset: lastOffsetRef.current.cli }),
        fetchLogFile('sidekickd', { offset: lastOffsetRef.current.sidekickd }),
      ])

      // Check if anything changed (cheap mtime check)
      if (
        cliResult.mtime === lastMtimeRef.current.cli &&
        daemonResult.mtime === lastMtimeRef.current.sidekickd &&
        cliResult.fileSize === lastOffsetRef.current.cli &&
        daemonResult.fileSize === lastOffsetRef.current.sidekickd
      ) {
        return // No changes
      }

      // Handle log rotation - reset and reload full
      if (cliResult.rotated || daemonResult.rotated) {
        await fetchAll()
        return
      }

      // Parse only new content using streaming parser
      const newCliRecords = streamParserRef.current.cli.push(cliResult.content)
      const newDaemonRecords = streamParserRef.current.sidekickd.push(daemonResult.content)

      // Only update if we got new records
      if (newCliRecords.length > 0 || newDaemonRecords.length > 0) {
        // Append new records to existing (maintain sorted order)
        setRecords((prev) => {
          const allRecords = [...prev, ...newCliRecords, ...newDaemonRecords]
          allRecords.sort((a, b) => a.pino.time - b.pino.time)
          return allRecords
        })

        setLastFetch(Date.now())
      }

      // Update tracking
      lastMtimeRef.current = { cli: cliResult.mtime, sidekickd: daemonResult.mtime }
      lastOffsetRef.current = { cli: cliResult.fileSize, sidekickd: daemonResult.fileSize }

      // Update sessions if new ones appeared (cheap check)
      if (newCliRecords.length > 0 || newDaemonRecords.length > 0) {
        const newSessions = await fetchSessions()
        setSessions(newSessions)
      }
    } catch {
      // Silent fail for polling - don't disturb UI
    }
  }, [apiAvailable, fetchAll])

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
    timeTravelStore,
    getStateAt,
    // Actions
    refresh,
    selectSession,
    toggleLive,
    setLive: setIsLive,
  }
}

export default useLogService
