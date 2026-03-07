import {
  User, Bot, Terminal, GitBranch, AlertCircle, Lightbulb,
  Bell, Gauge, Scissors, UserCog, Cpu, AlertTriangle
} from 'lucide-react'
import type { TimelineEvent, EventType } from '../../types'

function formatTime(ts: number): string {
  const d = new Date(ts)
  return d.toLocaleTimeString('en-US', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

const DIVIDER_TYPES = new Set<EventType>(['session-start', 'compaction', 'persona-change'])

interface TranscriptEventProps {
  event: TimelineEvent
  isSelected: boolean
  isHovered: boolean
  isDimmed: boolean
  onClick: () => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export function TranscriptEventCard({
  event,
  isSelected,
  isHovered,
  isDimmed,
  onClick,
  onMouseEnter,
  onMouseLeave,
}: TranscriptEventProps) {
  if (DIVIDER_TYPES.has(event.type)) {
    return (
      <div
        className={`flex items-center gap-2 px-4 py-2 transition-opacity ${isDimmed ? 'opacity-20' : ''}`}
        onClick={onClick}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
        <div className="flex items-center gap-1 text-[10px] text-slate-400">
          {event.type === 'session-start' && <GitBranch size={10} />}
          {event.type === 'compaction' && <Scissors size={10} />}
          {event.type === 'persona-change' && <UserCog size={10} />}
          <span>{event.label}</span>
        </div>
        <div className="flex-1 border-t border-slate-200 dark:border-slate-700" />
      </div>
    )
  }

  const cardStyles = getCardStyles(event)

  return (
    <div
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      className={`px-3 py-1 transition-all cursor-pointer ${isDimmed ? 'opacity-20' : ''} ${
        event.type === 'tool-use' || event.type === 'hook-execution' ? 'ml-8' : ''
      }`}
    >
      <div
        className={`rounded-lg px-3 py-2 transition-all ${cardStyles.bg} ${cardStyles.border} ${
          isSelected
            ? 'ring-2 ring-indigo-400 dark:ring-indigo-500'
            : isHovered
              ? 'ring-1 ring-slate-300 dark:ring-slate-600'
              : ''
        }`}
      >
        <div className="flex items-center gap-1.5 mb-1">
          <cardStyles.Icon size={12} className={cardStyles.iconColor} />
          <span className={`text-[10px] font-medium ${cardStyles.labelColor}`}>
            {cardStyles.label}
          </span>
          <span className="text-[10px] text-slate-400 ml-auto tabular-nums">
            {formatTime(event.timestamp)}
          </span>
        </div>

        {event.content && (
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed line-clamp-3">
            {event.content}
          </p>
        )}

        {event.type === 'tool-use' && (
          <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-1">
            <span className="font-mono">{event.toolName}</span>
            {event.toolDurationMs != null && <span className="ml-2">{event.toolDurationMs}ms</span>}
          </div>
        )}
        {event.type === 'hook-execution' && (
          <div className="flex items-center gap-2 text-[10px] mt-1">
            <span className="font-mono text-slate-500">{event.hookName}</span>
            <span className={`px-1 py-0.5 rounded ${
              event.hookSuccess
                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            }`}>
              {event.hookSuccess ? 'OK' : 'FAIL'}
            </span>
            {event.hookDurationMs != null && <span className="text-slate-400">{event.hookDurationMs}ms</span>}
          </div>
        )}
        {event.type === 'decision' && event.decisionReasoning && (
          <p className="text-[10px] text-amber-700 dark:text-amber-400 mt-1 italic line-clamp-2">
            {event.decisionReasoning}
          </p>
        )}
        {event.type === 'reminder' && (
          <div className="flex items-center gap-2 text-[10px] mt-1">
            <span className={`px-1 py-0.5 rounded font-medium ${
              event.reminderAction === 'staged' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
                : event.reminderAction === 'consumed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                  : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
            }`}>
              {event.reminderAction}
            </span>
            {event.reminderHook && <span className="text-slate-400">{event.reminderHook}</span>}
            {event.reminderBlocking && <span className="text-red-400 font-medium">blocking</span>}
          </div>
        )}
        {event.type === 'error' && event.errorMessage && (
          <p className="text-[10px] text-red-600 dark:text-red-400 mt-1 font-mono">
            {event.errorMessage}
          </p>
        )}
        {event.type === 'llm-call' && (
          <div className="flex items-center gap-2 text-[10px] text-slate-500 mt-1">
            <span className="font-mono">{event.llmModel}</span>
            {event.llmLatencyMs != null && <span>{(event.llmLatencyMs / 1000).toFixed(1)}s</span>}
            {event.llmCostUsd != null && <span>${event.llmCostUsd.toFixed(3)}</span>}
          </div>
        )}
        {event.type === 'statusline-call' && event.statuslineContent && (
          <p className="text-[10px] text-teal-600 dark:text-teal-400 mt-1 font-mono">
            {event.statuslineContent}
          </p>
        )}
        {event.type === 'state-change' && event.confidence != null && (
          <div className="flex items-center gap-1 text-[10px] mt-1">
            <div className={`w-2 h-2 rounded-full ${
              event.confidence > 0.8 ? 'bg-emerald-400' : event.confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400'
            }`} />
            <span className="text-slate-400">{Math.round(event.confidence * 100)}% confidence</span>
          </div>
        )}
      </div>
    </div>
  )
}

function getCardStyles(event: TimelineEvent) {
  switch (event.type) {
    case 'user-message':
      return { bg: 'bg-white dark:bg-slate-800', border: 'border border-blue-200 dark:border-blue-800', Icon: User, iconColor: 'text-blue-500', label: 'User', labelColor: 'text-blue-600 dark:text-blue-400' }
    case 'assistant-message':
      return { bg: 'bg-white dark:bg-slate-800', border: 'border border-emerald-200 dark:border-emerald-800', Icon: Bot, iconColor: 'text-emerald-500', label: 'Assistant', labelColor: 'text-emerald-600 dark:text-emerald-400' }
    case 'tool-use':
      return { bg: 'bg-slate-50 dark:bg-slate-800/50', border: 'border border-cyan-200 dark:border-cyan-800', Icon: Terminal, iconColor: 'text-cyan-500', label: event.toolName ?? 'Tool', labelColor: 'text-cyan-600 dark:text-cyan-400' }
    case 'hook-execution':
      return { bg: 'bg-slate-50 dark:bg-slate-800/50', border: `border ${event.hookSuccess === false ? 'border-red-300 dark:border-red-800' : 'border-orange-200 dark:border-orange-800'}`, Icon: Cpu, iconColor: event.hookSuccess === false ? 'text-red-500' : 'text-orange-500', label: event.hookName ?? 'Hook', labelColor: event.hookSuccess === false ? 'text-red-600 dark:text-red-400' : 'text-orange-600 dark:text-orange-400' }
    case 'decision':
      return { bg: 'bg-amber-50 dark:bg-amber-950/30', border: 'border border-amber-200 dark:border-amber-800', Icon: Lightbulb, iconColor: 'text-amber-500', label: event.decisionCategory ? `Decision: ${event.decisionCategory}` : 'Decision', labelColor: 'text-amber-600 dark:text-amber-400' }
    case 'state-change':
      return { bg: 'bg-purple-50 dark:bg-purple-950/30', border: 'border border-purple-200 dark:border-purple-800', Icon: AlertCircle, iconColor: 'text-purple-500', label: 'State Change', labelColor: 'text-purple-600 dark:text-purple-400' }
    case 'reminder':
      return { bg: 'bg-rose-50 dark:bg-rose-950/30', border: 'border border-rose-200 dark:border-rose-800', Icon: Bell, iconColor: 'text-rose-500', label: 'Reminder', labelColor: 'text-rose-600 dark:text-rose-400' }
    case 'llm-call':
      return { bg: 'bg-indigo-50 dark:bg-indigo-950/30', border: 'border border-indigo-200 dark:border-indigo-800', Icon: Cpu, iconColor: 'text-indigo-500', label: 'LLM Call', labelColor: 'text-indigo-600 dark:text-indigo-400' }
    case 'error':
      return { bg: 'bg-red-50 dark:bg-red-950/30', border: 'border-2 border-red-300 dark:border-red-800', Icon: AlertTriangle, iconColor: 'text-red-500', label: 'Error', labelColor: 'text-red-600 dark:text-red-400' }
    case 'statusline-call':
      return { bg: 'bg-teal-50 dark:bg-teal-950/30', border: 'border border-teal-200 dark:border-teal-800', Icon: Gauge, iconColor: 'text-teal-500', label: 'Statusline', labelColor: 'text-teal-600 dark:text-teal-400' }
    default:
      return { bg: 'bg-slate-50 dark:bg-slate-800', border: 'border border-slate-200 dark:border-slate-700', Icon: AlertCircle, iconColor: 'text-slate-400', label: event.type, labelColor: 'text-slate-500' }
  }
}
