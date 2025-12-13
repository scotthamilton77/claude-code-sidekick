import React from 'react'
import type { UIEvent } from '../../types'
import Icon from '../Icon'

interface HandlerExecutedCardProps {
  event: UIEvent
  isFuture: boolean
  onTraceClick?: (traceId: string) => void
}

/**
 * Compact card for handler execution events.
 * Uses indigo/slate theme to distinguish from other decision types.
 */
const HandlerExecutedCard: React.FC<HandlerExecutedCardProps> = ({ event, isFuture, onTraceClick }) => {
  const { decisionData, traceId } = event
  const { handlerId, success, durationMs, error } = decisionData || {}

  const isSuccess = success !== false // Default to success if not specified

  return (
    <div className="flex gap-3 ml-11">
      <div
        className={`flex-1 rounded-lg px-3 py-2 ${
          isFuture
            ? 'bg-slate-100 border border-slate-200'
            : isSuccess
              ? 'bg-indigo-50 border border-indigo-200'
              : 'bg-red-50 border border-red-200'
        }`}
      >
        <div className="flex items-center gap-2 flex-wrap">
          {/* Success/Failure Icon */}
          <Icon
            name={isSuccess ? 'check-circle' : 'x-circle'}
            className={`w-4 h-4 ${isFuture ? 'text-slate-400' : isSuccess ? 'text-indigo-600' : 'text-red-600'}`}
          />

          {/* Handler ID */}
          <span className={`text-sm font-medium ${isFuture ? 'text-slate-500' : 'text-indigo-700'}`}>
            {handlerId || 'Unknown Handler'}
          </span>

          {/* Duration */}
          {durationMs !== undefined && (
            <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-indigo-600'}`}>{durationMs}ms</span>
          )}

          {/* TraceId Link */}
          {traceId && onTraceClick && (
            <button
              onClick={() => onTraceClick(traceId)}
              className={`text-xs underline ${isFuture ? 'text-slate-400' : 'text-indigo-600 hover:text-indigo-800'}`}
              disabled={isFuture}
            >
              trace:{traceId.slice(0, 8)}
            </button>
          )}

          {/* Time */}
          <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-indigo-600'} ml-auto`}>{event.time}</span>
        </div>

        {/* Error Message */}
        {error && !isFuture && <p className="text-xs text-red-600 mt-1 font-mono">Error: {error}</p>}
      </div>
    </div>
  )
}

export default HandlerExecutedCard
