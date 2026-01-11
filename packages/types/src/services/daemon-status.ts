/**
 * Daemon Status Types
 *
 * Types for the daemon heartbeat status written to `.sidekick/state/daemon-status.json`.
 * Used by the monitoring UI to display system health and detect offline state.
 *
 * @see docs/design/DAEMON.md §4.6 Heartbeat Mechanism
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.E System Health
 */

/**
 * Memory usage metrics from Node.js process.memoryUsage().
 */
export interface DaemonMemoryMetrics {
  /** V8 heap used in bytes */
  heapUsed: number
  /** V8 heap total in bytes */
  heapTotal: number
  /** Resident Set Size in bytes */
  rss: number
}

/**
 * Task queue status for pending and active tasks.
 */
export interface DaemonQueueMetrics {
  /** Number of tasks waiting in queue */
  pending: number
  /** Number of tasks currently executing */
  active: number
}

/**
 * Active task information for monitoring.
 */
export interface ActiveTaskInfo {
  /** Unique task identifier */
  id: string
  /** Task type (session_summary, resume_generation, cleanup, metrics_persist) */
  type: string
  /** Unix timestamp (ms) when task started */
  startTime: number
}

/**
 * Daemon status written to state/daemon-status.json.
 * Updated every 5 seconds by the heartbeat mechanism.
 *
 * @see docs/design/DAEMON.md §4.6 Heartbeat Mechanism
 */
export interface DaemonStatus {
  /** Unix timestamp (ms) of last heartbeat write */
  timestamp: number
  /** Daemon process ID */
  pid: number
  /** Sidekick version string */
  version: string
  /** Seconds since daemon started */
  uptimeSeconds: number
  /** Memory usage metrics */
  memory: DaemonMemoryMetrics
  /** Task queue status */
  queue: DaemonQueueMetrics
  /** Currently executing tasks */
  activeTasks: ActiveTaskInfo[]
}

/**
 * Extended daemon status with UI-computed fields.
 * Includes offline detection based on timestamp staleness.
 */
export interface DaemonStatusWithHealth extends DaemonStatus {
  /** Whether the daemon is online (timestamp within threshold) */
  isOnline: boolean
  /** File mtime from the filesystem */
  fileMtime?: number
}
