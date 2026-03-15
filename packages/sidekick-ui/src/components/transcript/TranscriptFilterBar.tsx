import type { TranscriptFilter } from '../../types'
import { useNavigation } from '../../hooks/useNavigation'

const FILTER_CONFIG: { filter: TranscriptFilter; label: string; activeColor: string }[] = [
  // Conversation filters — colors match bubble families
  { filter: 'conversation', label: 'Chat', activeColor: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300 ring-1 ring-blue-300 dark:ring-blue-700' },
  { filter: 'tools', label: 'Tools', activeColor: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-900/40 dark:text-cyan-300 ring-1 ring-cyan-300 dark:ring-cyan-700' },
  { filter: 'thinking', label: 'Thinking', activeColor: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300 ring-1 ring-violet-300 dark:ring-violet-700' },
  { filter: 'system', label: 'System', activeColor: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300 ring-1 ring-slate-300 dark:ring-slate-600' },
  // Timeline-category filters — colors match sidekick event bubble families
  { filter: 'reminders', label: 'Reminders', activeColor: 'bg-rose-100 text-rose-700 dark:bg-rose-900/40 dark:text-rose-300 ring-1 ring-rose-300 dark:ring-rose-700' },
  { filter: 'decisions', label: 'Decisions', activeColor: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300 ring-1 ring-amber-300 dark:ring-amber-700' },
  { filter: 'session-analysis', label: 'Analysis', activeColor: 'bg-purple-100 text-purple-700 dark:bg-purple-900/40 dark:text-purple-300 ring-1 ring-purple-300 dark:ring-purple-700' },
  { filter: 'statusline', label: 'Statusline', activeColor: 'bg-teal-100 text-teal-700 dark:bg-teal-900/40 dark:text-teal-300 ring-1 ring-teal-300 dark:ring-teal-700' },
  { filter: 'errors', label: 'Errors', activeColor: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300 ring-1 ring-red-300 dark:ring-red-700' },
  { filter: 'hooks', label: 'Hooks', activeColor: 'bg-sky-100 text-sky-700 dark:bg-sky-900/40 dark:text-sky-300 ring-1 ring-sky-300 dark:ring-sky-700' },
]

const ALL_FILTERS = new Set<TranscriptFilter>(FILTER_CONFIG.map(c => c.filter))

export function TranscriptFilterBar() {
  const { state, dispatch } = useNavigation()

  const allActive = FILTER_CONFIG.every(({ filter }) => state.transcriptFilters.has(filter))

  return (
    <div className="flex flex-wrap gap-1 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <button
        onClick={() => dispatch({ type: 'SET_ALL_TRANSCRIPT_FILTERS', filters: allActive ? new Set() : new Set(ALL_FILTERS) })}
        className={`px-2 py-0.5 rounded text-[10px] font-bold transition-all ${
          allActive
            ? 'bg-slate-800 text-white dark:bg-slate-200 dark:text-slate-900 ring-1 ring-slate-600 dark:ring-slate-400'
            : 'text-slate-500 ring-1 ring-slate-300 dark:ring-slate-600 hover:text-slate-700 dark:hover:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800'
        }`}
      >
        All
      </button>
      <div className="w-px bg-slate-200 dark:bg-slate-700 mx-0.5" />
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
