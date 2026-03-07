import React from 'react'
import type { UIEvent } from '../../types'
import Icon from '../Icon'
import ExpandablePayload from '../common/ExpandablePayload'

interface SummaryUpdatedCardProps {
  event: UIEvent
  isFuture: boolean
  onTraceClick?: (traceId: string) => void
}

/**
 * Displays session summary update events with rich diff visualization.
 *
 * Shows:
 * - Title changes (old → new with color-coded diff)
 * - Intent changes (old → new)
 * - Confidence scores as percentage badges
 * - Update reason with contextual styling
 * - Pivot detection indicator
 * - Countdown reset value
 * - Full payload expansion
 */
const SummaryUpdatedCard: React.FC<SummaryUpdatedCardProps> = ({ event, isFuture, onTraceClick }) => {
  const { summaryData } = event

  if (!summaryData) {
    return null
  }

  const {
    action,
    reason,
    sessionTitle,
    titleConfidence,
    latestIntent,
    intentConfidence,
    oldTitle,
    oldIntent,
    pivotDetected,
    countdownResetTo,
  } = summaryData

  // Determine if we have changes to show
  const hasTitleChange = oldTitle && oldTitle !== sessionTitle
  const hasIntentChange = oldIntent && oldIntent !== latestIntent

  // Reason badge styling
  const reasonStyles = {
    user_prompt_forced: {
      bg: isFuture ? 'bg-slate-100' : 'bg-blue-50',
      text: isFuture ? 'text-slate-400' : 'text-blue-600',
      border: isFuture ? 'border-slate-200' : 'border-blue-200',
      label: 'User Prompt',
    },
    countdown_reached: {
      bg: isFuture ? 'bg-slate-100' : 'bg-emerald-50',
      text: isFuture ? 'text-slate-400' : 'text-emerald-600',
      border: isFuture ? 'border-slate-200' : 'border-emerald-200',
      label: 'Countdown',
    },
    compaction_reset: {
      bg: isFuture ? 'bg-slate-100' : 'bg-amber-50',
      text: isFuture ? 'text-slate-400' : 'text-amber-600',
      border: isFuture ? 'border-slate-200' : 'border-amber-200',
      label: 'Compaction Reset',
    },
    countdown_active: {
      bg: isFuture ? 'bg-slate-100' : 'bg-slate-50',
      text: isFuture ? 'text-slate-400' : 'text-slate-600',
      border: isFuture ? 'border-slate-200' : 'border-slate-300',
      label: 'Countdown Active',
    },
  }

  const defaultStyle = {
    bg: isFuture ? 'bg-slate-100' : 'bg-slate-50',
    text: isFuture ? 'text-slate-400' : 'text-slate-600',
    border: isFuture ? 'border-slate-200' : 'border-slate-300',
    label: reason ?? 'Unknown',
  }
  const reasonStyle = reasonStyles[reason] ?? defaultStyle

  // Format confidence as percentage
  const formatConfidence = (confidence?: number): string => {
    if (confidence === undefined) return 'N/A'
    return `${Math.round(confidence * 100)}%`
  }

  return (
    <div className="flex gap-3">
      {/* Icon */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isFuture ? 'bg-slate-200' : 'bg-purple-100'
        }`}
      >
        <Icon name="cpu" className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-purple-600'}`} />
      </div>

      {/* Content */}
      <div className="flex-1 space-y-2">
        {/* Header */}
        <div
          className={`rounded-lg px-4 py-2 ${
            isFuture ? 'bg-slate-100 border border-slate-200' : 'bg-purple-50 border border-purple-200'
          }`}
        >
          <div className="flex items-center justify-between mb-2 flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <span className={`text-sm font-medium ${isFuture ? 'text-slate-500' : 'text-purple-700'}`}>
                Summary {action === 'updated' ? 'Updated' : 'Skipped'}
              </span>
              {pivotDetected && (
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border ${
                    isFuture
                      ? 'bg-slate-100 text-slate-400 border-slate-200'
                      : 'bg-amber-50 text-amber-700 border-amber-200'
                  }`}
                  title="Significant pivot detected"
                >
                  <Icon name="alert-triangle" className="w-3 h-3" />
                  Pivot
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              {/* Reason badge */}
              <span
                className={`inline-flex items-center px-2 py-0.5 text-xs font-medium rounded border ${reasonStyle.bg} ${reasonStyle.text} ${reasonStyle.border}`}
              >
                {reasonStyle.label}
              </span>
              {/* TraceId link */}
              {event.traceId && onTraceClick && (
                <button
                  onClick={() => onTraceClick(event.traceId!)}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 text-xs font-medium rounded border transition-colors ${
                    isFuture
                      ? 'bg-slate-100 text-slate-400 border-slate-200'
                      : 'bg-indigo-50 text-indigo-600 border-indigo-200 hover:bg-indigo-100'
                  }`}
                  title="View trace flow"
                >
                  <Icon name="git-branch" className="w-3 h-3" />
                  {event.traceId.slice(0, 8)}
                </button>
              )}
              <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-purple-600'}`}>{event.time}</span>
            </div>
          </div>

          {/* Title Change */}
          {hasTitleChange && (
            <div className="mb-2">
              <div className="text-xs font-medium text-slate-500 mb-1">Title Changed:</div>
              <div className="space-y-1 text-sm">
                <div className={`flex items-start gap-2 ${isFuture ? 'text-slate-400' : 'text-red-600'}`}>
                  <Icon name="minus" className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="line-through">{oldTitle}</span>
                </div>
                <div className={`flex items-start gap-2 ${isFuture ? 'text-slate-400' : 'text-emerald-600'}`}>
                  <Icon name="plus" className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="font-medium">{sessionTitle}</span>
                  {titleConfidence !== undefined && (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        isFuture ? 'bg-slate-200 text-slate-400' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {formatConfidence(titleConfidence)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Intent Change */}
          {hasIntentChange && (
            <div className="mb-2">
              <div className="text-xs font-medium text-slate-500 mb-1">Intent Changed:</div>
              <div className="space-y-1 text-sm">
                <div className={`flex items-start gap-2 ${isFuture ? 'text-slate-400' : 'text-red-600'}`}>
                  <Icon name="minus" className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="line-through italic">{oldIntent}</span>
                </div>
                <div className={`flex items-start gap-2 ${isFuture ? 'text-slate-400' : 'text-emerald-600'}`}>
                  <Icon name="plus" className="w-3 h-3 mt-0.5 flex-shrink-0" />
                  <span className="font-medium italic">{latestIntent}</span>
                  {intentConfidence !== undefined && (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        isFuture ? 'bg-slate-200 text-slate-400' : 'bg-emerald-100 text-emerald-700'
                      }`}
                    >
                      {formatConfidence(intentConfidence)}
                    </span>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* No changes - show current values */}
          {!hasTitleChange && !hasIntentChange && action === 'updated' && (
            <div className="space-y-2 text-sm">
              {sessionTitle && (
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-slate-500 min-w-[4rem]">Title:</span>
                  <span className={isFuture ? 'text-slate-500' : 'text-purple-800'}>{sessionTitle}</span>
                  {titleConfidence !== undefined && (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        isFuture ? 'bg-slate-200 text-slate-400' : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {formatConfidence(titleConfidence)}
                    </span>
                  )}
                </div>
              )}
              {latestIntent && (
                <div className="flex items-start gap-2">
                  <span className="text-xs font-medium text-slate-500 min-w-[4rem]">Intent:</span>
                  <span className={`italic ${isFuture ? 'text-slate-500' : 'text-purple-800'}`}>{latestIntent}</span>
                  {intentConfidence !== undefined && (
                    <span
                      className={`inline-flex items-center px-1.5 py-0.5 text-[10px] font-medium rounded ${
                        isFuture ? 'bg-slate-200 text-slate-400' : 'bg-purple-100 text-purple-700'
                      }`}
                    >
                      {formatConfidence(intentConfidence)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Countdown reset indicator */}
          {countdownResetTo !== undefined && (
            <div
              className={`mt-2 pt-2 border-t ${
                isFuture ? 'border-slate-200 text-slate-500' : 'border-purple-200 text-purple-700'
              } text-xs`}
            >
              <Icon name="timer" className="w-3 h-3 inline mr-1" />
              Countdown reset to {countdownResetTo}
            </div>
          )}
        </div>

        {/* Expandable Payload */}
        {event.rawEvent && <ExpandablePayload payload={event.rawEvent} className="text-xs" />}
      </div>
    </div>
  )
}

export default SummaryUpdatedCard
