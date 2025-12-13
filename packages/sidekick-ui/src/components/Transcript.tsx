import React, { useRef, useImperativeHandle, forwardRef } from 'react'
import type { UIEvent } from '../types'
import Icon from './Icon'
import { ReminderCard, SummaryUpdatedCard } from './events'

interface TranscriptProps {
  filteredEvents: UIEvent[]
  currentEventId: number
  searchQuery: string
  onSearchChange: (query: string) => void
  filterType: string
  onFilterChange: (type: string) => void
  onTraceClick?: (traceId: string) => void
  onEventSelect?: (eventId: number) => void
}

export interface TranscriptRef {
  scrollToBottom: () => void
}

/**
 * Badge showing event kind (hook/transcript/internal).
 * Derived from the rawEvent or inferred from source/type.
 */
const EventKindBadge: React.FC<{ event: UIEvent; isFuture: boolean }> = ({ event, isFuture }) => {
  // Determine event kind from rawEvent or infer
  let kind: 'hook' | 'transcript' | 'internal' = 'internal'

  if (event.rawEvent) {
    kind = event.rawEvent.kind === 'hook' ? 'hook' : 'transcript'
  } else if (event.source === 'cli') {
    // CLI events without rawEvent are typically hook-related
    kind = 'hook'
  }

  const styles = {
    hook: {
      bg: isFuture ? 'bg-slate-100' : 'bg-blue-50',
      text: isFuture ? 'text-slate-400' : 'text-blue-600',
      border: isFuture ? 'border-slate-200' : 'border-blue-200',
    },
    transcript: {
      bg: isFuture ? 'bg-slate-100' : 'bg-emerald-50',
      text: isFuture ? 'text-slate-400' : 'text-emerald-600',
      border: isFuture ? 'border-slate-200' : 'border-emerald-200',
    },
    internal: {
      bg: isFuture ? 'bg-slate-100' : 'bg-violet-50',
      text: isFuture ? 'text-slate-400' : 'text-violet-600',
      border: isFuture ? 'border-slate-200' : 'border-violet-200',
    },
  }

  const style = styles[kind]
  const label = kind.charAt(0).toUpperCase() + kind.slice(1)

  return (
    <span
      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded border ${style.bg} ${style.text} ${style.border}`}
    >
      {label}
    </span>
  )
}

/**
 * Badge showing event source (cli/supervisor).
 */
const SourceBadge: React.FC<{ source?: 'cli' | 'supervisor'; isFuture: boolean }> = ({ source, isFuture }) => {
  if (!source) return null

  const styles = {
    cli: {
      bg: isFuture ? 'bg-slate-100' : 'bg-orange-50',
      text: isFuture ? 'text-slate-400' : 'text-orange-600',
      border: isFuture ? 'border-slate-200' : 'border-orange-200',
      icon: 'terminal' as const,
    },
    supervisor: {
      bg: isFuture ? 'bg-slate-100' : 'bg-indigo-50',
      text: isFuture ? 'text-slate-400' : 'text-indigo-600',
      border: isFuture ? 'border-slate-200' : 'border-indigo-200',
      icon: 'server' as const,
    },
  }

  const style = styles[source]
  const label = source === 'cli' ? 'CLI' : 'Supervisor'

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border ${style.bg} ${style.text} ${style.border}`}
    >
      <Icon name={style.icon} className="w-2.5 h-2.5" />
      {label}
    </span>
  )
}

/**
 * Combined badge group for event metadata.
 */
const EventBadges: React.FC<{ event: UIEvent; isFuture: boolean }> = ({ event, isFuture }) => {
  return (
    <div className="flex items-center gap-1">
      <EventKindBadge event={event} isFuture={isFuture} />
      <SourceBadge source={event.source} isFuture={isFuture} />
    </div>
  )
}

