import { useState, useEffect } from 'react'
import { Search } from 'lucide-react'
import { useNavigation } from '../../hooks/useNavigation'

export function SearchFilterBar() {
  const { state, dispatch } = useNavigation()
  const [localQuery, setLocalQuery] = useState(state.searchQuery)

  useEffect(() => {
    const timer = setTimeout(() => {
      dispatch({ type: 'SET_SEARCH', query: localQuery })
    }, 200)
    return () => clearTimeout(timer)
  }, [localQuery, dispatch])

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="flex items-center gap-1.5 flex-1 bg-slate-50 dark:bg-slate-800 rounded px-2 py-1">
        <Search size={12} className="text-slate-400 flex-shrink-0" />
        <input
          type="text"
          value={localQuery}
          onChange={e => setLocalQuery(e.target.value)}
          placeholder="Search events..."
          className="flex-1 text-xs bg-transparent border-none outline-none text-slate-700 dark:text-slate-300 placeholder-slate-400"
        />
      </div>
    </div>
  )
}
