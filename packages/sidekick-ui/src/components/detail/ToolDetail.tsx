import { useState } from 'react'
import type { TranscriptLine } from '../../types'
import { Collapsible } from '../Collapsible'

interface ToolDetailProps {
  line: TranscriptLine
}

export function ToolDetail({ line }: ToolDetailProps) {
  const [showInput, setShowInput] = useState(true)

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-sm font-mono font-medium text-cyan-700 dark:text-cyan-400">
          {line.toolName}
        </span>
        {line.toolDurationMs != null && (
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded text-slate-500 tabular-nums">
            {line.toolDurationMs}ms
          </span>
        )}
      </div>

      {line.toolInput && (
        <Collapsible label="Input" open={showInput} onToggle={() => setShowInput(!showInput)}>
          <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
            {JSON.stringify(line.toolInput, null, 2)}
          </pre>
        </Collapsible>
      )}
    </div>
  )
}
