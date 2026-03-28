import type { TranscriptLine } from '../../types'

interface HookDetailProps {
  line: TranscriptLine
}

function KeyValueRows({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([key, value]) => (
        <div key={key} className="flex gap-2 min-w-0">
          <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 shrink-0">{key}</span>
          <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 break-all">
            {typeof value === 'string' ? value : JSON.stringify(value)}
          </span>
        </div>
      ))}
    </div>
  )
}

export function HookDetail({ line }: HookDetailProps) {
  return (
    <div className="p-3 space-y-3">
      <div>
        <span className="text-[10px] px-1.5 py-0.5 rounded font-medium bg-sky-100 text-sky-700 dark:bg-sky-900/30 dark:text-sky-400">
          {line.hookName ?? 'unknown'}
        </span>
      </div>

      {line.hookInput != null ? (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Input</h3>
          <KeyValueRows data={line.hookInput} />
        </div>
      ) : line.type === 'hook:received' ? (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Input</h3>
          <p className="text-[10px] text-slate-400 italic">No input captured</p>
        </div>
      ) : null}

      {line.hookReturnValue != null ? (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Return Value</h3>
          <KeyValueRows data={line.hookReturnValue} />
        </div>
      ) : line.type === 'hook:completed' ? (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Return Value</h3>
          <p className="text-[10px] text-slate-400 italic">No response</p>
        </div>
      ) : null}

      {line.hookDurationMs != null && (
        <div>
          <h3 className="text-[10px] font-medium text-slate-500 mb-1">Duration</h3>
          <span className="text-xs tabular-nums text-slate-700 dark:text-slate-300">{line.hookDurationMs}ms</span>
        </div>
      )}
    </div>
  )
}
