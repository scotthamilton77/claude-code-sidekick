import { useState } from 'react'
import type { Session, TimelineEvent as TEvent } from '../types'
import { useNavigation } from '../hooks/useNavigation'
import { PanelHeader } from './PanelHeader'
import { SummaryStrip } from './SummaryStrip'
import { Timeline } from './timeline/Timeline'
import { Transcript } from './transcript/Transcript'
import { DOT_COLORS } from './timeline/TimelineEvent'

interface SessionDashboardProps {
  session: Session
}

// Compressed dashboard: dots-only vertical rail
function CompressedTimeline({ events, session, onClick }: { events: TEvent[]; session: Session; onClick: () => void }) {
  const { state } = useNavigation()

  return (
    <button
      onClick={onClick}
      className="h-full w-full flex flex-col items-center cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors"
      title={session.title}
    >
      {/* Rotated title at top */}
      <div className="py-2 px-1">
        <span className="text-vertical text-[10px] font-medium text-slate-500 dark:text-slate-400 select-none">
          {session.title}
        </span>
      </div>

      {/* Dots rail */}
      <div className="flex-1 flex flex-col items-center gap-0.5 py-1 overflow-hidden">
        {events.map(event => (
          <div
            key={event.id}
            className={`w-2 h-2 rounded-full flex-shrink-0 transition-all ${DOT_COLORS[event.type]} ${
              state.selectedEventId === event.id ? 'ring-2 ring-indigo-400 ring-offset-1 dark:ring-offset-slate-900' : ''
            }`}
            title={event.label}
          />
        ))}
      </div>
    </button>
  )
}

export function SessionDashboard({ session }: SessionDashboardProps) {
  const { state, dispatch } = useNavigation()
  const [hoveredEventId, setHoveredEventId] = useState<string | null>(null)

  if (!state.dashboardPanel.expanded) {
    return (
      <CompressedTimeline
        events={session.events}
        session={session}
        onClick={() => dispatch({ type: 'TOGGLE_DASHBOARD_PANEL' })}
      />
    )
  }

  return (
    <div className="h-full flex flex-col bg-white dark:bg-slate-900">
      <PanelHeader
        title={`Session: ${session.title}`}
        expanded={state.dashboardPanel.expanded}
        onToggle={() => dispatch({ type: 'TOGGLE_DASHBOARD_PANEL' })}
        collapseDirection="left"
      />
      <SummaryStrip session={session} />

      {/* Two-column split: Timeline | Transcript */}
      <div className="flex-1 flex overflow-hidden">
        {/* Timeline (fixed width) */}
        <div className="w-[280px] flex-shrink-0 border-r border-slate-200 dark:border-slate-700 overflow-hidden">
          <Timeline
            events={session.events}
            hoveredEventId={hoveredEventId}
            onHoverEvent={setHoveredEventId}
          />
        </div>

        {/* Transcript (flex) */}
        <div className="flex-1 overflow-hidden">
          <Transcript
            events={session.events}
            scrollToEventId={hoveredEventId}
            hoveredEventId={hoveredEventId}
            onHoverEvent={setHoveredEventId}
          />
        </div>
      </div>
    </div>
  )
}
