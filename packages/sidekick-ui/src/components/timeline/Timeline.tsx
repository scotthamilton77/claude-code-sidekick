import { useCallback } from 'react'
import type { TimelineEvent } from '../../types'
import { EVENT_TO_FILTER } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'
import { FocusFilterBar } from './FocusFilterBar'
import { TimelineEventItem } from './TimelineEvent'
import { CompactionMarker } from './CompactionMarker'

interface TimelineProps {
  events: TimelineEvent[]
  hoveredEventId: string | null
  onHoverEvent: (id: string | null) => void
}

export function Timeline({ events, hoveredEventId, onHoverEvent }: TimelineProps) {
  const { state, dispatch } = useNavigation()

  const isEventDimmed = useCallback(
    (event: TimelineEvent): boolean => {
      if (state.activeFilters.size === 0) return false
      const filter = EVENT_TO_FILTER[event.type]
      if (!filter) return false // Always-visible types
      return !state.activeFilters.has(filter)
    },
    [state.activeFilters]
  )

  return (
    <div className="h-full flex flex-col">
      <FocusFilterBar />
      <div className="flex-1 overflow-y-auto py-1">
        {events.map(event => {
          if (event.type === 'compaction') {
            return <CompactionMarker key={event.id} event={event} />
          }
          return (
            <TimelineEventItem
              key={event.id}
              event={event}
              isSelected={state.selectedEventId === event.id}
              isHovered={hoveredEventId === event.id}
              isDimmed={isEventDimmed(event)}
              onClick={() => dispatch({ type: 'SELECT_EVENT', eventId: event.id })}
              onMouseEnter={() => onHoverEvent(event.id)}
              onMouseLeave={() => onHoverEvent(null)}
            />
          )
        })}
      </div>
    </div>
  )
}
