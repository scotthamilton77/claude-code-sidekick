import { useMemo, useRef, useEffect, useCallback } from 'react'
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
  const eventRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  const visibleEvents = useMemo(() => {
    if (state.timelineFilters.size === 0) return events
    return events.filter(event => {
      const filterCategory = SIDEKICK_EVENT_TO_FILTER[event.type]
      return filterCategory ? state.timelineFilters.has(filterCategory) : true
    })
  }, [events, state.timelineFilters])

  const setRef = useCallback((transcriptLineId: string) => (el: HTMLDivElement | null) => {
    if (el) {
      eventRefs.current.set(transcriptLineId, el)
    } else {
      eventRefs.current.delete(transcriptLineId)
    }
  }, [])

  // Scroll to event when transcript dispatches SYNC_TO_TRANSCRIPT_EVENT
  useEffect(() => {
    if (state.syncedTimelineLineId) {
      const el = eventRefs.current.get(state.syncedTimelineLineId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [state.syncedTimelineLineId])

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
          <div key={event.id} ref={setRef(event.transcriptLineId)}>
            <TimelineEventItem
              event={event}
              isSynced={
                state.syncedTranscriptLineId === event.transcriptLineId ||
                state.syncedTimelineLineId === event.transcriptLineId
              }
              onClick={() => {
                dispatch({ type: 'SYNC_TO_TIMELINE_EVENT', lineId: event.transcriptLineId })
                setTimeout(() => dispatch({ type: 'CLEAR_SYNC' }), 2000)
              }}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
