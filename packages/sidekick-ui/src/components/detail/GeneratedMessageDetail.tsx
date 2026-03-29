import type { TranscriptLine } from '../../types'

interface GeneratedMessageDetailProps {
  line: TranscriptLine
}

/** Detail view for snarky-message:finish and resume-message:finish events */
export function GeneratedMessageDetail({ line }: GeneratedMessageDetailProps) {
  return (
    <div className="p-3">
      <h3 className="text-[10px] font-medium text-slate-500 mb-1">Generated Message</h3>
      <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed italic">
        "{line.generatedMessage}"
      </p>
    </div>
  )
}
