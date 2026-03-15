import { User, Clock, Coins, Hash, Moon, Sun, Activity, ListTodo, Cpu } from 'lucide-react'
import type { Session } from '../types'
import { useNavigation } from '../hooks/useNavigation'

interface SummaryStripProps {
  session: Session
  defaultModel?: string
}

function confidenceColor(c: number | undefined): string {
  if (c == null) return 'bg-slate-300'
  if (c > 0.8) return 'bg-emerald-400'
  if (c >= 0.5) return 'bg-amber-400'
  return 'bg-red-400'
}

function contextWindowColor(pct: number | undefined): string {
  if (pct == null) return 'bg-slate-300'
  if (pct > 85) return 'bg-red-400'
  if (pct >= 60) return 'bg-amber-400'
  return 'bg-emerald-400'
}

function formatDuration(sec: number | undefined): string {
  if (sec == null) return '--'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  return m > 0 ? `${m}m ${s}s` : `${s}s`
}

function formatModelName(model: string): string {
  return model.replace('claude-', '').split('-202')[0]
}

export function SummaryStrip({ session, defaultModel }: SummaryStripProps) {
  const { state, dispatch } = useNavigation()

  return (
    <div className="flex items-center gap-4 px-3 py-1.5 bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-700 text-xs overflow-x-auto">
      {/* Persona */}
      {session.persona && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <User size={12} className="text-indigo-500" />
          <span className="font-medium text-slate-700 dark:text-slate-300">{session.persona}</span>
        </div>
      )}

      {/* Model */}
      {defaultModel && (
        <div className="flex items-center gap-1.5 flex-shrink-0">
          <Cpu size={12} className="text-slate-400" />
          <span className="font-mono text-slate-600 dark:text-slate-400">{formatModelName(defaultModel)}</span>
        </div>
      )}

      {/* Intent + confidence */}
      {session.intent && (
        <div className="flex items-center gap-1.5 flex-shrink-0 min-w-0">
          <div className={`w-2 h-2 rounded-full flex-shrink-0 ${confidenceColor(session.intentConfidence)}`}
            title={`Confidence: ${session.intentConfidence != null ? Math.round(session.intentConfidence * 100) + '%' : 'unknown'}`}
          />
          <span className="text-slate-600 dark:text-slate-400 truncate max-w-[200px]">{session.intent}</span>
        </div>
      )}

      <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 flex-shrink-0" />

      {/* Context window */}
      {session.contextWindowPct != null && (
        <div className="flex items-center gap-1.5 flex-shrink-0" title={`Context window: ${session.contextWindowPct}%`}>
          <Activity size={12} className="text-slate-400" />
          <div className="w-16 h-1.5 bg-slate-200 dark:bg-slate-700 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all ${contextWindowColor(session.contextWindowPct)}`}
              style={{ width: `${Math.min(session.contextWindowPct, 100)}%` }}
            />
          </div>
          <span className="text-slate-500 dark:text-slate-400 tabular-nums">{session.contextWindowPct}%</span>
        </div>
      )}

      {/* Task queue */}
      {session.taskQueueCount != null && session.taskQueueCount > 0 && (
        <div className="flex items-center gap-1 flex-shrink-0">
          <ListTodo size={12} className="text-slate-400" />
          <span className="text-slate-500 dark:text-slate-400">{session.taskQueueCount} queued</span>
        </div>
      )}

      <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 flex-shrink-0" />

      {/* Tokens */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Hash size={12} className="text-slate-400" />
        <span className="text-slate-500 dark:text-slate-400 tabular-nums">
          {session.tokenCount != null ? `${(session.tokenCount / 1000).toFixed(1)}k` : '--'}
        </span>
      </div>

      {/* Cost */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Coins size={12} className="text-slate-400" />
        <span className="text-slate-500 dark:text-slate-400 tabular-nums">
          ${session.costUsd != null ? session.costUsd.toFixed(2) : '--'}
        </span>
      </div>

      {/* Duration */}
      <div className="flex items-center gap-1 flex-shrink-0">
        <Clock size={12} className="text-slate-400" />
        <span className="text-slate-500 dark:text-slate-400">{formatDuration(session.durationSec)}</span>
      </div>

      <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 flex-shrink-0" />

      {/* Status */}
      <div className={`px-1.5 py-0.5 rounded text-[10px] font-medium flex-shrink-0 ${
        session.status === 'active'
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
      }`}>
        {session.status === 'active' ? 'LIVE' : 'HISTORY'}
      </div>

      {/* Dark mode toggle — pushed right */}
      <div className="ml-auto flex-shrink-0">
        <button
          onClick={() => dispatch({ type: 'TOGGLE_DARK_MODE' })}
          className="p-1 rounded hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300"
          title={state.darkMode ? 'Light mode' : 'Dark mode'}
        >
          {state.darkMode ? <Sun size={14} /> : <Moon size={14} />}
        </button>
      </div>
    </div>
  )
}
