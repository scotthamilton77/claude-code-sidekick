import { useState, useMemo, useEffect, useRef } from 'react'
import Header from './components/Header'
import Layout from './components/Layout'
import StateInspector from './components/StateInspector'
import Timeline from './components/Timeline'
import Transcript, { type TranscriptRef } from './components/Transcript'
import PreCompactViewer from './components/PreCompactViewer'
import type { Session, DecisionLogFilter } from './types'
import type { TranscriptMetrics } from '@sidekick/types'
import { useLogService } from './hooks/useLogService'
import { useCompactionHistory } from './hooks/useCompactionHistory'
import { useSupervisorStatus } from './hooks/useSupervisorStatus'
import { filterEvents } from './lib/filter-parser'
import type { ReplayState } from './lib/replay-engine'
import {
  events as mockEvents,
  currentSession as initialSession,
  otherSessions as mockOtherSessions,
} from './data/mockData'

function App() {
  // Log service for real data
  const logService = useLogService({ autoLive: false })

  // Fallback to mock data when API unavailable
  const useRealData = logService.apiAvailable && logService.events.length > 0
  const events = useRealData ? logService.events : mockEvents

  // Compaction history for the current session
  const compactionHistory = useCompactionHistory(logService.selectedSession)

  // Supervisor status for health monitoring
  const supervisorStatus = useSupervisorStatus()

  // Metrics state - fetched from API
  const [metrics, setMetrics] = useState<TranscriptMetrics | null>(null)
  const [metricsHistory, setMetricsHistory] = useState<TranscriptMetrics[]>([])

  // Fetch metrics when session changes
  useEffect(() => {
    if (!logService.selectedSession || !logService.apiAvailable) {
      setMetrics(null)
      setMetricsHistory([])
      return
    }

    const fetchMetrics = async () => {
      try {
        const res = await fetch(`/api/sessions/${logService.selectedSession}/metrics`)
        if (res.ok) {
          const data = (await res.json()) as { metrics: TranscriptMetrics }
          setMetrics(data.metrics)
          // Append to history for sparkline (keep last 20)
          setMetricsHistory((prev) => [...prev.slice(-19), data.metrics])
        }
      } catch {
        // Silent fail - metrics are optional
      }
    }

    void fetchMetrics()
  }, [logService.selectedSession, logService.apiAvailable, logService.lastFetch])

  // Session management - derive from real sessions or use mock
  const realSessions: Session[] = useMemo(() => {
    return logService.sessions.map((id, index) => ({
      id,
      title: `Session ${id.slice(0, 8)}`,
      date: index === 0 ? 'Current' : `Session ${index + 1}`,
      branch: 'unknown',
    }))
  }, [logService.sessions])

  const otherSessions = useRealData ? realSessions : mockOtherSessions
  const [mockSession, setMockSession] = useState<Session>(initialSession)

  // Current session - derive from selected session ID or use mock
  const currentSession = useMemo(() => {
    if (useRealData && logService.selectedSession) {
      const found = realSessions.find((s) => s.id === logService.selectedSession)
      if (found) return found
    }
    return useRealData && realSessions.length > 0 ? realSessions[0] : mockSession
  }, [useRealData, logService.selectedSession, realSessions, mockSession])

  const [currentEventId, setCurrentEventId] = useState(events.length > 0 ? events.length - 1 : 0)
  const [filterType, setFilterType] = useState('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [decisionFilter, setDecisionFilter] = useState<DecisionLogFilter>({ category: 'all' })

  // Playback mode: 'live' follows new events, 'paused' stays at selected event
  const [playbackMode, setPlaybackMode] = useState<'live' | 'paused'>('live')

  // Ref to Transcript component for auto-scroll in live mode
  const transcriptRef = useRef<TranscriptRef>(null)

  // Get replay state at current event timestamp
  const currentReplayState = useMemo<ReplayState>(() => {
    if (events.length === 0 || currentEventId < 0 || currentEventId >= events.length) {
      return logService.getStateAt(0) // Return initial state
    }
    const currentEvent = events[currentEventId]
    // Parse timestamp from event.id (which is a string representation of timestamp)
    // For now, use the event's original timestamp from the log records
    const timestamp =
      logService.records.find((r) => r.pino.time.toString() === currentEvent.id.toString())?.pino.time ?? 0
    return logService.getStateAt(timestamp)
  }, [events, currentEventId, logService])

  const getEventColor = (type: string) => {
    const colors: Record<string, string> = {
      session: 'bg-slate-400',
      user: 'bg-blue-500',
      assistant: 'bg-emerald-500',
      decision: 'bg-amber-500',
      state: 'bg-purple-500',
      tool: 'bg-cyan-500',
      reminder: 'bg-rose-500',
    }
    return colors[type] || 'bg-gray-500'
  }

  const getEventCategory = (type: string) => {
    if (type === 'user' || type === 'assistant') return 'conversation'
    return 'system'
  }

  // Build filter query from UI state and search input
  const buildFilterQuery = (): string => {
    const parts: string[] = []

    // Add category filter if not 'all'
    // We don't have direct kind mapping, so we handle this separately

    // Add search query which may include filter syntax
    if (searchQuery) {
      parts.push(searchQuery)
    }

    return parts.join(' ')
  }

  // Filter events based on selected filter and search
  const filteredEvents = useMemo(() => {
    let filtered = events

    // Apply category filter first (all/conversation/system)
    if (filterType !== 'all') {
      filtered = filtered.filter((event) => {
        const category = getEventCategory(event.type)
        return category === filterType
      })
    }

    // Apply search/filter query (supports kind:, type:, hook:, source:, and free text)
    const query = buildFilterQuery()
    if (query) {
      filtered = filterEvents(filtered, query)
    }

    return filtered
  }, [events, filterType, searchQuery])

  // Handle session selection
  const handleSelectSession = (session: Session) => {
    if (useRealData) {
      logService.selectSession(session.id)
    } else {
      setMockSession(session)
    }
  }

  // Auto-advance to latest event when in live mode and new events arrive
  useEffect(() => {
    if (playbackMode === 'live' && events.length > 0) {
      setCurrentEventId(events.length - 1)
      // Auto-scroll transcript to bottom in live mode
      transcriptRef.current?.scrollToBottom()
    }
  }, [events.length, playbackMode])

  // Handle event selection - switches to paused mode
  const handleEventSelect = (eventId: number) => {
    setCurrentEventId(eventId)
    setPlaybackMode('paused')
  }

  // Handle "Go Live" - returns to live mode
  const handleGoLive = () => {
    setPlaybackMode('live')
    setCurrentEventId(events.length > 0 ? events.length - 1 : 0)
    if (useRealData && !logService.isLive) {
      logService.toggleLive()
    }
  }

  // Handle live toggle (polling on/off)
  const handleToggleLive = () => {
    if (useRealData) {
      logService.toggleLive()
    }
  }

  const isLive = useRealData ? logService.isLive : false

  return (
    <>
      <Layout
        header={
          <Header
            currentSession={currentSession}
            otherSessions={otherSessions.filter((s) => s.id !== currentSession.id)}
            isLive={isLive}
            playbackMode={playbackMode}
            onToggleLive={handleToggleLive}
            onGoLive={handleGoLive}
            onSelectSession={handleSelectSession}
          />
        }
        timeline={
          <Timeline
            events={events}
            currentEventId={currentEventId}
            filteredEvents={filteredEvents}
            onEventSelect={handleEventSelect}
            getEventColor={getEventColor}
            compactionEntries={compactionHistory.history}
            selectedCompaction={compactionHistory.selectedCompaction}
            onCompactionSelect={(entry) => void compactionHistory.loadSnapshot(entry)}
          />
        }
        transcript={
          <Transcript
            ref={transcriptRef}
            filteredEvents={filteredEvents}
            currentEventId={currentEventId}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterType={filterType}
            onFilterChange={setFilterType}
            onEventSelect={handleEventSelect}
          />
        }
        inspector={
          <StateInspector
            replayState={currentReplayState}
            currentTime={events[currentEventId]?.time || ''}
            metrics={metrics}
            metricsHistory={metricsHistory}
            showMetrics={useRealData}
            supervisorStatus={supervisorStatus.status}
            supervisorStatusHistory={supervisorStatus.statusHistory}
            supervisorIsOnline={supervisorStatus.isOnline}
            events={events}
            decisionFilter={decisionFilter}
            onDecisionFilterChange={setDecisionFilter}
            onEventSelect={handleEventSelect}
            currentEventId={currentEventId}
            timeTravelStore={logService.timeTravelStore}
          />
        }
      />

      {/* Pre-Compaction Viewer Modal */}
      {compactionHistory.selectedCompaction && (
        <PreCompactViewer
          entry={compactionHistory.selectedCompaction}
          content={compactionHistory.snapshotContent}
          loading={compactionHistory.loadingSnapshot}
          onClose={() => compactionHistory.selectCompaction(null)}
        />
      )}
    </>
  )
}

export default App
