import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { TimelineEvent } from '../../types'

interface ErrorDetailProps {
  event: TimelineEvent
}

export function ErrorDetail({ event }: ErrorDetailProps) {
  const [showStack, setShowStack] = useState(false)

  return (
    <div className="p-3 space-y-3 border-l-2 border-red-400">
      {/* Error message */}
      {event.errorMessage && (
        <div>
          <h3 className="text-[10px] font-medium text-red-500 mb-1">Error</h3>
          <p className="text-xs font-mono text-red-700 dark:text-red-400 leading-relaxed">
            {event.errorMessage}
          </p>
        </div>
      )}

      {/* Stack trace */}
      {event.errorStack && (
        <div className="border border-slate-200 dark:border-slate-700 rounded">
          <button
            onClick={() => setShowStack(!showStack)}
            className="flex items-center gap-1 w-full px-2 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {showStack ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
            <span className="text-[10px] font-medium text-slate-500">Stack Trace</span>
          </button>
          {showStack && (
            <div className="px-2 py-1.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-auto max-h-[300px]">
              <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
                {event.errorStack}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
