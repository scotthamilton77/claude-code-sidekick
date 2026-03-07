import type { FocusFilter } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'

const FILTER_CONFIG: { filter: FocusFilter; label: string; color: string; activeColor: string }[] = [
  { filter: 'transcript', label: 'Chat', color: 'text-blue-400', activeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700' },
  { filter: 'hooks', label: 'Hooks', color: 'text-orange-400', activeColor: 'bg-orange-100 text-orange-700 dark:bg-orange-900/40 dark:text-orange-300 ring-1 ring-orange-300 dark:ring-orange-700' },
  { filter: 'decisions', label: 'Decisions', color: 'text-amber-400', activeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700' },
  { filter: 'reminders', label: 'Reminders', color: 'text-rose-400', activeColor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 ring-1 ring-rose-300 dark:ring-rose-700' },
  { filter: 'llm-calls', label: 'LLM', color: 'text-indigo-400', activeColor: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-300 ring-1 ring-indigo-300 dark:ring-indigo-700' },
  { filter: 'state-changes', label: 'State', color: 'text-purple-400', activeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700' },
  { filter: 'errors', label: 'Errors', color: 'text-red-400', activeColor: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700' },
]

export function FocusFilterBar() {
  const { state, dispatch } = useNavigation()

  return (
    <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {FILTER_CONFIG.map(({ filter, label, activeColor }) => {
        const isActive = state.activeFilters.has(filter)
        return (
          <button
            key={filter}
            onClick={() => dispatch({ type: 'TOGGLE_FILTER', filter })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              isActive
                ? activeColor
                : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
            }`}
          >
            {label}
          </button>
        )
      })}
    </div>
  )
}
