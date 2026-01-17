/**
 * Task Registry for Orphan Prevention
 *
 * Tracks active tasks in state file so orphaned tasks from crashed
 * daemon runs can be detected and cleaned on restart.
 *
 * @see docs/design/DAEMON.md §4.3 Task Execution Engine
 */

import { GlobalStateAccessor, Logger, StateService } from '@sidekick/core'
import type { TaskRegistryState, TrackedTask } from '@sidekick/types'
import { TaskRegistryDescriptor } from './state-descriptors.js'

/** Session ID validation pattern: alphanumeric, hyphens, underscores */
const SESSION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/

/**
 * Validate session ID format.
 *
 * Ensures session IDs are safe for use in file paths and prevent
 * path traversal vulnerabilities.
 *
 * @throws {Error} If sessionId is empty or contains invalid characters
 */
export function validateSessionId(sessionId: string): void {
  if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
    throw new Error(`Invalid sessionId format: ${sessionId}`)
  }
}

/**
 * Task Registry for orphan prevention.
 *
 * Tracks active tasks in state file so orphaned tasks from crashed
 * daemon runs can be detected and cleaned on restart.
 */
export class TaskRegistry {
  private readonly accessor: GlobalStateAccessor<TaskRegistryState, TaskRegistryState>
  private readonly logger: Logger

  constructor(stateService: StateService, logger: Logger) {
    this.accessor = new GlobalStateAccessor(stateService, TaskRegistryDescriptor)
    this.logger = logger
  }

  /**
   * Load current task registry state.
   *
   * Returns a deep copy - safe to read without affecting internal state.
   */
  async getState(): Promise<TaskRegistryState> {
    const result = await this.accessor.read()
    return structuredClone(result.data)
  }

  /**
   * Track a new task as active.
   */
  async trackTask(task: TrackedTask): Promise<void> {
    const state = await this.getState()
    state.activeTasks.push(task)
    await this.accessor.write(state)
    this.logger.debug('Task tracked', { taskId: task.id, type: task.type })
  }

  /**
   * Mark a task as started (update startedAt timestamp).
   */
  async markTaskStarted(taskId: string): Promise<void> {
    const state = await this.getState()
    const task = state.activeTasks.find((t) => t.id === taskId)
    if (task) {
      task.startedAt = Date.now()
      await this.accessor.write(state)
    }
  }

  /**
   * Remove a task from tracking (completed or failed).
   */
  async untrackTask(taskId: string): Promise<void> {
    const state = await this.getState()
    state.activeTasks = state.activeTasks.filter((t) => t.id !== taskId)
    await this.accessor.write(state)
    this.logger.debug('Task untracked', { taskId })
  }

  /**
   * Update last cleanup timestamp.
   */
  async updateLastCleanup(): Promise<void> {
    const state = await this.getState()
    state.lastCleanupAt = Date.now()
    await this.accessor.write(state)
  }

  /**
   * Clean up orphaned tasks from previous daemon runs.
   * Called on daemon startup to reset task registry.
   *
   * Per ROADMAP Phase 5.2: Tasks tracked in state, cleaned on daemon restart.
   */
  async cleanupOrphans(): Promise<number> {
    const state = await this.getState()
    const orphanCount = state.activeTasks.length

    if (orphanCount > 0) {
      this.logger.warn('Cleaning up orphaned tasks from previous run', {
        orphanCount,
        orphanedTasks: state.activeTasks.map((t) => ({ id: t.id, type: t.type })),
      })

      // Reset task registry
      await this.accessor.write({ activeTasks: [], lastCleanupAt: state.lastCleanupAt })
    }

    return orphanCount
  }
}
