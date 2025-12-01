/**
 * CompactionMarker Component
 *
 * Visual marker for compaction events on the timeline.
 * Displays a scissors icon with metrics summary at compaction points.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.1 Compaction Timeline
 * @see docs/design/TRANSCRIPT-PROCESSING.md §4.2 Compaction History Schema
 */

import React from 'react'
import type { TranscriptMetrics } from '@sidekick/types'
import Icon from './Icon'

/**
 * Compaction history entry from compaction-history.json.
 */
export interface CompactionEntry {
  /** Timestamp when compaction occurred (Unix ms) */
  compactedAt: number
  /** Relative path to pre-compact snapshot */
  transcriptSnapshotPath: string
  /** Metrics at the time of compaction */
  metricsAtCompaction: TranscriptMetrics
  /** Line count after compaction */
  postCompactLineCount: number
}

interface CompactionMarkerProps {
  /** Compaction entry data */
  entry: CompactionEntry
  /** Whether this marker is currently selected */
  isSelected?: boolean
  /** Whether this marker is in the "future" relative to timeline position */
  isFuture?: boolean
  /** Click handler for selecting this compaction point */
  onClick?: () => void
  /** Compact display mode (smaller, for dense timelines) */
  compact?: boolean
  /** Class name override */
  className?: string
}

/**
 * Format timestamp for display.
 */
function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
}

/**
 * Format metrics summary for tooltip.
 */
function formatMetricsSummary(metrics: TranscriptMetrics): string {
  return [
    `Turns: ${metrics.turnCount}`,
    `Tools: ${metrics.toolCount}`,
    `Messages: ${metrics.messageCount}`,
    `Tokens: ${metrics.tokenUsage.totalTokens.toLocaleString()}`,
  ].join(' | ')
}

const CompactionMarker: React.FC<CompactionMarkerProps> = ({
  entry,
  isSelected = false,
  isFuture = false,
  onClick,
  compact = false,
  className = '',
}) => {
  const time = formatTime(entry.compactedAt)
  const summary = formatMetricsSummary(entry.metricsAtCompaction)

  if (compact) {
    return (
      <button
        onClick={onClick}
        className={`
          group relative flex items-center justify-center
          w-5 h-5 rounded-full transition-all
          ${isSelected ? 'bg-amber-100 ring-2 ring-amber-400' : 'bg-slate-100 hover:bg-amber-50'}
          ${isFuture ? 'opacity-40' : ''}
          ${className}
        `}
        title={`Compaction at ${time}\n${summary}`}
      >
        <Icon
          name="scissors"
          className={`w-3 h-3 transition-colors ${isSelected ? 'text-amber-600' : 'text-slate-500 group-hover:text-amber-500'}`}
        />
      </button>
    )
  }

  return (
    <button
      onClick={onClick}
      className={`
        group flex items-center gap-2 px-3 py-2 rounded-lg transition-all
        ${isSelected ? 'bg-amber-50 border-2 border-amber-400' : 'bg-slate-50 border border-slate-200 hover:border-amber-300 hover:bg-amber-50/50'}
        ${isFuture ? 'opacity-40' : ''}
        ${className}
      `}
    >
      <div
        className={`
        flex items-center justify-center w-8 h-8 rounded-full
        ${isSelected ? 'bg-amber-200' : 'bg-slate-200 group-hover:bg-amber-100'}
      `}
      >
        <Icon
          name="scissors"
          className={`w-4 h-4 ${isSelected ? 'text-amber-700' : 'text-slate-600 group-hover:text-amber-600'}`}
        />
      </div>
      <div className="flex-1 text-left">
        <div className="text-xs font-medium text-slate-700">Compaction</div>
        <div className="text-xs text-slate-500">{time}</div>
      </div>
      <div className="text-right">
        <div className="text-xs font-mono text-slate-600">{entry.metricsAtCompaction.turnCount} turns</div>
        <div className="text-xs text-slate-400">{entry.postCompactLineCount} lines after</div>
      </div>
    </button>
  )
}

/**
 * Inline compaction indicator for the timeline rail.
 * Smaller version that fits in the vertical timeline.
 */
export const CompactionDot: React.FC<{
  entry: CompactionEntry
  isSelected?: boolean
  isFuture?: boolean
  onClick?: () => void
}> = ({ entry, isSelected = false, isFuture = false, onClick }) => {
  const time = formatTime(entry.compactedAt)
  const summary = formatMetricsSummary(entry.metricsAtCompaction)

  return (
    <button
      onClick={onClick}
      className={`
        relative flex items-center transition-all
        ${isFuture ? 'opacity-40' : ''}
      `}
      title={`Compaction at ${time}\n${summary}`}
    >
      <div
        className={`
        w-3 h-3 rounded-sm -ml-1 transition-all flex items-center justify-center
        ${isSelected ? 'bg-amber-400 ring-2 ring-offset-1 ring-amber-400 scale-125' : 'bg-amber-300 hover:scale-125'}
      `}
      >
        <Icon name="scissors" className="w-2 h-2 text-amber-800" />
      </div>
      <span
        className={`ml-3 text-xs font-mono whitespace-nowrap ${isSelected ? 'text-amber-600 font-medium' : 'text-slate-400'}`}
      >
        {time.slice(-5)}
      </span>
    </button>
  )
}

export default CompactionMarker
