import { useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { TranscriptLine } from '../../types'

interface HookDetailProps {
  line: TranscriptLine
}

/** Threshold (chars) above which string values render in a scrollable pre block. */
const LONG_VALUE_THRESHOLD = 120

function ValueRenderer({ value }: { value: unknown }) {
  if (typeof value === 'string') {
    if (value.length > LONG_VALUE_THRESHOLD) {
      return (
        <pre className="text-[10px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-800 rounded px-2 py-1.5 max-h-[200px] overflow-x-auto overflow-y-auto">
          {value}
        </pre>
      )
    }
    return (
      <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 break-all">
        {value}
      </span>
    )
  }

  if (typeof value === 'object' && value !== null) {
    return (
      <pre className="text-[10px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed whitespace-pre-wrap break-all bg-slate-50 dark:bg-slate-800 rounded px-2 py-1.5 max-h-[200px] overflow-x-auto overflow-y-auto">
        {JSON.stringify(value, null, 2)}
      </pre>
    )
  }

  return (
    <span className="text-[10px] font-mono text-slate-700 dark:text-slate-300 break-all">
      {String(value)}
    </span>
  )
}

function KeyValueRows({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="space-y-1.5">
      {Object.entries(data).map(([key, value]) => {
        const isBlock =
          (typeof value === 'string' && value.length > LONG_VALUE_THRESHOLD) ||
          (typeof value === 'object' && value !== null)

        if (isBlock) {
          return (
            <div key={key} className="min-w-0">
              <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 block mb-0.5">{key}</span>
              <ValueRenderer value={value} />
            </div>
          )
        }

        return (
          <div key={key} className="flex gap-2 min-w-0">
            <span className="text-[10px] font-mono text-sky-600 dark:text-sky-400 shrink-0">{key}</span>
            <ValueRenderer value={value} />
          </div>
        )
      })}
    </div>
  )
}

function Collapsible({ label, open, onToggle, children }: { label: string; open: boolean; onToggle: () => void; children: ReactNode }) {
  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex items-center gap-1 w-full px-2 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        {open ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
        <span className="text-[10px] font-medium text-slate-500">{label}</span>
      </button>
      {open && (
        <div className="px-2 py-1.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-auto max-h-[300px]">
          {children}
        </div>
      )}
    </div>
  )
}

export function HookDetail({ line }: HookDetailProps) {
  const [showRawInput, setShowRawInput] = useState(false)
  const [showRawReturn, setShowRawReturn] = useState(false)

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

      {line.hookInput != null && (
        <Collapsible label="Raw Input JSON" open={showRawInput} onToggle={() => setShowRawInput(!showRawInput)}>
          {showRawInput && (
            <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(line.hookInput, null, 2)}
            </pre>
          )}
        </Collapsible>
      )}

      {line.hookReturnValue != null && (
        <Collapsible label="Raw Return JSON" open={showRawReturn} onToggle={() => setShowRawReturn(!showRawReturn)}>
          {showRawReturn && (
            <pre className="text-[10px] font-mono text-slate-600 dark:text-slate-400 leading-relaxed whitespace-pre-wrap break-all">
              {JSON.stringify(line.hookReturnValue, null, 2)}
            </pre>
          )}
        </Collapsible>
      )}
    </div>
  )
}
