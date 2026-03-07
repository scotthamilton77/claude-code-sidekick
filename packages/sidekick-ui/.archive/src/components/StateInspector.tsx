import React, { useState, useMemo } from 'react'
import type { UIEvent, DecisionLogFilter } from '../types'
import type { TranscriptMetrics, DaemonStatusWithHealth } from '@sidekick/types'
import Icon from './Icon'
import MetricsPanel from './MetricsPanel'
import SystemHealth from './SystemHealth'
import { DecisionLog } from './views'
import { JsonTreeViewer } from './common'
import type { ReplayState, TimeTravelStore } from '../lib/replay-engine'
import SnapshotDiffView from './SnapshotDiffView'

interface StateInspectorProps {
  /** Replay state at current scrub position */
  replayState: ReplayState
  currentTime: string
  /** Transcript metrics to display */
  metrics?: TranscriptMetrics | null
  /** Historical metrics for sparklines */
  metricsHistory?: TranscriptMetrics[]
  /** Show metrics tab */
  showMetrics?: boolean
  /** Daemon status for health tab */
  daemonStatus?: DaemonStatusWithHealth | null
  /** Daemon status history for sparklines */
  daemonStatusHistory?: DaemonStatusWithHealth[]
  /** Whether daemon is online */
  daemonIsOnline?: boolean
  /** Events for decision log */
  events?: UIEvent[]
  /** Decision log filter state */
  decisionFilter?: DecisionLogFilter
  /** Handler for filter changes */
  onDecisionFilterChange?: (filter: DecisionLogFilter) => void
  /** Handler for event selection from decision log */
  onEventSelect?: (eventId: number) => void
  /** Handler for trace selection */
  onTraceSelect?: (traceId: string) => void
  /** Current event ID for computing previous state */
  currentEventId?: number
  /** TimeTravelStore for accessing timeline */
  timeTravelStore?: TimeTravelStore
}

type TabType = 'state' | 'metrics' | 'health' | 'decisions'