const Transcript = forwardRef<TranscriptRef, TranscriptProps>(
  (
    {
      filteredEvents,
      currentEventId,
      searchQuery,
      onSearchChange,
      filterType,
      onFilterChange,
      onTraceClick,
      onEventSelect,
    },
    ref
  ) => {
    const scrollContainerRef = useRef<HTMLDivElement>(null)

    // Expose scrollToBottom method to parent
    useImperativeHandle(ref, () => ({
      scrollToBottom: () => {
        if (scrollContainerRef.current) {
          scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight
        }
      },
    }))

    return (
      <div className="flex-1 flex flex-col min-w-0 bg-slate-50">
        {/* Transcript Header with Filters and Search */}
        <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-4">
          {/* Filter Tabs */}
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => onFilterChange('all')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                filterType === 'all'
                  ? 'bg-white shadow-sm text-slate-800 font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              All Events
            </button>
            <button
              onClick={() => onFilterChange('conversation')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                filterType === 'conversation'
                  ? 'bg-white shadow-sm text-slate-800 font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Conversation
            </button>
            <button
              onClick={() => onFilterChange('system')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                filterType === 'system'
                  ? 'bg-white shadow-sm text-slate-800 font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              System
            </button>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-sm">
            <span className="absolute left-3 top-1/2 -translate-y-1/2">
              <Icon name="search" className="w-4 h-4 text-slate-400" />
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Search transcript..."
              className="w-full pl-9 pr-4 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>

        {/* Transcript Messages */}
        <div ref={scrollContainerRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
          {filteredEvents.map((event, index) => {
            const isFuture = event.id > currentEventId
            const isActive = event.id === currentEventId
            // Check if this is the last past event (time-cut position)
            const isTimeCutPosition =
              !isFuture && (index === filteredEvents.length - 1 || filteredEvents[index + 1]?.id > currentEventId)

            return (
              <React.Fragment key={event.id}>
                <div
                  onClick={() => onEventSelect?.(event.id)}
                  className={`transition-all duration-200 ${
                    isFuture ? 'opacity-25' : 'opacity-100'
                  } ${isActive && !isFuture ? 'ring-2 ring-indigo-200 rounded-lg' : ''} ${
                    onEventSelect ? 'cursor-pointer hover:bg-white/50 rounded-lg' : ''
                  }`}
                >
                  {/* User Message */}
                  {event.type === 'user' && (
                    <div className="flex gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isFuture ? 'bg-slate-200' : 'bg-blue-100'
                        }`}
                      >
                        <Icon name="user" className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-blue-600'}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                          <span className={`text-sm font-medium ${isFuture ? 'text-slate-400' : 'text-blue-600'}`}>
                            You
                          </span>
                          <span className="text-xs text-slate-400">{event.time}</span>
                          <EventBadges event={event} isFuture={isFuture} />
                        </div>
                        <div
                          className={`rounded-lg rounded-tl-sm px-4 py-3 shadow-sm ${
                            isFuture ? 'bg-slate-100 border border-slate-200' : 'bg-white border border-slate-200'
                          }`}
                        >
                          <p className={`text-sm ${isFuture ? 'text-slate-500' : 'text-slate-700'}`}>{event.content}</p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Assistant Message */}
                  {event.type === 'assistant' && (
                    <div className="flex gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isFuture ? 'bg-slate-200' : 'bg-emerald-100'
                        }`}
                      >
                        <Icon name="bot" className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-emerald-600'}`} />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-baseline gap-2 mb-1 flex-wrap">
                          <span className={`text-sm font-medium ${isFuture ? 'text-slate-400' : 'text-emerald-600'}`}>
                            Claude
                          </span>
                          <span className="text-xs text-slate-400">{event.time}</span>
                          <EventBadges event={event} isFuture={isFuture} />
                          {event.branch && event.branch !== 'main' && !isFuture && (
                            <span className="text-xs text-slate-400 flex items-center gap-1">
                              <Icon name="git-branch" className="w-3 h-3" />
                              switched to {event.branch}
                            </span>
                          )}
                        </div>
                        <div
                          className={`rounded-lg rounded-tl-sm px-4 py-3 shadow-sm ${
                            isFuture ? 'bg-slate-100 border border-slate-200' : 'bg-white border border-slate-200'
                          }`}
                        >
                          <p
                            className={`text-sm whitespace-pre-wrap ${isFuture ? 'text-slate-500' : 'text-slate-700'}`}
                          >
                            {event.content}
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Tool Use */}
                  {event.type === 'tool' && (
                    <div className="flex gap-3 ml-11">
                      <div
                        className={`flex-1 rounded-lg px-4 py-2 ${
                          isFuture ? 'bg-slate-100 border border-slate-200' : 'bg-cyan-50 border border-cyan-200'
                        }`}
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Icon name="wrench" className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-cyan-600'}`} />
                          <span className={`text-sm font-medium ${isFuture ? 'text-slate-500' : 'text-cyan-700'}`}>
                            {event.label}
                          </span>
                          <EventBadges event={event} isFuture={isFuture} />
                          <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-cyan-600'} ml-auto`}>
                            {event.time}
                          </span>
                        </div>
                        {event.content && (
                          <p className={`text-xs mt-1 ${isFuture ? 'text-slate-400' : 'text-cyan-600'}`}>
                            {event.content}
                          </p>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Decision */}
                  {event.type === 'decision' && (
                    <div className="flex gap-3">
                      <div
                        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                          isFuture ? 'bg-slate-200' : 'bg-amber-100'
                        }`}
                      >
                        <Icon name="zap" className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-amber-600'}`} />
                      </div>
                      <div
                        className={`flex-1 rounded-lg px-4 py-2 ${
                          isFuture ? 'bg-slate-100 border border-slate-200' : 'bg-amber-50 border border-amber-200'
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                          <span className={`text-sm font-medium ${isFuture ? 'text-slate-500' : 'text-amber-700'}`}>
                            Decision: {event.label}
                          </span>
                          <div className="flex items-center gap-2">
                            <EventBadges event={event} isFuture={isFuture} />
                            <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-amber-600'}`}>
                              {event.time}
                            </span>
                          </div>
                        </div>
                        <p className={`text-sm ${isFuture ? 'text-slate-500' : 'text-amber-800'}`}>{event.content}</p>
                      </div>
                    </div>
                  )}

                  {/* State Change - use SummaryUpdatedCard for rich diff rendering */}
                  {event.type === 'state' && (
                    <SummaryUpdatedCard event={event} isFuture={isFuture} onTraceClick={onTraceClick} />
                  )}

                  {/* Reminder - use ReminderCard for rich rendering */}
                  {event.type === 'reminder' && (
                    <ReminderCard event={event} isFuture={isFuture} onTraceClick={onTraceClick} />
                  )}

                  {/* Session Start */}
                  {event.type === 'session' && (
                    <div
                      className={`flex items-center gap-2 text-sm py-2 ${isFuture ? 'text-slate-300' : 'text-slate-500'}`}
                    >
                      <div className="flex-1 h-px bg-slate-200" />
                      <Icon name="play" className="w-3 h-3" />
                      <span>Session started</span>
                      <span className="text-xs text-slate-400">{event.time}</span>
                      <EventBadges event={event} isFuture={isFuture} />
                      <div className="flex-1 h-px bg-slate-200" />
                    </div>
                  )}
                </div>

                {/* Time-Cut Indicator - shown after the last past event */}
                {isTimeCutPosition && filteredEvents.some((e) => e.id > currentEventId) && (
                  <div className="relative py-6">
                    {/* Gradient fade above the line */}
                    <div className="absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-transparent to-indigo-50/30 pointer-events-none" />

                    {/* Main indicator line */}
                    <div className="relative flex items-center gap-3 group">
                      {/* Playhead marker */}
                      <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-500 text-white rounded-full shadow-lg shadow-indigo-200 z-10">
                        <Icon name="play" className="w-3 h-3 fill-current" />
                        <span className="text-xs font-medium whitespace-nowrap">Current Time</span>
                      </div>

                      {/* Extending line */}
                      <div className="flex-1 h-0.5 bg-gradient-to-r from-indigo-500 to-indigo-200" />
                    </div>

                    {/* Gradient fade below the line */}
                    <div className="absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-transparent to-indigo-50/30 pointer-events-none" />
                  </div>
                )}
              </React.Fragment>
            )
          })}
        </div>
      </div>
    )
  }
)

Transcript.displayName = 'Transcript'

export default Transcript
