import { useRef, useEffect, useCallback, useMemo } from 'react'
import type { TimelineEvent } from '../../types'
import { EVENT_TO_FILTER } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'
import { SearchFilterBar } from './SearchFilterBar'
import { TranscriptEventCard } from './TranscriptEvent'

interface TranscriptProps {
  events: TimelineEvent[]
  scrollToEventId: string | null
  hoveredEventId: string | null
  onHoverEvent: (id: string | null) => void
}

export function Transcript({ events, scrollToEventId, hoveredEventId, onHoverEvent }: TranscriptProps) {
  const { state, dispatch } = useNavigation()
  const eventRefs = useRef<Map<string, HTMLDivElement>>(new Map())

  // Scroll to event when requested
  useEffect(() => {
    if (scrollToEventId) {
      const el = eventRefs.current.get(scrollToEventId)
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      }
    }
  }, [scrollToEventId])

  const setRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) {
      eventRefs.current.set(id, el)
    } else {
      eventRefs.current.delete(id)
    }
  }, [])

  const isEventDimmed = useCallback(
    (event: TimelineEvent): boolean => {
      if (state.activeFilters.size === 0) return false
      const filter = EVENT_TO_FILTER[event.type]
      if (!filter) return false
      return !state.activeFilters.has(filter)
    },
    [state.activeFilters]
  )

  const filteredEvents = useMemo(() => {
    if (!state.searchQuery) return events
    const q = state.searchQuery.toLowerCase()
    return events.filter(e =>
      e.label.toLowerCase().includes(q) ||
      e.content?.toLowerCase().includes(q) ||
      e.toolName?.toLowerCase().includes(q) ||
      e.hookName?.toLowerCase().includes(q) ||
      e.errorMessage?.toLowerCase().includes(q)
    )
  }, [events, state.searchQuery])

  return (
    <div className="h-full flex flex-col">
      <SearchFilterBar />
      <div className="flex-1 overflow-y-auto py-1">
        {filteredEvents.map(event => (
          <div key={event.id} ref={setRef(event.id)}>
            <TranscriptEventCard
              event={event}
              isSelected={state.selectedEventId === event.id}
              isHovered={hoveredEventId === event.id}
              isDimmed={isEventDimmed(event)}
              onClick={() => dispatch({ type: 'SELECT_EVENT', eventId: event.id })}
              onMouseEnter={() => onHoverEvent(event.id)}
              onMouseLeave={() => onHoverEvent(null)}
            />
          </div>
        ))}
      </div>
    </div>
  )
}
