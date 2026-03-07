import { useState } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import type { StateSnapshot } from '../../types'

interface StateTabProps {
  snapshots: StateSnapshot[]
  currentTimestamp: number
}

const STATE_FILE_LABELS: Record<string, string> = {
  sessionSummary: 'session-summary.json',
  sessionPersona: 'session-persona.json',
  snarkyMessage: 'snarky-message.json',
  resumeMessage: 'resume-message.json',
  transcriptMetrics: 'transcript-metrics.json',
  llmMetrics: 'llm-metrics.json',
  summaryCountdown: 'summary-countdown.json',
}

export function StateTab({ snapshots, currentTimestamp }: StateTabProps) {
  // Find the most recent snapshot at or before the selected line
  const snapshot = findSnapshotAtTime(snapshots, currentTimestamp)

  if (!snapshot) {
    return (
      <div className="p-3">
        <p className="text-xs text-slate-400 italic">No state snapshots available at this point in time</p>
      </div>
    )
  }

  const snapshotTime = new Date(snapshot.timestamp).toLocaleTimeString('en-US', {
    hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
  })

  return (
    <div className="p-3 space-y-2">
      <div className="text-[10px] text-slate-400">
        Snapshot from <span className="font-mono">{snapshotTime}</span>
      </div>

      {Object.entries(STATE_FILE_LABELS).map(([key, label]) => {
        const data = snapshot[key as keyof StateSnapshot]
        if (key === 'timestamp' || data == null) return null
        return (
          <CollapsibleSection key={key} label={label} data={data as Record<string, unknown>} />
        )
      })}
    </div>
  )
}

function findSnapshotAtTime(snapshots: StateSnapshot[], timestamp: number): StateSnapshot | null {
  let best: StateSnapshot | null = null
  for (const snap of snapshots) {
    if (snap.timestamp <= timestamp) {
      if (!best || snap.timestamp > best.timestamp) {
        best = snap
      }
    }
  }
  return best
}

function CollapsibleSection({ label, data }: { label: string; data: Record<string, unknown> }) {
  const [open, setOpen] = useState(true)

  return (
    <div className="border border-slate-200 dark:border-slate-700 rounded">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1 w-full px-2 py-1 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
      >
        {open ? <ChevronDown size={12} className="text-slate-400" /> : <ChevronRight size={12} className="text-slate-400" />}
        <span className="text-[10px] font-medium font-mono text-slate-500">{label}</span>
      </button>
      {open && (
        <div className="px-2 py-1.5 border-t border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 overflow-auto max-h-[300px]">
          <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
            {JSON.stringify(data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
