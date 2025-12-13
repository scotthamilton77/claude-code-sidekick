import React from 'react'
import type { UIEvent } from '../../types'
import Icon from '../Icon'
import HandlerExecutedCard from './HandlerExecutedCard'
import ReminderCard from './ReminderCard'
import SummaryUpdatedCard from './SummaryUpdatedCard'

interface DecisionCardProps {
  event: UIEvent
  isFuture: boolean
  onTraceClick?: (traceId: string) => void
}

/**
 * Dispatcher component that renders the appropriate card based on decision category.
 * Routes to specialized components for summary, reminder, handler, and context_prune events.
 */
const DecisionCard: React.FC<DecisionCardProps> = ({ event, isFuture, onTraceClick }) => {
  const { decisionData } = event

  // Route to handler card
  if (decisionData?.category === 'handler') {
    return <HandlerExecutedCard event={event} isFuture={isFuture} onTraceClick={onTraceClick} />
  }

  // Route to summary card
  if (decisionData?.category === 'summary') {
    return <SummaryUpdatedCard event={event} isFuture={isFuture} onTraceClick={onTraceClick} />
  }

  // Route to reminder card
  if (decisionData?.category === 'reminder') {
    return <ReminderCard event={event} isFuture={isFuture} onTraceClick={onTraceClick} />
  }

  // Context prune card - simple amber themed display
  if (decisionData?.category === 'context_prune') {
    return (
      <div className="flex gap-3">
        <div
          className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
            isFuture ? 'bg-slate-200' : 'bg-amber-100'
          }`}
        >
          <Icon name="scissors" className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-amber-600'}`} />
        </div>
        <div
          className={`flex-1 rounded-lg px-4 py-2 ${
            isFuture ? 'bg-slate-100 border border-slate-200' : 'bg-amber-50 border border-amber-200'
          }`}
        >
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <span className={`text-sm font-medium ${isFuture ? 'text-slate-500' : 'text-amber-700'}`}>
              Context Pruned
            </span>
            <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-amber-600'}`}>{event.time}</span>
          </div>
          {event.content && (
            <p className={`text-sm ${isFuture ? 'text-slate-500' : 'text-amber-800'}`}>{event.content}</p>
          )}
        </div>
      </div>
    )
  }

  // Fallback: render generic decision card
  return <GenericDecisionCard event={event} isFuture={isFuture} />
}

/**
 * Generic decision card for unknown/unhandled decision types.
 * Uses the existing amber theme from Transcript.tsx.
 */
const GenericDecisionCard: React.FC<{ event: UIEvent; isFuture: boolean; label?: string }> = ({
  event,
  isFuture,
  label,
}) => {
  return (
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
            {label ? `Decision: ${label}` : `Decision: ${event.label}`}
          </span>
          <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-amber-600'}`}>{event.time}</span>
        </div>
        {event.content && (
          <p className={`text-sm ${isFuture ? 'text-slate-500' : 'text-amber-800'}`}>{event.content}</p>
        )}
      </div>
    </div>
  )
}

export default DecisionCard
