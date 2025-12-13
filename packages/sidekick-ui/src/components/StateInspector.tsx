import React, { useState } from 'react'
import type { StateSnapshot, UIEvent, DecisionLogFilter } from '../types'
import type { TranscriptMetrics, SupervisorStatusWithHealth } from '@sidekick/types'
import Icon from './Icon'
import MetricsPanel from './MetricsPanel'
import SystemHealth from './SystemHealth'
import { DecisionLog } from './views'

interface StateInspectorProps {
  stateData: {
    current: StateSnapshot
    previous: StateSnapshot
  }
  currentTime: string
  /** Transcript metrics to display */
  metrics?: TranscriptMetrics | null
  /** Historical metrics for sparklines */
  metricsHistory?: TranscriptMetrics[]
  /** Show metrics tab */
  showMetrics?: boolean
  /** Supervisor status for health tab */
  supervisorStatus?: SupervisorStatusWithHealth | null
  /** Supervisor status history for sparklines */
  supervisorStatusHistory?: SupervisorStatusWithHealth[]
  /** Whether supervisor is online */
  supervisorIsOnline?: boolean
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
}

type TabType = 'state' | 'metrics' | 'health' | 'decisions'

const StateInspector: React.FC<StateInspectorProps> = ({
  stateData,
  currentTime,
  metrics,
  metricsHistory = [],
  showMetrics = true,
  supervisorStatus,
  supervisorStatusHistory = [],
  supervisorIsOnline = false,
  events = [],
  decisionFilter,
  onDecisionFilterChange,
  onEventSelect,
  onTraceSelect,
}) => {
  const [showDiff, setShowDiff] = useState(false)
  const [activeTab, setActiveTab] = useState<TabType>('state')

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
          <SystemHealth
            status={supervisorStatus ?? null}
            isOnline={supervisorIsOnline}
            statusHistory={supervisorStatusHistory}
          />
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
            <span className="text-xs font-mono text-slate-600">session-summary.json</span>
            <span className="text-xs text-slate-400">@ {currentTime}</span>
          </div>

          {/* State Content */}
          <div className="flex-1 overflow-y-auto">
            {showDiff ? (
              // Diff View - Full context with inline changes
              <div className="font-mono text-xs leading-relaxed">
                <div className="px-4 py-2 text-slate-600">{'{'}</div>
                <div className="px-4 py-1 text-slate-600 pl-8">"session_id": "{stateData.current.session_id}",</div>
                <div className="px-4 py-1 text-slate-600 pl-8">
                  "session_title": "{stateData.current.session_title}",
                </div>

                {/* Changed: session_title_confidence */}
                <div className="bg-red-50 border-l-2 border-red-400">
                  <div className="px-4 py-0.5 text-red-700 pl-8">
                    <span className="select-none text-red-400 mr-2">-</span>
                    "session_title_confidence": {stateData.previous.session_title_confidence},
                  </div>
                </div>
                <div className="bg-green-50 border-l-2 border-green-400">
                  <div className="px-4 py-0.5 text-green-700 pl-8">
                    <span className="select-none text-green-400 mr-2">+</span>
                    "session_title_confidence": {stateData.current.session_title_confidence},
                  </div>
                </div>

                {/* Changed: latest_intent */}
                <div className="bg-red-50 border-l-2 border-red-400">
                  <div className="px-4 py-0.5 text-red-700 pl-8">
                    <span className="select-none text-red-400 mr-2">-</span>
                    "latest_intent": "{stateData.previous.latest_intent}",
                  </div>
                </div>
                <div className="bg-green-50 border-l-2 border-green-400">
                  <div className="px-4 py-0.5 text-green-700 pl-8">
                    <span className="select-none text-green-400 mr-2">+</span>
                    "latest_intent": "{stateData.current.latest_intent}",
                  </div>
                </div>

                {/* Changed: latest_intent_confidence */}
                <div className="bg-red-50 border-l-2 border-red-400">
                  <div className="px-4 py-0.5 text-red-700 pl-8">
                    <span className="select-none text-red-400 mr-2">-</span>
                    "latest_intent_confidence": {stateData.previous.latest_intent_confidence},
                  </div>
                </div>
                <div className="bg-green-50 border-l-2 border-green-400">
                  <div className="px-4 py-0.5 text-green-700 pl-8">
                    <span className="select-none text-green-400 mr-2">+</span>
                    "latest_intent_confidence": {stateData.current.latest_intent_confidence},
                  </div>
                </div>

                <div className="px-4 py-1 text-slate-600 pl-8">"tokens": {'{'}</div>

                {/* Changed: tokens.input */}
                <div className="bg-red-50 border-l-2 border-red-400">
                  <div className="px-4 py-0.5 text-red-700 pl-12">
                    <span className="select-none text-red-400 mr-2">-</span>
                    "input": {stateData.previous.tokens.input},
                  </div>
                </div>
                <div className="bg-green-50 border-l-2 border-green-400">
                  <div className="px-4 py-0.5 text-green-700 pl-12">
                    <span className="select-none text-green-400 mr-2">+</span>
                    "input": {stateData.current.tokens.input},
                  </div>
                </div>

                {/* Changed: tokens.output */}
                <div className="bg-red-50 border-l-2 border-red-400">
                  <div className="px-4 py-0.5 text-red-700 pl-12">
                    <span className="select-none text-red-400 mr-2">-</span>
                    "output": {stateData.previous.tokens.output}
                  </div>
                </div>
                <div className="bg-green-50 border-l-2 border-green-400">
                  <div className="px-4 py-0.5 text-green-700 pl-12">
                    <span className="select-none text-green-400 mr-2">+</span>
                    "output": {stateData.current.tokens.output}
                  </div>
                </div>

                <div className="px-4 py-1 text-slate-600 pl-8">{'},'}</div>

                {/* Changed: cost_usd */}
                <div className="bg-red-50 border-l-2 border-red-400">
                  <div className="px-4 py-0.5 text-red-700 pl-8">
                    <span className="select-none text-red-400 mr-2">-</span>
                    "cost_usd": {stateData.previous.cost_usd},
                  </div>
                </div>
                <div className="bg-green-50 border-l-2 border-green-400">
                  <div className="px-4 py-0.5 text-green-700 pl-8">
                    <span className="select-none text-green-400 mr-2">+</span>
                    "cost_usd": {stateData.current.cost_usd},
                  </div>
                </div>

                {/* Changed: duration_sec */}
                <div className="bg-red-50 border-l-2 border-red-400">
                  <div className="px-4 py-0.5 text-red-700 pl-8">
                    <span className="select-none text-red-400 mr-2">-</span>
                    "duration_sec": {stateData.previous.duration_sec}
                  </div>
                </div>
                <div className="bg-green-50 border-l-2 border-green-400">
                  <div className="px-4 py-0.5 text-green-700 pl-8">
                    <span className="select-none text-green-400 mr-2">+</span>
                    "duration_sec": {stateData.current.duration_sec}
                  </div>
                </div>

                <div className="px-4 py-2 text-slate-600">{'}'}</div>
              </div>
            ) : (
              // Raw View
              <div className="p-4 font-mono text-xs">
                <pre className="text-slate-700 whitespace-pre-wrap">{JSON.stringify(stateData.current, null, 2)}</pre>
              </div>
            )}
          </div>

          {/* Stats Footer */}
          <div className="border-t border-slate-200 p-3 grid grid-cols-3 gap-3 bg-slate-50">
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-800">
                {(stateData.current.tokens.input + stateData.current.tokens.output) / 1000}k
              </p>
              <p className="text-xs text-slate-500">Tokens</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-800">${stateData.current.cost_usd}</p>
              <p className="text-xs text-slate-500">Cost</p>
            </div>
            <div className="text-center">
              <p className="text-lg font-semibold text-slate-800">
                {Math.floor(stateData.current.duration_sec / 60)}:
                {String(stateData.current.duration_sec % 60).padStart(2, '0')}
              </p>
              <p className="text-xs text-slate-500">Duration</p>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

export default StateInspector
