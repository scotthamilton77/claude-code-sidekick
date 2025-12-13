import { useState, useMemo, useEffect } from 'react'
import Header from './components/Header'
import Layout from './components/Layout'
import StateInspector from './components/StateInspector'
import Timeline from './components/Timeline'
import Transcript from './components/Transcript'
import PreCompactViewer from './components/PreCompactViewer'
import type { Session, DecisionLogFilter } from './types'
import type { TranscriptMetrics } from '@sidekick/types'
import { useLogService } from './hooks/useLogService'
import { useCompactionHistory } from './hooks/useCompactionHistory'
import { useSupervisorStatus } from './hooks/useSupervisorStatus'
import { filterEvents } from './lib/filter-parser'
import {
  events as mockEvents,
  currentSession as initialSession,
  otherSessions as mockOtherSessions,
  stateData,
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

  // Handle live toggle
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
            onToggleLive={handleToggleLive}
            onSelectSession={handleSelectSession}
          />
        }
        timeline={
          <Timeline
            events={events}
            currentEventId={currentEventId}
            filteredEvents={filteredEvents}
            onEventSelect={setCurrentEventId}
            getEventColor={getEventColor}
            compactionEntries={compactionHistory.history}
            selectedCompaction={compactionHistory.selectedCompaction}
            onCompactionSelect={(entry) => void compactionHistory.loadSnapshot(entry)}
          />
        }
        transcript={
          <Transcript
            filteredEvents={filteredEvents}
            currentEventId={currentEventId}
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterType={filterType}
            onFilterChange={setFilterType}
          />
        }
        inspector={
          <StateInspector
            stateData={stateData}
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
            onEventSelect={setCurrentEventId}
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
