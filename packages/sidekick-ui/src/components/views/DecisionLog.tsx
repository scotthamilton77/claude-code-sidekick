import React from 'react'
import type { UIEvent, DecisionLogFilter, DecisionLogFilterCategory } from '../../types'
import { groupByTraceId } from '../../lib/trace-correlator'
import { DecisionCard } from '../events'

interface DecisionLogProps {
  events: UIEvent[]
  filter: DecisionLogFilter
  onFilterChange: (filter: DecisionLogFilter) => void
  onEventSelect: (eventId: number) => void
  onTraceSelect?: (traceId: string) => void
}

/**
 * DecisionLog View Component
 *
 * Displays a filtered list of decision events with trace grouping.
 * Events with the same traceId are visually grouped with connecting lines
 * to show causal relationships.
 *
 * Features:
 * - Filter tabs for decision categories (all, summary, reminder, context_prune, handler)
 * - Trace grouping with visual connectors
 * - Click events to navigate to timeline position
 * - Uses specialized event cards for rendering
 */
const DecisionLog: React.FC<DecisionLogProps> = ({ events, filter, onFilterChange, onEventSelect, onTraceSelect }) => {
  // Filter events to only show decisions matching the current filter
  // Decision events are identified by having decisionData, not by type
  const decisionEvents = events.filter((event) => {
    if (!event.decisionData) return false
    if (filter.category === 'all') return true
    return event.decisionData.category === filter.category
  })

  // Group by traceId for visual organization
  const traceGroups = groupByTraceId(decisionEvents)
  const groupedEventIds = new Set<number>()
  traceGroups.forEach((group) => {
    group.events.forEach((event) => groupedEventIds.add(event.id))
  })

  // Events without traceId (ungrouped)
  const ungroupedEvents = decisionEvents.filter((event) => !event.traceId)

  // Sort trace groups by first event time
  const sortedGroups = Array.from(traceGroups.values()).sort((a, b) => a.events[0].id - b.events[0].id)

  const handleFilterChange = (category: DecisionLogFilterCategory) => {
    onFilterChange({ ...filter, category })
  }

  const handleTraceClick = (traceId: string) => {
    if (onTraceSelect) {
      onTraceSelect(traceId)
    }
  }

  return (
    <div className="flex-1 flex flex-col min-w-0 bg-slate-50">
      {/* Header with Filter Tabs */}
      <div className="bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => handleFilterChange('all')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              filter.category === 'all'
                ? 'bg-white shadow-sm text-slate-800 font-medium'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            All
          </button>
          <button
            onClick={() => handleFilterChange('summary')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              filter.category === 'summary'
                ? 'bg-white shadow-sm text-slate-800 font-medium'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Summary
          </button>
          <button
            onClick={() => handleFilterChange('reminder')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              filter.category === 'reminder'
                ? 'bg-white shadow-sm text-slate-800 font-medium'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Reminder
          </button>
          <button
            onClick={() => handleFilterChange('context_prune')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              filter.category === 'context_prune'
                ? 'bg-white shadow-sm text-slate-800 font-medium'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Context Prune
          </button>
          <button
            onClick={() => handleFilterChange('handler')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              filter.category === 'handler'
                ? 'bg-white shadow-sm text-slate-800 font-medium'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Handler
          </button>
        </div>

        {/* Event count */}
        <div className="text-sm text-slate-500">
          {decisionEvents.length} {decisionEvents.length === 1 ? 'event' : 'events'}
        </div>
      </div>

      {/* Decision Events List */}
      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
        {/* Trace Groups */}
        {sortedGroups.map((group) => (
          <div key={group.traceId} className="space-y-2">
            {/* Trace header - clickable if onTraceSelect provided */}
            <div
              className={`text-xs text-slate-500 flex items-center gap-2 ${
                onTraceSelect ? 'cursor-pointer hover:text-slate-700' : ''
              }`}
              onClick={() => handleTraceClick(group.traceId)}
            >
              <div className="h-px flex-1 bg-slate-300" />
              <span className="font-mono">
                Trace: {group.traceId.slice(0, 8)}
                {group.hookName && ` (${group.hookName})`}
              </span>
              <div className="h-px flex-1 bg-slate-300" />
            </div>

            {/* Events in trace group with connecting line */}
            <div className="relative pl-4">
              {/* Vertical connecting line */}
              {group.events.length > 1 && <div className="absolute left-[15px] top-4 bottom-4 w-px bg-slate-300" />}

              {/* Events */}
              <div className="space-y-3">
                {group.events.map((event) => (
                  <div
                    key={event.id}
                    className="cursor-pointer hover:opacity-80 transition-opacity"
                    onClick={() => onEventSelect(event.id)}
                  >
                    <DecisionCard event={event} isFuture={false} onTraceClick={handleTraceClick} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        ))}

        {/* Ungrouped Events */}
        {ungroupedEvents.length > 0 && (
          <div className="space-y-3">
            {sortedGroups.length > 0 && (
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <div className="h-px flex-1 bg-slate-200" />
                <span>Ungrouped</span>
                <div className="h-px flex-1 bg-slate-200" />
              </div>
            )}
            {ungroupedEvents.map((event) => (
              <div
                key={event.id}
                className="cursor-pointer hover:opacity-80 transition-opacity"
                onClick={() => onEventSelect(event.id)}
              >
                <DecisionCard event={event} isFuture={false} />
              </div>
            ))}
          </div>
        )}

        {/* Empty state */}
        {decisionEvents.length === 0 && (
          <div className="flex items-center justify-center h-full text-slate-400">
            <div className="text-center">
              <p className="text-sm">No decision events found</p>
              {filter.category !== 'all' && <p className="text-xs mt-1">Try selecting a different filter</p>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

export default DecisionLog
