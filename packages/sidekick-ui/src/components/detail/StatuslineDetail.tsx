import type { TranscriptLine } from '../../types'

interface StatuslineDetailProps {
  line: TranscriptLine
}

/** Detail view for statusline:rendered entries */
export function StatuslineDetail({ line }: StatuslineDetailProps) {
  return (
    <div className="p-3 space-y-3">
      {line.hookInput != null && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Hook Input</h3>
          <div className="space-y-1">
            {Object.entries(line.hookInput)
              .filter(([, value]) => value != null)
              .map(([key, value]) => (
              <div key={key} className="flex gap-2 min-w-0">
                <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 shrink-0">{key}</span>
                <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 break-all">
                  {typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
                    ? String(value)
                    : (() => { try { return JSON.stringify(value) } catch { return '[circular]' } })()}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {line.statuslineContent && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Rendered Output</h3>
          <pre className="text-xs font-mono text-teal-600 dark:text-teal-400 whitespace-pre-wrap bg-slate-50 dark:bg-slate-800/50 rounded p-2">
            {line.statuslineContent}
          </pre>
        </div>
      )}
    </div>
  )
}
