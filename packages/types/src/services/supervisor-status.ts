/**
 * Supervisor Status Types
 *
 * Types for the supervisor heartbeat status written to `.sidekick/state/supervisor-status.json`.
 * Used by the monitoring UI to display system health and detect offline state.
 *
 * @see docs/design/SUPERVISOR.md §4.6 Heartbeat Mechanism
 * @see packages/sidekick-ui/docs/MONITORING-UI.md §3.2.E System Health
 */

/**
 * Memory usage metrics from Node.js process.memoryUsage().
 */
export interface SupervisorMemoryMetrics {
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
export interface SupervisorQueueMetrics {
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
 * Supervisor status written to state/supervisor-status.json.
 * Updated every 5 seconds by the heartbeat mechanism.
 *
 * @see docs/design/SUPERVISOR.md §4.6 Heartbeat Mechanism
 */
export interface SupervisorStatus {
  /** Unix timestamp (ms) of last heartbeat write */
  timestamp: number
  /** Supervisor process ID */
  pid: number
  /** Sidekick version string */
  version: string
  /** Seconds since supervisor started */
  uptimeSeconds: number
  /** Memory usage metrics */
  memory: SupervisorMemoryMetrics
  /** Task queue status */
  queue: SupervisorQueueMetrics
  /** Currently executing tasks */
  activeTasks: ActiveTaskInfo[]
}

/**
 * Extended supervisor status with UI-computed fields.
 * Includes offline detection based on timestamp staleness.
 */
export interface SupervisorStatusWithHealth extends SupervisorStatus {
  /** Whether the supervisor is online (timestamp within threshold) */
  isOnline: boolean
  /** File mtime from the filesystem */
  fileMtime?: number
}
