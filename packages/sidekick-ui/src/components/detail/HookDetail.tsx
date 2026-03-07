import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { TimelineEvent } from '../../types'

interface HookDetailProps {
  event: TimelineEvent
}

export function HookDetail({ event }: HookDetailProps) {
  const [showOutput, setShowOutput] = useState(false)

  return (
    <div className={`p-3 space-y-3 ${event.hookSuccess === false ? 'border-l-2 border-red-400' : ''}`}>
      {/* Hook name + status */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-medium text-orange-700 dark:text-orange-400">
          {event.hookName}
        </span>
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          event.hookSuccess
            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
            : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
        }`}>
          {event.hookSuccess ? 'SUCCESS' : 'FAILED'}
        </span>
        {event.hookDurationMs != null && (
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-500 tabular-nums">
            {event.hookDurationMs}ms
          </span>
        )}
      </div>

      {/* Output */}
      {event.hookOutput && (
        <div className="border border-slate-200 dark:border-slate-700 rounded">
          <button
            onClick={() => setShowOutput(!showOutput)}
            className="flex items-center gap-1 w-full px-2 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
          >
            {showOutput ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
            <span className="text-[10px] font-medium text-slate-500">Output</span>
          </button>
          {showOutput && (
            <div className="px-2 py-1.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800">
              <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
                {event.hookOutput}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
