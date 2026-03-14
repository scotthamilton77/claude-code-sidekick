import { useMemo } from 'react'
import type { SidekickEvent } from '../../types'
import { SIDEKICK_EVENT_TO_FILTER } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'
import { TimelineFilterBar } from './TimelineFilterBar'
import { TimelineEventItem } from './TimelineEvent'

interface TimelineProps {
  events: SidekickEvent[]
  loading?: boolean
  error?: string | null
}

export function Timeline({ events, loading, error }: TimelineProps) {
  const { state, dispatch } = useNavigation()

  const visibleEvents = useMemo(() => {
    if (state.timelineFilters.size === 0) return events
    return events.filter(event => {
      const filterCategory = SIDEKICK_EVENT_TO_FILTER[event.type]
      return filterCategory ? state.timelineFilters.has(filterCategory) : true
    })
  }, [events, state.timelineFilters])

  return (
    <div className="h-full flex flex-col">
      <TimelineFilterBar />
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-400">Loading events…</div>
        ) : error ? (
          <div className="flex items-center justify-center h-32 text-xs text-red-400 px-2 text-center">{error}</div>
        ) : visibleEvents.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-400">No events</div>
        ) : visibleEvents.map(event => (
          <TimelineEventItem
            key={event.id}
            event={event}
            isSynced={state.syncedTranscriptLineId === event.transcriptLineId}
            onClick={() => dispatch({ type: 'SYNC_TO_TIMELINE_EVENT', lineId: event.transcriptLineId })}
          />
        ))}
      </div>
    </div>
  )
}
