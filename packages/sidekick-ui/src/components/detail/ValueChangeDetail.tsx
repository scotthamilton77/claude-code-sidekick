import type { TranscriptLine } from '../../types'

interface ValueChangeDetailProps {
  line: TranscriptLine
}

/** Detail view for session-title:changed and intent:changed events */
export function ValueChangeDetail({ line }: ValueChangeDetailProps) {
  return (
    <div className="p-3 space-y-2">
      {line.previousValue && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Previous</h3>
          <p className="text-xs text-slate-500 line-through">{line.previousValue}</p>
        </div>
      )}
      {line.newValue && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">New</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">{line.newValue}</p>
        </div>
      )}
      {line.confidence != null && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-slate-500">Confidence:</span>
          <div className={`w-2.5 h-2.5 rounded-full ${
            line.confidence > 0.8 ? 'bg-emerald-400' : line.confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400'
          }`} />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {Math.round(line.confidence * 100)}%
          </span>
        </div>
      )}
    </div>
  )
}
