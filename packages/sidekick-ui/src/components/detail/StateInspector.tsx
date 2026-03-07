import { useState } from 'react'
import type { TimelineEvent } from '../../types'

interface StateInspectorProps {
  event: TimelineEvent
}

export function StateInspector({ event }: StateInspectorProps) {
  const [mode, setMode] = useState<'raw' | 'diff'>('raw')
  const hasSnapshot = event.stateSnapshot != null
  const hasPrevious = event.previousSnapshot != null

  return (
    <div className="p-3 space-y-3">
      {/* Confidence */}
      {event.confidence != null && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-500">Confidence:</span>
          <div className={`w-2.5 h-2.5 rounded-full ${
            event.confidence > 0.8 ? 'bg-emerald-400' : event.confidence >= 0.5 ? 'bg-amber-400' : 'bg-red-400'
          }`} />
          <span className="text-xs font-medium text-slate-700 dark:text-slate-300">
            {Math.round(event.confidence * 100)}%
          </span>
        </div>
      )}

      {/* Raw / Diff toggle */}
      {hasPrevious && (
        <div className="flex gap-1">
          <button
            onClick={() => setMode('raw')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              mode === 'raw'
                ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Raw
          </button>
          <button
            onClick={() => setMode('diff')}
            className={`px-2 py-0.5 rounded text-[10px] font-medium ${
              mode === 'diff'
                ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                : 'text-slate-400 hover:text-slate-600'
            }`}
          >
            Diff
          </button>
        </div>
      )}

      {/* Content */}
      {mode === 'raw' && hasSnapshot && (
        <pre className="text-[11px] font-mono bg-slate-50 dark:bg-slate-800 p-3 rounded overflow-auto max-h-[400px] text-slate-700 dark:text-slate-300 leading-relaxed">
          {JSON.stringify(event.stateSnapshot, null, 2)}
        </pre>
      )}

      {mode === 'diff' && hasPrevious && hasSnapshot && (
        <SimpleDiff prev={event.previousSnapshot!} next={event.stateSnapshot!} />
      )}

      {!hasSnapshot && (
        <p className="text-xs text-slate-400 italic">No state snapshot available</p>
      )}
    </div>
  )
}

function SimpleDiff({ prev, next }: { prev: Record<string, unknown>; next: Record<string, unknown> }) {
  const prevLines = JSON.stringify(prev, null, 2).split('\n')
  const nextLines = JSON.stringify(next, null, 2).split('\n')
  const maxLen = Math.max(prevLines.length, nextLines.length)

  return (
    <pre className="text-[11px] font-mono bg-slate-50 dark:bg-slate-800 p-3 rounded overflow-auto max-h-[400px] leading-relaxed">
      {Array.from({ length: maxLen }, (_, i) => {
        const pl = prevLines[i] ?? ''
        const nl = nextLines[i] ?? ''
        if (pl === nl) {
          return <div key={i} className="text-slate-500">{nl}</div>
        }
        return (
          <div key={i}>
            {pl && <div className="text-red-500 bg-red-50 dark:bg-red-950/30 -mx-3 px-3">- {pl}</div>}
            {nl && <div className="text-emerald-600 bg-emerald-50 dark:bg-emerald-950/30 -mx-3 px-3">+ {nl}</div>}
          </div>
        )
      })}
    </pre>
  )
}
