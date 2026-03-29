import { useState } from 'react'
import type { TranscriptLine } from '../../types'

interface ReminderDetailProps {
  line: TranscriptLine
}

export function ReminderDetail({ line }: ReminderDetailProps) {
  const action = line.type.split('-').pop() ?? ''
  const isConsumed = action === 'consumed'
  const [expanded, setExpanded] = useState(false)

  // For consumed reminders, content holds the rendered text from the payload
  const hasRenderedText = isConsumed && !!line.content

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          action === 'staged' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
            : isConsumed ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
        }`}>
          {action}
        </span>
        {line.reminderBlocking && (
          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded font-medium">
            BLOCKING
          </span>
        )}
      </div>

      {line.reminderId && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Reminder ID</h3>
          <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{line.reminderId}</span>
        </div>
      )}

      {hasRenderedText ? (
        <div>
          <button
            type="button"
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] font-medium text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 mb-1"
          >
            <span className="transition-transform" style={{ transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)' }}>
              &#9654;
            </span>
            Rendered Text
          </button>
          {expanded && (
            <pre className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap bg-slate-50 dark:bg-slate-800/50 rounded p-2 max-h-64 overflow-y-auto">
              {line.content}
            </pre>
          )}
        </div>
      ) : line.content && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Content</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{line.content}</p>
        </div>
      )}
    </div>
  )
}
