import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { TimelineEvent } from '../../types'

interface ToolDetailProps {
  event: TimelineEvent
}

export function ToolDetail({ event }: ToolDetailProps) {
  const [showInput, setShowInput] = useState(false)
  const [showResult, setShowResult] = useState(false)

  return (
    <div className="p-3 space-y-3">
      {/* Tool name + duration */}
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-medium text-cyan-700 dark:text-cyan-400">
          {event.toolName}
        </span>
        {event.toolDurationMs != null && (
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-500 tabular-nums">
            {event.toolDurationMs}ms
          </span>
        )}
      </div>

      {/* Input */}
      {event.toolInput && (
        <Collapsible label="Input" open={showInput} onToggle={() => setShowInput(!showInput)}>
          <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
            {JSON.stringify(event.toolInput, null, 2)}
          </pre>
        </Collapsible>
      )}

      {/* Result */}
      {event.toolResult && (
        <Collapsible label="Result" open={showResult} onToggle={() => setShowResult(!showResult)}>
          <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
            {JSON.stringify(event.toolResult, null, 2)}
          </pre>
        </Collapsible>
      )}
    </div>
  )
}

function Collapsible({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded">
      <button
        onClick={onToggle}
        className="flex items-center gap-1 w-full px-2 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        {open ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
        <span className="text-[10px] font-medium text-slate-500">{label}</span>
      </button>
      {open && (
        <div className="px-2 py-1.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-auto max-h-[300px]">
          {children}
        </div>
      )}
    </div>
  )
}
