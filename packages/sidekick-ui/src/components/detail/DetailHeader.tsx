import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import type { TimelineEvent } from '../../types'

interface DetailHeaderProps {
  event: TimelineEvent
  currentIndex: number
  totalCount: number
  onPrev: () => void
  onNext: () => void
  onClose: () => void
}

export function DetailHeader({ event, currentIndex, totalCount, onPrev, onNext, onClose }: DetailHeaderProps) {
  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
      <div className="flex items-center gap-2 min-w-0">
        <h2 className="text-sm font-semibold text-slate-700 dark:text-slate-300 truncate">
          {event.label}
        </h2>
        <span className="text-[10px] text-slate-400 px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded flex-shrink-0">
          {event.type}
        </span>
      </div>

      <div className="flex items-center gap-1 flex-shrink-0">
        {/* Prev/Next navigation */}
        <button
          onClick={onPrev}
          disabled={currentIndex <= 0}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Previous event"
        >
          <ChevronLeft size={14} />
        </button>
        <span className="text-[10px] text-slate-400 tabular-nums min-w-[40px] text-center">
          {currentIndex + 1} / {totalCount}
        </span>
        <button
          onClick={onNext}
          disabled={currentIndex >= totalCount - 1}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600 disabled:opacity-30 disabled:cursor-not-allowed"
          title="Next event"
        >
          <ChevronRight size={14} />
        </button>

        <div className="w-px h-4 bg-slate-200 dark:bg-slate-700 mx-1" />

        {/* Close */}
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 hover:text-slate-600"
          title="Close detail"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
