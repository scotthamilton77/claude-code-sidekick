import type { SidekickEvent } from '../../types'
import { formatTime } from '../../utils/formatTime'

interface TimelineEventProps {
  event: SidekickEvent
  isSynced: boolean
  onClick: () => void
}

export function TimelineEventItem({ event, isSynced, onClick }: TimelineEventProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2 px-2 py-1 text-left rounded transition-all ${
        isSynced
          ? 'bg-indigo-50 dark:bg-indigo-950 ring-1 ring-indigo-300 dark:ring-indigo-700'
          : 'hover:bg-slate-50 dark:hover:bg-slate-800'
      }`}
    >
      {/* Time */}
      <span className="text-[10px] font-mono text-slate-400 flex-shrink-0 tabular-nums pt-0.5">
        {formatTime(event.timestamp)}
      </span>

      {/* Label */}
      <span className="text-xs text-slate-700 dark:text-slate-300 leading-snug">
        {event.label}
      </span>
    </button>
  )
}
