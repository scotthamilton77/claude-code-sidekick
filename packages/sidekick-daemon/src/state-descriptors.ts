/**
 * Daemon State Descriptors
 *
 * Typed state descriptors for daemon-specific state files.
 * Used with GlobalStateAccessor for type-safe read/write operations.
 */

import { globalState } from '@sidekick/core'
import { DaemonStatusSchema, TaskRegistryStateSchema, type DaemonStatus, type TaskRegistryState } from '@sidekick/types'

/**
 * Default empty daemon status (used when file doesn't exist yet).
 * This is a factory function to ensure fresh objects on each use.
 */
const createEmptyDaemonStatus = (): DaemonStatus => ({
  timestamp: 0,
  pid: 0,
  version: '',
  uptimeSeconds: 0,
  memory: { heapUsed: 0, heapTotal: 0, rss: 0 },
  queue: { pending: 0, active: 0 },
  activeTasks: [],
})

/**
 * Default empty task registry state.
 * Factory function ensures fresh object on each use.
 */
const createEmptyTaskRegistry = (): TaskRegistryState => ({ activeTasks: [] })

/**
 * Daemon status state descriptor (global scope).
 * Written by daemon heartbeat, read by monitoring UI.
 */
export const DaemonStatusDescriptor = globalState<DaemonStatus, DaemonStatus>(
  'daemon-status.json',
  DaemonStatusSchema,
  createEmptyDaemonStatus
)

/**
 * Task registry state descriptor (global scope).
 * Tracks active tasks for orphan prevention.
 * Written/read by TaskRegistry for task tracking.
 */
export const TaskRegistryDescriptor = globalState<TaskRegistryState, TaskRegistryState>(
  'task-registry.json',
  TaskRegistryStateSchema,
  createEmptyTaskRegistry
)