const StateInspector: React.FC<StateInspectorProps> = ({
  replayState,
  currentTime,
  metrics,
  metricsHistory = [],
  showMetrics = true,
  daemonStatus,
  daemonStatusHistory = [],
  daemonIsOnline = false,
  events = [],
  decisionFilter,
  onDecisionFilterChange,
  onEventSelect,
  onTraceSelect,
  currentEventId,
  timeTravelStore,
}) => {
  const [showDiff, setShowDiff] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('state')

  // Compute previous state for Diff view
  const previousState = useMemo(() => {
    if (!timeTravelStore || currentEventId === undefined) {
      return replayState
    }

    const timeline = timeTravelStore.getTimeline()
    if (timeline.length === 0 || currentEventId === 0) {
      return replayState
    }

    // Get the previous timeline entry
    const prevIndex = Math.max(0, currentEventId - 1)
    const prevEntry = timeline[prevIndex]
    return prevEntry?.stateAfter ?? replayState
  }, [replayState, currentEventId, timeTravelStore])

  // Convert ReplayState to display-friendly JSON (with proper type coercion)
  const stateJson = useMemo(() => {
    return {
      summary: replayState.summary as Record<string, unknown>,
      metrics: {
        turnCount: replayState.metrics.turnCount,
        toolCount: replayState.metrics.toolCount,
        toolsThisTurn: replayState.metrics.toolsThisTurn,
        messageCount: replayState.metrics.messageCount,
        toolsPerTurn: replayState.metrics.toolsPerTurn,
        tokens: {
          input: replayState.metrics.tokenUsage.inputTokens,
          output: replayState.metrics.tokenUsage.outputTokens,
          total: replayState.metrics.tokenUsage.totalTokens,
        },
      },
      stagedReminders: Object.fromEntries(replayState.stagedReminders) as Record<string, unknown>,
      daemonHealth: replayState.daemonHealth as Record<string, unknown> | undefined,
    } as Record<string, unknown>
  }, [replayState])

  const previousStateJson = useMemo(() => {
    if (!previousState) return {} as Record<string, unknown>
    return {
      summary: previousState.summary as Record<string, unknown>,
      metrics: {
        turnCount: previousState.metrics.turnCount,
        toolCount: previousState.metrics.toolCount,
        toolsThisTurn: previousState.metrics.toolsThisTurn,
        messageCount: previousState.metrics.messageCount,
        toolsPerTurn: previousState.metrics.toolsPerTurn,
        tokens: {
          input: previousState.metrics.tokenUsage.inputTokens,
          output: previousState.metrics.tokenUsage.outputTokens,
          total: previousState.metrics.tokenUsage.totalTokens,
        },
      },
      stagedReminders: Object.fromEntries(previousState.stagedReminders) as Record<string, unknown>,
      daemonHealth: previousState.daemonHealth as Record<string, unknown> | undefined,
    } as Record<string, unknown>
  }, [previousState])

  return (
    <div className="w-[420px] bg-white border-l border-slate-200 flex flex-col">
      {/* Inspector Header */}
      <div className="px-4 py-3 border-b border-slate-200 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon name="cpu" className="w-4 h-4 text-slate-500" />
          <span className="text-sm font-medium text-slate-700">State Inspector</span>
        </div>

        {/* Tab selector */}
        <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
          <button
            onClick={() => setActiveTab('state')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              activeTab === 'state'
                ? 'bg-white shadow-sm text-slate-800 font-medium'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            State
          </button>
          {showMetrics && metrics && (
            <button
              onClick={() => setActiveTab('metrics')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === 'metrics'
                  ? 'bg-white shadow-sm text-slate-800 font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Metrics
            </button>
          )}
          <button
            onClick={() => setActiveTab('health')}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              activeTab === 'health'
                ? 'bg-white shadow-sm text-slate-800 font-medium'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Health
          </button>
          {decisionFilter && onDecisionFilterChange && (
            <button
              onClick={() => setActiveTab('decisions')}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                activeTab === 'decisions'
                  ? 'bg-white shadow-sm text-slate-800 font-medium'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Decisions
            </button>
          )}
        </div>

        {/* Raw/Diff toggle (only in state tab) */}
        {activeTab === 'state' && (
          <div className="flex items-center bg-slate-100 rounded-lg p-0.5">
            <button
              onClick={() => setShowDiff(false)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                !showDiff ? 'bg-white shadow-sm text-slate-800 font-medium' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Raw
            </button>
            <button
              onClick={() => setShowDiff(true)}
              className={`px-3 py-1 text-sm rounded-md transition-colors ${
                showDiff ? 'bg-white shadow-sm text-slate-800 font-medium' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              Diff
            </button>
          </div>
        )}
      </div>

      {/* Metrics Tab */}
      {activeTab === 'metrics' && metrics && (
        <div className="flex-1 overflow-y-auto p-4">
          <MetricsPanel metrics={metrics} metricsHistory={metricsHistory} showSparklines={metricsHistory.length > 1} />
        </div>
      )}

      {/* Health Tab */}
      {activeTab === 'health' && (
        <div className="flex-1 overflow-y-auto p-4">
          <SystemHealth status={daemonStatus ?? null} isOnline={daemonIsOnline} statusHistory={daemonStatusHistory} />
        </div>
      )}

      {/* Decisions Tab */}
      {activeTab === 'decisions' && decisionFilter && onDecisionFilterChange && onEventSelect && (
        <DecisionLog
          events={events}
          filter={decisionFilter}
          onFilterChange={onDecisionFilterChange}
          onEventSelect={onEventSelect}
          onTraceSelect={onTraceSelect}
        />
      )}

      {/* State Tab */}
      {activeTab === 'state' && (
        <>
          {/* File Name */}
          <div className="px-4 py-2 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <span className="text-xs font-mono text-slate-600">replay-state.json</span>
            <span className="text-xs text-slate-400">@ {currentTime}</span>
          </div>

          {/* State Content */}
          <div className="flex-1 overflow-y-auto">
            {showDiff ? (
              // Diff View - Generic computed diff
              <SnapshotDiffView previous={previousStateJson} current={stateJson} />
            ) : (
              // Raw View - Generic JSON tree viewer
              <JsonTreeViewer data={stateJson} defaultExpanded={true} />
            )}
          </div>

          {/* Stats Footer */}
          <div className="border-t border-slate-200 p-3 grid grid-cols-3 gap-3 bg-slate-50">
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-800">
                {(replayState.metrics.tokenUsage.totalTokens / 1000).toFixed(1)}k
              </p>
              <p className="text-xs text-slate-500">Tokens</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-800">{replayState.metrics.turnCount}</p>
              <p className="text-xs text-slate-500">Turns</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-800">{replayState.metrics.toolCount}</p>
              <p className="text-xs text-slate-500">Tools</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default StateInspector
