import React, { useMemo } from 'react'
import type { UIEvent } from '../types'
import { CompactionDot, type CompactionEntry } from './CompactionMarker'

interface TimelineProps {
  events: UIEvent[]
  currentEventId: number
  filteredEvents: UIEvent[]
  onEventSelect: (id: number) => void
  getEventColor: (type: string) => string
  /** Compaction history entries to display on timeline */
  compactionEntries?: CompactionEntry[]
  /** Currently selected compaction entry */
  selectedCompaction?: CompactionEntry | null
  /** Handler for compaction marker click */
  onCompactionSelect?: (entry: CompactionEntry) => void
}

/**
 * Find the event index closest to a given timestamp.
 */
function findEventIndexAtTimestamp(events: UIEvent[], timestamp: number): number {
  if (events.length === 0) return 0

  // Binary search for closest event
  let low = 0
  let high = events.length - 1

  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    const eventTime = new Date(events[mid].time).getTime()

    if (eventTime < timestamp) {
      low = mid + 1
    } else {
      high = mid
    }
  }

  return low
}

const Timeline: React.FC<TimelineProps> = ({
  events,
  currentEventId,
  filteredEvents,
  onEventSelect,
  getEventColor,
  compactionEntries = [],
  selectedCompaction,
  onCompactionSelect,
}) => {
  // Map compaction entries to their approximate event indices
  const compactionPositions = useMemo(() => {
    return compactionEntries.map((entry) => ({
      entry,
      eventIndex: findEventIndexAtTimestamp(events, entry.compactedAt),
    }))
  }, [events, compactionEntries])

  // Get current event's approximate timestamp position
  const currentEventTime = events[currentEventId] ? new Date(events[currentEventId].time).getTime() : 0

  return (
    <div className="w-28 bg-white border-r border-slate-200 flex flex-col">
      <div className="flex-1 relative py-4 px-2">
        {/* Slider Track Background */}
        <div className="absolute left-4 top-4 bottom-4 w-1 bg-slate-200 rounded-full" />

        {/* Slider Progress Fill */}
        <div
          className="absolute left-4 top-4 w-1 bg-indigo-400 rounded-full transition-all"
          style={{ height: `${(currentEventId / (events.length - 1)) * (100 - 8)}%` }}
        />

        {/* Event Markers on Rail */}
        <div className="absolute left-4 top-4 bottom-4 flex flex-col justify-between">
          {events.map((event) => {
            const isActive = event.id === currentEventId
            const isFuture = event.id > currentEventId
            const isFiltered = !filteredEvents.find((e) => e.id === event.id)

            return (
              <button
                key={event.id}
                onClick={() => onEventSelect(event.id)}
                disabled={isFiltered}
                className={`relative flex items-center transition-all ${
                  isFiltered ? 'opacity-20' : ''
                } ${isFuture ? 'opacity-40' : ''}`}
                title={`${event.time} - ${event.label}`}
              >
                {/* Small colored dot */}
                <div
                  className={`w-3 h-3 rounded-full -ml-1 transition-all ${
                    isActive
                      ? `${getEventColor(event.type)} ring-2 ring-offset-1 ring-indigo-400 scale-125`
                      : `${getEventColor(event.type)} hover:scale-125`
                  }`}
                />
                {/* Time label to the right */}
                <span
                  className={`ml-3 text-xs font-mono whitespace-nowrap ${
                    isActive ? 'text-indigo-600 font-medium' : 'text-slate-400'
                  }`}
                >
                  {event.time.slice(-5)}
                </span>
              </button>
            )
          })}
        </div>

        {/* Compaction Markers - positioned absolutely based on percentage */}
        {compactionPositions.map(({ entry, eventIndex }) => {
          const percentage = events.length > 1 ? (eventIndex / (events.length - 1)) * 100 : 0
          const isSelected = selectedCompaction?.compactedAt === entry.compactedAt
          const isFuture = entry.compactedAt > currentEventTime

          return (
            <div
              key={`compaction-${entry.compactedAt}`}
              className="absolute left-4"
              style={{ top: `calc(1rem + ${percentage}% * (100% - 2rem) / 100)` }}
            >
              <CompactionDot
                entry={entry}
                isSelected={isSelected}
                isFuture={isFuture}
                onClick={() => onCompactionSelect?.(entry)}
              />
            </div>
          )
        })}

        {/* Invisible Slider Overlay */}
        <input
          type="range"
          min="0"
          max={events.length - 1}
          value={currentEventId}
          onChange={(e) => onEventSelect(Number(e.target.value))}
          className="timeline-slider absolute left-2 top-4 bottom-4 z-10 opacity-0 cursor-pointer"
          style={{ height: 'calc(100% - 32px)' }}
        />
      </div>

      {/* Progress Text */}
      <div className="p-2 border-t border-slate-100 text-center">
        <span className="text-xs text-slate-500">
          {currentEventId + 1} / {events.length}
        </span>
      </div>
    </div>
  )
}

export default Timeline
