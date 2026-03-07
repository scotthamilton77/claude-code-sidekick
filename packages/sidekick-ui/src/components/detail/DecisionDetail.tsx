import type { TranscriptLine } from '../../types'

interface DecisionDetailProps {
  line: TranscriptLine
}

export function DecisionDetail({ line }: DecisionDetailProps) {
  return (
    <div className="p-3 space-y-3">
      {line.decisionCategory && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded font-medium">
            {line.decisionCategory}
          </span>
        </div>
      )}
      {line.decisionReasoning && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Reasoning</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {line.decisionReasoning}
          </p>
        </div>
      )}
    </div>
  )
}
