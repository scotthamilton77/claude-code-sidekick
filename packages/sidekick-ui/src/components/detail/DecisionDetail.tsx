import type { TranscriptLine } from '../../types'

interface DecisionDetailProps {
  line: TranscriptLine
}

export function DecisionDetail({ line }: DecisionDetailProps) {
  const displayTitle = line.decisionTitle || line.decisionCategory || 'unknown'

  return (
    <div className="p-3 space-y-3">
      <div>
        <h3 className="text-[10px] font-medium text-slate-500 mb-1">Decision</h3>
        <p className="text-xs text-slate-700 dark:text-slate-300 font-medium">
          {displayTitle}
        </p>
      </div>
      {line.decisionTitle && line.decisionCategory && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded font-medium">
            {line.decisionCategory}
          </span>
        </div>
      )}
      {line.decisionSubsystem && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Subsystem</h3>
          <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 rounded font-medium">
            {line.decisionSubsystem}
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
