import React from 'react'
import type { UIEvent } from '../types'
import Icon from './Icon'

interface TranscriptProps {
  filteredEvents: UIEvent[]
  currentEventId: number
  searchQuery: string
  onSearchChange: (query: string) => void
  filterType: string
  onFilterChange: (type: string) => void
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

const Transcript: React.FC<TranscriptProps> = ({
  filteredEvents,
  currentEventId,
  searchQuery,
  onSearchChange,
  filterType,
  onFilterChange,
}) => {
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
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
        {filteredEvents.map((event) => {
          const isFuture = event.id > currentEventId
          const isActive = event.id === currentEventId

          return (
            <div
              key={event.id}
              className={`transition-all duration-200 ${
                isFuture ? 'opacity-25' : 'opacity-100'
              } ${isActive && !isFuture ? 'ring-2 ring-indigo-200 rounded-lg' : ''}`}
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
                      <p className={`text-sm whitespace-pre-wrap ${isFuture ? 'text-slate-500' : 'text-slate-700'}`}>
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
                      <p className={`text-xs mt-1 ${isFuture ? 'text-slate-400' : 'text-cyan-600'}`}>{event.content}</p>
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

              {/* State Change */}
              {event.type === 'state' && (
                <div className="flex gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isFuture ? 'bg-slate-200' : 'bg-purple-100'
                    }`}
                  >
                    <Icon name="cpu" className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-purple-600'}`} />
                  </div>
                  <div
                    className={`flex-1 rounded-lg px-4 py-2 ${
                      isFuture ? 'bg-slate-100 border border-slate-200' : 'bg-purple-50 border border-purple-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                      <span className={`text-sm font-medium ${isFuture ? 'text-slate-500' : 'text-purple-700'}`}>
                        State: {event.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <EventBadges event={event} isFuture={isFuture} />
                        <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-purple-600'}`}>
                          {event.time}
                        </span>
                      </div>
                    </div>
                    <p className={`text-sm font-mono ${isFuture ? 'text-slate-500' : 'text-purple-800'}`}>
                      {event.content}
                    </p>
                  </div>
                </div>
              )}

              {/* Reminder */}
              {event.type === 'reminder' && (
                <div className="flex gap-3">
                  <div
                    className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
                      isFuture ? 'bg-slate-200' : 'bg-rose-100'
                    }`}
                  >
                    <Icon
                      name="alert-triangle"
                      className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-rose-600'}`}
                    />
                  </div>
                  <div
                    className={`flex-1 rounded-lg px-4 py-2 ${
                      isFuture ? 'bg-slate-100 border border-slate-200' : 'bg-rose-50 border border-rose-200'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
                      <span className={`text-sm font-medium ${isFuture ? 'text-slate-500' : 'text-rose-700'}`}>
                        Reminder: {event.label}
                      </span>
                      <div className="flex items-center gap-2">
                        <EventBadges event={event} isFuture={isFuture} />
                        <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-rose-600'}`}>{event.time}</span>
                      </div>
                    </div>
                    <p className={`text-sm ${isFuture ? 'text-slate-500' : 'text-rose-800'}`}>{event.content}</p>
                  </div>
                </div>
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
          )
        })}
      </div>
    </div>
  )
}

export default Transcript
