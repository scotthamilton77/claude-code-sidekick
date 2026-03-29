import type { TranscriptLine } from '../../types'

interface TranscriptMessageDetailProps {
  line: TranscriptLine
}

/** Detail view for user-message and assistant-message entries */
export function TranscriptMessageDetail({ line }: TranscriptMessageDetailProps) {
  return (
    <div className="p-3 space-y-3">
      {line.content && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Content</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap">
            {line.content}
          </p>
        </div>
      )}
      {line.thinking && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Thinking</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed whitespace-pre-wrap italic border-l-2 border-slate-200 dark:border-slate-700 pl-3">
            {line.thinking}
          </p>
        </div>
      )}
    </div>
  )
}
