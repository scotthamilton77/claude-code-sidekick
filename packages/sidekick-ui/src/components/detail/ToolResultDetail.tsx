import type { TranscriptLine } from '../../types'

interface ToolResultDetailProps {
  line: TranscriptLine
}

/** Detail view for tool-result entries */
export function ToolResultDetail({ line }: ToolResultDetailProps) {
  return (
    <div className="p-3 space-y-2">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          line.toolSuccess === false
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
            : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
        }`}>
          {line.toolSuccess === false ? 'FAILED' : 'SUCCESS'}
        </span>
      </div>
      {line.toolOutput && (
        <pre className="text-[11px] font-mono bg-slate-50 dark:bg-slate-800 p-3 rounded overflow-auto max-h-[400px] text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
          {line.toolOutput}
        </pre>
      )}
    </div>
  )
}
