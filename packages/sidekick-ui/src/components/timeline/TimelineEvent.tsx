import type { TimelineEvent as TEvent, EventType } from '../../types'

const DOT_COLORS: Record<EventType, string> = {
  'session-start': 'bg-slate-400',
  'user-message': 'bg-blue-500',
  'assistant-message': 'bg-emerald-500',
  'tool-use': 'bg-cyan-500',
  'hook-execution': 'bg-orange-500',
  'decision': 'bg-amber-500',
  'state-change': 'bg-purple-500',
  'reminder': 'bg-rose-500',
  'compaction': 'bg-slate-500',
  'persona-change': 'bg-pink-500',
  'llm-call': 'bg-indigo-500',
  'error': 'bg-red-500',
  'statusline-call': 'bg-teal-500',
}

function confidenceDot(confidence: number | undefined) {
  if (confidence == null) return null
  const color = confidence > 0.8 ? 'bg-emerald-400' : confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400'
  return (
    <div
      className={`w-1.5 h-1.5 rounded-full ${color}`}
      title={`Confidence: ${Math.round(confidence * 100)}%`}
    />
  )
}

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

interface TimelineEventProps {
  event: TEvent
  isSelected: boolean
  isHovered: boolean
  isDimmed: boolean
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export function TimelineEventItem({
  event,
  isSelected,
  isHovered,
  isDimmed,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: TimelineEventProps) {
  return (
    <button
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`w-full flex items-center gap-2 px-2 py-1 text-left rounded transition-all ${
        isDimmed ? 'opacity-20' : ''
      } ${
        isSelected
          ? 'bg-indigo-50 dark:bg-indigo-950 ring-1 ring-indigo-300 dark:ring-indigo-700'
          : isHovered
            ? 'bg-slate-50 dark:bg-slate-800'
            : 'hover:bg-slate-50 dark:hover:bg-slate-800'
      }`}
    >
      {/* Colored dot */}
      <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${DOT_COLORS[event.type]}`} />

      {/* Time */}
      <span className="text-[10px] font-mono text-slate-400 flex-shrink-0 tabular-nums">
        {formatTime(event.timestamp)}
      </span>

      {/* Label */}
      <span className="text-xs text-slate-700 dark:text-slate-300 truncate">
        {event.label}
      </span>

      {/* Confidence dot for state events */}
      {event.type === 'state-change' && confidenceDot(event.confidence)}
    </button>
  )
}

// Re-export dot colors for CompressedTimeline
export { DOT_COLORS }
