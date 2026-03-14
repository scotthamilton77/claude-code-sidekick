import type { TranscriptFilter } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'

const FILTER_CONFIG: { filter: TranscriptFilter; label: string; activeColor: string }[] = [
  { filter: 'conversation', label: 'Chat', activeColor: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 ring-1 ring-indigo-300 dark:ring-indigo-700' },
  { filter: 'tools', label: 'Tools', activeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700' },
  { filter: 'thinking', label: 'Thinking', activeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700' },
  { filter: 'sidekick', label: 'Sidekick', activeColor: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300 ring-1 ring-emerald-300 dark:ring-emerald-700' },
  { filter: 'system', label: 'System', activeColor: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 ring-1 ring-slate-300 dark:ring-slate-600' },
]

export function TranscriptFilterBar() {
  const { state, dispatch } = useNavigation()

  return (
    <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {FILTER_CONFIG.map(({ filter, label, activeColor }) => {
        const isActive = state.transcriptFilters.has(filter)
        return (
          <button
            key={filter}
            onClick={() => dispatch({ type: 'TOGGLE_TRANSCRIPT_FILTER', filter })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              isActive
                ? activeColor
                : 'text-slate-400 ring-1 ring-slate-200 dark:ring-slate-700 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
