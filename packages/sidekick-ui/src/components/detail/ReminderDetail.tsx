import type { TimelineEvent } from '../../types'

interface ReminderDetailProps {
  event: TimelineEvent
}

export function ReminderDetail({ event }: ReminderDetailProps) {
  return (
    <div className="p-3 space-y-3">
      {/* Action badge */}
      <div className="flex items-center gap-2">
        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
          event.reminderAction === 'staged' ? 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400'
            : event.reminderAction === 'consumed' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-700 dark:text-slate-400'
        }`}>
          {event.reminderAction}
        </span>
        {event.reminderBlocking && (
          <span className="text-[10px] px-1.5 py-0.5 bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 rounded font-medium">
            BLOCKING
          </span>
        )}
      </div>

      {/* Hook target */}
      {event.reminderHook && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Hook Target</h3>
          <span className="text-xs font-mono text-slate-700 dark:text-slate-300">{event.reminderHook}</span>
        </div>
      )}

      {/* Priority */}
      {event.reminderPriority != null && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Priority</h3>
          <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">{event.reminderPriority}</span>
        </div>
      )}

      {/* Content */}
      {event.content && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Content</h3>
          <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">{event.content}</p>
        </div>
      )}
    </div>
  )
}
