/**
 * MetricsPanel Component
 *
 * Displays TranscriptMetrics in a dashboard-style panel within the State Inspector.
 * Shows turn-level and session-level metrics with token usage breakdown.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §4.2 TranscriptMetrics
 * @see docs/design/TRANSCRIPT-PROCESSING.md §3.1 TranscriptMetrics Schema
 */

import React from 'react'
import type { TranscriptMetrics } from '@sidekick/types'
import Icon from './Icon'
import Sparkline from './Sparkline'

interface MetricsPanelProps {
  /** Current transcript metrics */
  metrics: TranscriptMetrics
  /** Historical metrics for sparklines (optional) */
  metricsHistory?: TranscriptMetrics[]
  /** Whether to show sparklines (requires history) */
  showSparklines?: boolean
}

/**
 * Format large numbers with K/M suffix for display.
 */
function formatNumber(n: number): string {
  if (n >= 1_000_000) {
    return `${(n / 1_000_000).toFixed(1)}M`
  }
  if (n >= 1_000) {
    return `${(n / 1_000).toFixed(1)}K`
  }
  return n.toString()
}

/**
 * Format ratio to one decimal place.
 */
function formatRatio(n: number): string {
  return n.toFixed(1)
}

/**
 * Individual metric card with label and value.
 */
interface MetricCardProps {
  label: string
  value: string | number
  icon?: 'message-circle' | 'wrench' | 'layers' | 'message-square' | 'trending-up' | 'file-text' | 'zap' | 'activity'
  sublabel?: string
  sparklineData?: number[]
  className?: string
}

const MetricCard: React.FC<MetricCardProps> = ({ label, value, icon, sublabel, sparklineData, className = '' }) => (
  <div className={`bg-white border border-slate-200 rounded-lg p-3 ${className}`}>
    <div className="flex items-center justify-between mb-1">
      <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">{label}</span>
      {icon && <Icon name={icon} className="w-3.5 h-3.5 text-slate-400" />}
    </div>
    <div className="flex items-end gap-2">
      <span className="text-xl font-semibold text-slate-800">{value}</span>
      {sublabel && <span className="text-xs text-slate-400 mb-0.5">{sublabel}</span>}
    </div>
    {sparklineData && sparklineData.length > 1 && (
      <div className="mt-2 h-6">
        <Sparkline data={sparklineData} height={24} />
      </div>
    )}
  </div>
)

/**
 * Token usage breakdown section.
 */
interface TokenSectionProps {
  tokenUsage: TranscriptMetrics['tokenUsage']
}

const TokenSection: React.FC<TokenSectionProps> = ({ tokenUsage }) => {
  const cacheHitRate =
    tokenUsage.cacheReadInputTokens > 0 && tokenUsage.inputTokens > 0
      ? ((tokenUsage.cacheReadInputTokens / tokenUsage.inputTokens) * 100).toFixed(0)
      : '0'

  return (
    <div className="bg-slate-50 rounded-lg p-3">
      <div className="flex items-center gap-2 mb-3">
        <Icon name="zap" className="w-4 h-4 text-amber-500" />
        <span className="text-sm font-medium text-slate-700">Token Usage</span>
      </div>

      <div className="grid grid-cols-3 gap-3 mb-3">
        <div>
          <div className="text-xs text-slate-500">Input</div>
          <div className="text-lg font-semibold text-blue-600">{formatNumber(tokenUsage.inputTokens)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Output</div>
          <div className="text-lg font-semibold text-emerald-600">{formatNumber(tokenUsage.outputTokens)}</div>
        </div>
        <div>
          <div className="text-xs text-slate-500">Total</div>
          <div className="text-lg font-semibold text-slate-800">{formatNumber(tokenUsage.totalTokens)}</div>
        </div>
      </div>

      {/* Cache metrics */}
      <div className="border-t border-slate-200 pt-2 mt-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-slate-500">Cache hit rate</span>
          <span className="font-medium text-slate-700">{cacheHitRate}%</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-slate-500">Cache reads</span>
          <span className="font-medium text-slate-700">{formatNumber(tokenUsage.cacheReadInputTokens)}</span>
        </div>
        <div className="flex items-center justify-between text-xs mt-1">
          <span className="text-slate-500">Cache writes</span>
          <span className="font-medium text-slate-700">{formatNumber(tokenUsage.cacheCreationInputTokens)}</span>
        </div>
      </div>

      {/* Per-model breakdown if multiple models */}
      {Object.keys(tokenUsage.byModel).length > 1 && (
        <div className="border-t border-slate-200 pt-2 mt-2">
          <div className="text-xs text-slate-500 mb-1">By Model</div>
          {Object.entries(tokenUsage.byModel).map(([model, stats]) => (
            <div key={model} className="flex items-center justify-between text-xs mt-1">
              <span className="text-slate-600 font-mono truncate max-w-[120px]">{model}</span>
              <span className="text-slate-700">
                {formatNumber(stats.inputTokens + stats.outputTokens)} ({stats.requestCount} req)
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/**
 * Main MetricsPanel component.
 */
const MetricsPanel: React.FC<MetricsPanelProps> = ({ metrics, metricsHistory = [], showSparklines = false }) => {
  // Extract sparkline data from history
  const turnHistory = showSparklines ? metricsHistory.map((m) => m.turnCount) : undefined
  const toolHistory = showSparklines ? metricsHistory.map((m) => m.toolCount) : undefined
  const messageHistory = showSparklines ? metricsHistory.map((m) => m.messageCount) : undefined

  return (
    <div className="space-y-3">
      {/* Section header */}
      <div className="flex items-center gap-2 px-1">
        <Icon name="activity" className="w-4 h-4 text-indigo-500" />
        <span className="text-sm font-medium text-slate-700">Transcript Metrics</span>
      </div>

      {/* Turn-level metrics */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Turns" value={metrics.turnCount} icon="message-circle" sparklineData={turnHistory} />
        <MetricCard label="Tools This Turn" value={metrics.toolsThisTurn} icon="wrench" />
      </div>

      {/* Session-level metrics */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Total Tools" value={metrics.toolCount} icon="layers" sparklineData={toolHistory} />
        <MetricCard
          label="Messages"
          value={metrics.messageCount}
          icon="message-square"
          sparklineData={messageHistory}
        />
      </div>

      {/* Derived metrics */}
      <div className="grid grid-cols-2 gap-2">
        <MetricCard label="Tools/Turn" value={formatRatio(metrics.toolsPerTurn)} sublabel="avg" icon="trending-up" />
        <MetricCard label="Last Line" value={metrics.lastProcessedLine} icon="file-text" />
      </div>

      {/* Token usage section */}
      <TokenSection tokenUsage={metrics.tokenUsage} />

      {/* Watermark info */}
      {metrics.lastUpdatedAt > 0 && (
        <div className="text-xs text-slate-400 text-right px-1">
          Updated: {new Date(metrics.lastUpdatedAt).toLocaleTimeString()}
        </div>
      )}
    </div>
  )
}

export default MetricsPanel
