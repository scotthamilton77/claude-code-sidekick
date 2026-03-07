import type { SidekickEvent } from '../../types'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface TimelineEventProps {
  event: SidekickEvent
  isSynced: boolean
  isDimmed: boolean
  onClick: () => void
}

export function TimelineEventItem({ event, isSynced, isDimmed, onClick }: TimelineEventProps) {
  return (
    <button
      onClick={onClick}
      className={`w-full flex items-start gap-2 px-2 py-1 text-left rounded transition-all ${
        isDimmed ? 'opacity-20' : ''
      } ${
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
