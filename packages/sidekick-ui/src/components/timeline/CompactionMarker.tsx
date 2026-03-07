import { Scissors } from 'lucide-react'
import type { TimelineEvent } from '../../types'

interface CompactionMarkerProps {
  event: TimelineEvent
}

export function CompactionMarker({ event }: CompactionMarkerProps) {
  const before = event.compactionTokensBefore != null ? `${(event.compactionTokensBefore / 1000).toFixed(0)}k` : '?'
  const after = event.compactionTokensAfter != null ? `${(event.compactionTokensAfter / 1000).toFixed(0)}k` : '?'

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 my-0.5">
      <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
      <div className="flex items-center gap-1 text-[10px] text-slate-400">
        <Scissors size={12} />
        <span>Segment {event.compactionSegment ?? '?'}</span>
        <span className="text-slate-300 dark:text-slate-600">|</span>
        <span>{before} → {after}</span>
      </div>
      <div className="flex-1 border-t border-dashed border-slate-300 dark:border-slate-600" />
    </div>
  )
}
