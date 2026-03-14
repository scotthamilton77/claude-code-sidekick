import { useCallback } from 'react'
import type { SidekickEvent } from '../../types'
import { SIDEKICK_EVENT_TO_FILTER } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'
import { TimelineFilterBar } from './TimelineFilterBar'
import { TimelineEventItem } from './TimelineEvent'

interface TimelineProps {
  events: SidekickEvent[]
  loading?: boolean
}

export function Timeline({ events, loading }: TimelineProps) {
  const { state, dispatch } = useNavigation()

  const isEventDimmed = useCallback(
    (event: SidekickEvent): boolean => {
      if (state.timelineFilters.size === 0) return false
      const filter = SIDEKICK_EVENT_TO_FILTER[event.type]
      return !state.timelineFilters.has(filter)
    },
    [state.timelineFilters]
  )

  return (
    <div className="h-full flex flex-col">
      <TimelineFilterBar />
      <div className="flex-1 overflow-y-auto py-1">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-400">Loading events…</div>
        ) : events.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-xs text-slate-400">No events</div>
        ) : events.map(event => (
          <TimelineEventItem
            key={event.id}
            event={event}
            isSynced={state.syncedTranscriptLineId === event.transcriptLineId}
            isDimmed={isEventDimmed(event)}
            onClick={() => dispatch({ type: 'SYNC_TO_TIMELINE_EVENT', lineId: event.transcriptLineId })}
          />
        ))}
      </div>
    </div>
  )
}
