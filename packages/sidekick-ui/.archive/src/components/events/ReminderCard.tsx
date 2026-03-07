import React from 'react'
import type { UIEvent } from '../../types'
import Icon from '../Icon'
import ExpandablePayload from '../common/ExpandablePayload'

interface ReminderCardProps {
  event: UIEvent
  isFuture: boolean
  onTraceClick?: (traceId: string) => void
}

/**
 * Priority badge with color gradient based on priority level.
 */
const PriorityBadge: React.FC<{ priority: number; isFuture: boolean }> = ({ priority, isFuture }) => {
  let colorClasses = {
    bg: 'bg-slate-100',
    text: 'text-slate-600',
    border: 'border-slate-200',
  }

  if (!isFuture) {
    if (priority >= 80) {
      colorClasses = {
        bg: 'bg-red-100',
        text: 'text-red-700',
        border: 'border-red-200',
      }
    } else if (priority >= 60) {
      colorClasses = {
        bg: 'bg-orange-100',
        text: 'text-orange-700',
        border: 'border-orange-200',
      }
    } else if (priority >= 40) {
      colorClasses = {
        bg: 'bg-amber-100',
        text: 'text-amber-700',
        border: 'border-amber-200',
      }
    } else {
      colorClasses = {
        bg: 'bg-slate-100',
        text: 'text-slate-600',
        border: 'border-slate-200',
      }
    }
  }

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-medium rounded border ${colorClasses.bg} ${colorClasses.text} ${colorClasses.border}`}
    >
      <Icon name="gauge" className="w-2.5 h-2.5" />P{priority}
    </span>
  )
}

/**
 * Badge indicating a blocking reminder.
 */
const BlockingBadge: React.FC<{ isFuture: boolean }> = ({ isFuture }) => (
  <span
    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border ${
      isFuture ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-red-100 text-red-700 border-red-300'
    }`}
  >
    <Icon name="alert-triangle" className="w-2.5 h-2.5" />
    Blocking
  </span>
)

/**
 * Badge indicating a persistent reminder.
 */
const PersistentBadge: React.FC<{ isFuture: boolean }> = ({ isFuture }) => (
  <span
    className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border ${
      isFuture ? 'bg-slate-100 text-slate-400 border-slate-200' : 'bg-slate-100 text-slate-500 border-slate-200'
    }`}
  >
    <Icon name="infinity" className="w-2.5 h-2.5" />
    Persistent
  </span>
)

/**
 * Trace ID link component.
 */
const TraceLink: React.FC<{ traceId: string; isFuture: boolean; onClick?: (traceId: string) => void }> = ({
  traceId,
  isFuture,
  onClick,
}) => {
  if (!onClick) return null

  return (
    <button
      onClick={() => onClick(traceId)}
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] font-mono rounded border transition-colors ${
        isFuture
          ? 'bg-slate-100 text-slate-400 border-slate-200'
          : 'bg-slate-100 text-slate-600 border-slate-200 hover:bg-slate-200 hover:text-slate-800'
      }`}
      disabled={isFuture}
    >
      <Icon name="link" className="w-2.5 h-2.5" />
      {traceId.slice(0, 8)}
    </button>
  )
}

/**
 * ReminderCard component for rendering reminder events with rich visual styling.
 *
 * Displays different layouts based on reminder action:
 * - staged: Shows reminder details with priority, blocking status, and target hook
 * - consumed: Shows whether the reminder was actually returned to Claude
 * - cleared: Shows count of reminders cleared
 */
