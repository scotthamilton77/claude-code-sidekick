import type { TimelineFilter } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'

const FILTER_CONFIG: { filter: TimelineFilter; label: string; activeColor: string }[] = [
  { filter: 'reminders', label: 'Reminders', activeColor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 ring-1 ring-rose-300 dark:ring-rose-700' },
  { filter: 'decisions', label: 'Decisions', activeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700' },
  { filter: 'session-analysis', label: 'Analysis', activeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700' },
  { filter: 'statusline', label: 'Statusline', activeColor: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 ring-1 ring-teal-300 dark:ring-teal-700' },
  { filter: 'errors', label: 'Errors', activeColor: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700' },
]

export function TimelineFilterBar() {
  const { state, dispatch } = useNavigation()

  return (
    <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {FILTER_CONFIG.map(({ filter, label, activeColor }) => {
        const isActive = state.timelineFilters.has(filter)
        return (
          <button
            key={filter}
            onClick={() => dispatch({ type: 'TOGGLE_TIMELINE_FILTER', filter })}
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
