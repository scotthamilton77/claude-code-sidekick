import type { TranscriptLine } from '../../types'

interface ReminderDetailProps {
  line: TranscriptLine
}

export function ReminderDetail({ line }: ReminderDetailProps) {
  const action = line.type.split('-').pop() ?? ''

  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          action === 'staged' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
            : action === 'consumed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
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

      {line.content && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Content</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{line.content}</p>
        </div>
      )}
    </div>
  )
}
