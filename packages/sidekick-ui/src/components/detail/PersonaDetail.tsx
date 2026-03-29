import type { TranscriptLine } from '../../types'

interface PersonaDetailProps {
  line: TranscriptLine
}

/** Detail view for persona:selected and persona:changed events */
export function PersonaDetail({ line }: PersonaDetailProps) {
  return (
    <div className="p-3 space-y-2">
      {line.personaFrom && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">From</h3>
          <p className="text-xs text-slate-500">{line.personaFrom}</p>
        </div>
      )}
      {line.personaTo && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">To</h3>
          <p className="text-xs font-medium text-pink-600 dark:text-pink-400">{line.personaTo}</p>
        </div>
      )}
    </div>
  )
}
