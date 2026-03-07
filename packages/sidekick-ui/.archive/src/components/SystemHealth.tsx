/**
 * SystemHealth Component
 *
 * Displays Sidekick Daemon health metrics in a dashboard panel.
 * Shows uptime, memory usage, queue depth, active tasks, and trend sparklines.
 *
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.E System Health
 * @see docs/design/DAEMON.md §3 Status Endpoint
 */

import React from 'react'
import type { DaemonStatusWithHealth } from '@sidekick/types'
import Icon from './Icon'
import Sparkline from './Sparkline'

interface SystemHealthProps {
  /** Current daemon status */
  status: DaemonStatusWithHealth | null
  /** Whether daemon is online */
  isOnline: boolean
  /** Historical status for sparklines */
  statusHistory?: DaemonStatusWithHealth[]
  /** Loading state */
  isLoading?: boolean
}

/**
 * Format uptime seconds as "Xd Xh Xm Xs".
 */
function formatUptime(seconds: number): string {
  const days = Math.floor(seconds / 86400)
  const hours = Math.floor((seconds % 86400) / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const secs = Math.floor(seconds % 60)

  const parts: string[] = []
  if (days > 0) parts.push(`${days}d`)
  if (hours > 0) parts.push(`${hours}h`)
  if (minutes > 0) parts.push(`${minutes}m`)
  if (secs > 0 || parts.length === 0) parts.push(`${secs}s`)

  return parts.join(' ')
}

/**
 * Format bytes to human-readable size (KB/MB).
 */
function formatBytes(bytes: number): string {
  if (bytes >= 1_048_576) {
    return `${(bytes / 1_048_576).toFixed(1)} MB`
  }
  if (bytes >= 1_024) {
    return `${(bytes / 1_024).toFixed(1)} KB`
  }
  return `${bytes} B`
}

/**
 * Format duration from start time to now.
 */
function formatDuration(startTime: number): string {
  const durationMs = Date.now() - startTime
  const seconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

/**
 * Individual metric card with label and value.
 */
interface MetricCardProps {
  label: string
  value: string | number
  icon?: keyof typeof import('lucide-react/dynamicIconImports').default
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
 * Main SystemHealth component.
 */
const SystemHealth: React.FC<SystemHealthProps> = ({ status, isOnline, statusHistory = [] }) => {
  // Extract sparkline data from history
  const heapUsedHistory = statusHistory.length > 1 ? statusHistory.map((s) => s.memory.heapUsed) : undefined
  const queuePendingHistory = statusHistory.length > 1 ? statusHistory.map((s) => s.queue.pending) : undefined

  // Offline state
  if (!isOnline || !status) {
    const lastKnownTime = status?.timestamp ?? 0

    return (
      <div className="space-y-3">
        {/* Header with offline badge */}
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-2">
            <Icon name="activity" className="w-4 h-4 text-slate-400" />
            <span className="text-sm font-medium text-slate-700">System Health</span>
          </div>
          <span className="px-2 py-0.5 text-xs font-medium bg-red-100 text-red-700 rounded">Offline</span>
        </div>

        {/* Offline message */}
        <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 text-center">
          <Icon name="power-off" className="w-8 h-8 text-slate-400 mx-auto mb-2" />
          <div className="text-sm text-slate-600">Daemon Offline</div>
          {lastKnownTime > 0 && (
            <div className="text-xs text-slate-400 mt-1">Last seen: {new Date(lastKnownTime).toLocaleString()}</div>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Header with online badge */}
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Icon name="activity" className="w-4 h-4 text-emerald-500" />
          <span className="text-sm font-medium text-slate-700">System Health</span>
        </div>
        <span className="px-2 py-0.5 text-xs font-medium bg-emerald-100 text-emerald-700 rounded">Online</span>
      </div>

      {/* Uptime */}
      <MetricCard label="Uptime" value={formatUptime(status.uptimeSeconds)} icon="clock" />

      {/* Memory Usage */}
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Memory Usage</span>
          <Icon name="cpu" className="w-3.5 h-3.5 text-slate-400" />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-2">
          <div>
            <div className="text-xs text-slate-500">Heap Used</div>
            <div className="text-lg font-semibold text-blue-600">{formatBytes(status.memory.heapUsed)}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Heap Total</div>
            <div className="text-lg font-semibold text-slate-600">{formatBytes(status.memory.heapTotal)}</div>
          </div>
        </div>

        <div className="border-t border-slate-200 pt-2 mt-2">
          <div className="flex items-center justify-between text-xs">
            <span className="text-slate-500">RSS</span>
            <span className="font-medium text-slate-700">{formatBytes(status.memory.rss)}</span>
          </div>
        </div>

        {heapUsedHistory && heapUsedHistory.length > 1 && (
          <div className="mt-2 h-6">
            <Sparkline data={heapUsedHistory} height={24} color="#2563eb" />
          </div>
        )}
      </div>

      {/* Queue Depth */}
      <div className="bg-white border border-slate-200 rounded-lg p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Queue Depth</span>
          <Icon name="layers" className="w-3.5 h-3.5 text-slate-400" />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <div className="text-xs text-slate-500">Pending</div>
            <div className="text-lg font-semibold text-amber-600">{status.queue.pending}</div>
          </div>
          <div>
            <div className="text-xs text-slate-500">Active</div>
            <div className="text-lg font-semibold text-emerald-600">{status.queue.active}</div>
          </div>
        </div>

        {queuePendingHistory && queuePendingHistory.length > 1 && (
          <div className="mt-2 h-6">
            <Sparkline data={queuePendingHistory} height={24} color="#d97706" />
          </div>
        )}
      </div>

      {/* Active Tasks */}
      {status.activeTasks.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-lg p-3">
          <div className="flex items-center gap-2 mb-2">
            <Icon name="list" className="w-3.5 h-3.5 text-slate-400" />
            <span className="text-xs text-slate-500 font-medium uppercase tracking-wide">Active Tasks</span>
          </div>

          <div className="space-y-2">
            {status.activeTasks.map((task: { id: string; type: string; startTime: number }) => (
              <div
                key={task.id}
                className="flex items-center justify-between text-xs border-l-2 border-indigo-400 pl-2"
              >
                <div>
                  <div className="font-medium text-slate-700">{task.type}</div>
                  <div className="text-slate-400 font-mono text-[10px]">{task.id.slice(0, 8)}</div>
                </div>
                <div className="text-slate-500">{formatDuration(task.startTime)}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="text-xs text-slate-400 text-right px-1">
        PID: {status.pid} | v{status.version}
      </div>
    </div>
  )
}

export default SystemHealth
