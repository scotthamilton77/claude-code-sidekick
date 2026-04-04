import type { StateSnapshot } from '../../types'
import { Collapsible } from '../Collapsible'

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
          <Collapsible key={key} label={label} labelClassName="font-mono" defaultOpen>
            <pre className="text-[11px] font-mono text-slate-700 dark:text-slate-300 leading-relaxed">
              {JSON.stringify(data, null, 2)}
            </pre>
          </Collapsible>
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