const ReminderCard: React.FC<ReminderCardProps> = ({ event, isFuture, onTraceClick }) => {
  const { reminderData, traceId, time, rawEvent } = event

  if (!reminderData) {
    return null
  }

  const { action, reminderName, hookName, blocking, priority, persistent, clearedCount, reminderReturned } =
    reminderData

  // Determine border class based on blocking status
  const borderClass =
    !isFuture && blocking
      ? 'border-l-4 border-l-red-500 border-t border-r border-b border-rose-200'
      : 'border border-rose-200'

  // Base container classes
  const containerClasses = `flex gap-3 ${isFuture ? 'opacity-25' : ''}`
  const cardClasses = `flex-1 rounded-lg px-4 py-2 ${
    isFuture ? 'bg-slate-100 border border-slate-200' : `bg-rose-50 ${borderClass}`
  }`

  return (
    <div className={containerClasses}>
      {/* Icon */}
      <div
        className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 ${
          isFuture ? 'bg-slate-200' : 'bg-rose-100'
        }`}
      >
        <Icon name="bell" className={`w-4 h-4 ${isFuture ? 'text-slate-400' : 'text-rose-600'}`} />
      </div>

      {/* Card Content */}
      <div className="flex-1">
        <div className={cardClasses}>
          {/* Header Row */}
          <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`text-sm font-medium ${isFuture ? 'text-slate-500' : 'text-rose-700'}`}>
                {action === 'staged' && 'Reminder Staged'}
                {action === 'consumed' && 'Reminder Consumed'}
                {action === 'cleared' && 'Reminders Cleared'}
              </span>

              {/* Badges for staged reminders */}
              {action === 'staged' && (
                <>
                  {priority !== undefined && <PriorityBadge priority={priority} isFuture={isFuture} />}
                  {blocking && <BlockingBadge isFuture={isFuture} />}
                  {persistent && <PersistentBadge isFuture={isFuture} />}
                </>
              )}

              {/* Badge for consumed reminders */}
              {action === 'consumed' && reminderReturned !== undefined && (
                <span
                  className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium rounded border ${
                    isFuture
                      ? 'bg-slate-100 text-slate-400 border-slate-200'
                      : reminderReturned
                        ? 'bg-emerald-100 text-emerald-700 border-emerald-200'
                        : 'bg-slate-100 text-slate-600 border-slate-200'
                  }`}
                >
                  <Icon name={reminderReturned ? 'check-circle' : 'x-circle'} className="w-2.5 h-2.5" />
                  {reminderReturned ? 'Returned' : 'Not Returned'}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              {traceId && onTraceClick && <TraceLink traceId={traceId} isFuture={isFuture} onClick={onTraceClick} />}
              <span className={`text-xs ${isFuture ? 'text-slate-400' : 'text-rose-600'}`}>{time}</span>
            </div>
          </div>

          {/* Content Section */}
          <div className="space-y-1">
            {/* Reminder Name (for staged/consumed) */}
            {(action === 'staged' || action === 'consumed') && reminderName && (
              <div className={`text-sm font-semibold ${isFuture ? 'text-slate-600' : 'text-rose-800'}`}>
                {reminderName}
              </div>
            )}

            {/* Hook Name (for staged) */}
            {action === 'staged' && hookName && (
              <div className={`text-xs ${isFuture ? 'text-slate-500' : 'text-rose-600'} flex items-center gap-1`}>
                <Icon name="arrow-right" className="w-3 h-3" />
                Target: <span className="font-mono">{hookName}</span>
              </div>
            )}

            {/* Cleared Count */}
            {action === 'cleared' && clearedCount !== undefined && (
              <div className={`text-sm ${isFuture ? 'text-slate-600' : 'text-rose-800'}`}>
                Cleared {clearedCount} reminder{clearedCount !== 1 ? 's' : ''}
              </div>
            )}

            {/* Event Content (fallback) */}
            {event.content && (
              <p className={`text-sm ${isFuture ? 'text-slate-500' : 'text-rose-700'} mt-1`}>{event.content}</p>
            )}
          </div>
        </div>

        {/* Expandable Payload */}
        {rawEvent && !isFuture && (
          <div className="mt-2">
            <ExpandablePayload payload={rawEvent} maxHeight={300} />
          </div>
        )}
      </div>
    </div>
  )
}

export default ReminderCard
