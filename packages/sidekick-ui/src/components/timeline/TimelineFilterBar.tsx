import type { TimelineFilter } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'

const FILTER_LABELS: { filter: TimelineFilter; label: string }[] = [
  { filter: 'reminders', label: 'Reminders' },
  { filter: 'decisions', label: 'Decisions' },
  { filter: 'session-analysis', label: 'Analysis' },
  { filter: 'statusline', label: 'Statusline' },
  { filter: 'errors', label: 'Errors' },
  { filter: 'hooks', label: 'Hooks' },
]

const ACTIVE_STYLE = 'bg-slate-200 text-slate-800 dark:bg-slate-600 dark:text-slate-200 ring-1 ring-slate-300 dark:ring-slate-500'

export function TimelineFilterBar() {
  const { state, dispatch } = useNavigation()

  return (
    <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      {FILTER_LABELS.map(({ filter, label }) => {
        const isActive = state.timelineFilters.has(filter)
        return (
          <button
            key={filter}
            onClick={() => dispatch({ type: 'TOGGLE_TIMELINE_FILTER', filter })}
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              isActive
                ? ACTIVE_STYLE
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
