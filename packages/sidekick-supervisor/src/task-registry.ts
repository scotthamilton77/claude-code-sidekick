/**
 * Task Registry for Orphan Prevention
 *
 * Tracks active tasks in state file so orphaned tasks from crashed
 * supervisor runs can be detected and cleaned on restart.
 *
 * @see docs/design/SUPERVISOR.md §4.3 Task Execution Engine
 * @see docs/ROADMAP.md Phase 5.2
 */

import { Logger, TaskRegistryState, TrackedTask } from '@sidekick/core'
import { StateManager } from './state-manager.js'

/** Task registry state file name */
const TASK_REGISTRY_FILE = 'task-registry'

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
 * supervisor runs can be detected and cleaned on restart.
 */
export class TaskRegistry {
  private stateManager: StateManager
  private logger: Logger

  constructor(stateManager: StateManager, logger: Logger) {
    this.stateManager = stateManager
    this.logger = logger
  }

  /**
   * Load current task registry state.
   *
   * Returns a deep copy - safe to read without affecting internal state.
   */
  getState(): TaskRegistryState {
    return structuredClone(this.getRawState())
  }

  /**
   * Load raw state reference for internal read-modify-write operations.
   * Single-writer assumption guaranteed by Supervisor architecture.
   */
  private getRawState(): TaskRegistryState {
    const state = this.stateManager.get(TASK_REGISTRY_FILE) as TaskRegistryState | undefined
    return state ?? { activeTasks: [] }
  }

  /**
   * Track a new task as active.
   */
  async trackTask(task: TrackedTask): Promise<void> {
    const state = this.getRawState()
    state.activeTasks.push(task)
    await this.stateManager.update(TASK_REGISTRY_FILE, state as unknown as Record<string, unknown>)
    this.logger.debug('Task tracked', { taskId: task.id, type: task.type })
  }

  /**
   * Mark a task as started (update startedAt timestamp).
   */
  async markTaskStarted(taskId: string): Promise<void> {
    const state = this.getState()
    const task = state.activeTasks.find((t) => t.id === taskId)
    if (task) {
      task.startedAt = Date.now()
      await this.stateManager.update(TASK_REGISTRY_FILE, state as unknown as Record<string, unknown>)
    }
  }

  /**
   * Remove a task from tracking (completed or failed).
   */
  async untrackTask(taskId: string): Promise<void> {
    const state = this.getState()
    state.activeTasks = state.activeTasks.filter((t) => t.id !== taskId)
    await this.stateManager.update(TASK_REGISTRY_FILE, state as unknown as Record<string, unknown>)
    this.logger.debug('Task untracked', { taskId })
  }

  /**
   * Update last cleanup timestamp.
   */
  async updateLastCleanup(): Promise<void> {
    const state = this.getState()
    state.lastCleanupAt = Date.now()
    await this.stateManager.update(TASK_REGISTRY_FILE, state as unknown as Record<string, unknown>)
  }

  /**
   * Clean up orphaned tasks from previous supervisor runs.
   * Called on supervisor startup to reset task registry.
   *
   * Per ROADMAP Phase 5.2: Tasks tracked in state, cleaned on supervisor restart.
   */
  async cleanupOrphans(): Promise<number> {
    const state = this.getState()
    const orphanCount = state.activeTasks.length

    if (orphanCount > 0) {
      this.logger.warn('Cleaning up orphaned tasks from previous run', {
        orphanCount,
        orphanedTasks: state.activeTasks.map((t) => ({ id: t.id, type: t.type })),
      })

      // Reset task registry
      await this.stateManager.update(TASK_REGISTRY_FILE, {
        activeTasks: [],
        lastCleanupAt: state.lastCleanupAt,
      })
    }

    return orphanCount
  }
}

/**
 * Create a TaskRegistry instance for use with the supervisor.
 */
export function createTaskRegistry(stateManager: StateManager, logger: Logger): TaskRegistry {
  return new TaskRegistry(stateManager, logger)
}
