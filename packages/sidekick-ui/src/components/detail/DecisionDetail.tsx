import type { TimelineEvent } from '../../types'

interface DecisionDetailProps {
  event: TimelineEvent
}

export function DecisionDetail({ event }: DecisionDetailProps) {
  return (
    <div className="p-3 space-y-3">
      {/* Category */}
      {event.decisionCategory && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 rounded font-medium">
            {event.decisionCategory}
          </span>
        </div>
      )}

      {/* Reasoning */}
      {event.decisionReasoning && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Reasoning</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {event.decisionReasoning}
          </p>
        </div>
      )}

      {/* Impact */}
      {event.decisionImpact && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Impact</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
            {event.decisionImpact}
          </p>
        </div>
      )}
    </div>
  )
}
