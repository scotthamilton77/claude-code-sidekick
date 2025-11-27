import { useState } from 'react'
import Header from './components/Header'
import Layout from './components/Layout'
import StateInspector from './components/StateInspector'
import Timeline from './components/Timeline'
import Transcript from './components/Transcript'
import { events, currentSession as initialSession, otherSessions, Session, stateData } from './data/mockData'

function App() {
  const [currentSession, setCurrentSession] = useState<Session>(initialSession)
  const [currentEventId, setCurrentEventId] = useState(6)
  const [filterType, setFilterType] = useState('all')
  const [isLive, setIsLive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

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

  // Filter events based on selected filter and search
  const filteredEvents = events.filter((event) => {
    const matchesFilter = filterType === 'all' || getEventCategory(event.type) === filterType
    const matchesSearch =
      !searchQuery ||
      (event.content?.toLowerCase().includes(searchQuery.toLowerCase()) ?? false) ||
      event.label.toLowerCase().includes(searchQuery.toLowerCase())
    return matchesFilter && matchesSearch
  })

  return (
    <Layout
      header={
        <Header
          currentSession={currentSession}
          otherSessions={otherSessions}
          isLive={isLive}
          onToggleLive={() => setIsLive(!isLive)}
          onSelectSession={setCurrentSession}
        />
      }
      timeline={
        <Timeline
          events={events}
          currentEventId={currentEventId}
          filteredEvents={filteredEvents}
          onEventSelect={setCurrentEventId}
          getEventColor={getEventColor}
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
      inspector={<StateInspector stateData={stateData} currentTime={events[currentEventId]?.time || ''} />}
    />
  )
}

export default App
