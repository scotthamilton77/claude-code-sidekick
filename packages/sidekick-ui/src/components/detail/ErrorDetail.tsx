import type { TranscriptLine } from '../../types'
import { Collapsible } from '../Collapsible'

interface ErrorDetailProps {
  line: TranscriptLine
}

export function ErrorDetail({ line }: ErrorDetailProps) {
  return (
    <div className="p-3 space-y-3 border-l-2 border-red-400">
      {line.errorMessage && (
        <div>
          <h3 className="text-[10px] font-medium text-red-500 mb-1">Error</h3>
          <p className="text-xs font-mono text-red-700 dark:text-red-400 leading-relaxed">
            {line.errorMessage}
          </p>
        </div>
      )}

      {line.errorStack && (
        <Collapsible label="Stack Trace">
          <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap">
            {line.errorStack}
          </pre>
        </Collapsible>
      )}
    </div>
  )
}
