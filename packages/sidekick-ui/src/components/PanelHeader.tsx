import { ChevronLeft, ChevronRight } from 'lucide-react'
import type { ReactNode } from 'react'

interface PanelHeaderProps {
  title: string
  expanded: boolean
  onToggle: () => void
  collapseDirection: 'left' | 'right'
  children?: ReactNode
}

export function PanelHeader({ title, expanded, onToggle, collapseDirection, children }: PanelHeaderProps) {
  const CollapseIcon = collapseDirection === 'left' ? ChevronLeft : ChevronRight
  const ExpandIcon = collapseDirection === 'left' ? ChevronRight : ChevronLeft

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">{title}</h2>
        {children}
      </div>
      <button
        onClick={onToggle}
        className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-300 flex-shrink-0"
        title={expanded ? 'Collapse' : 'Expand'}
      >
        {expanded ? <CollapseIcon size={16} /> : <ExpandIcon size={16} />}
      </button>
    </div>
  )
}
