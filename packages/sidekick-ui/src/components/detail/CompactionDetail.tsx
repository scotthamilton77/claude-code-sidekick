import type { TranscriptLine } from '../../types'

interface CompactionDetailProps {
  line: TranscriptLine
}

/** Detail view for compaction (context window compression) entries */
export function CompactionDetail({ line }: CompactionDetailProps) {
  return (
    <div className="p-3 space-y-2">
      <div>
        <h3 className="text-[10px] font-medium text-slate-500 mb-1">Segment</h3>
        <span className="text-xs text-slate-700 dark:text-slate-300">{line.compactionSegment ?? '?'}</span>
      </div>
      {line.compactionTokensBefore != null && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Tokens Before</h3>
          <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">
            {line.compactionTokensBefore.toLocaleString()}
          </span>
        </div>
      )}
      {line.compactionTokensAfter != null && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Tokens After</h3>
          <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">
            {line.compactionTokensAfter.toLocaleString()}
          </span>
        </div>
      )}
    </div>
  )
}
