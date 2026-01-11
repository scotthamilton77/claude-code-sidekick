/**
 * Standard Task Handlers Registration
 *
 * Registers handlers for the standard task types:
 * - cleanup: Prune old session data
 *
 * @see docs/design/SUPERVISOR.md §4.3 Task Execution Engine
 */

import { Logger, SidekickConfig, TaskTypes } from '@sidekick/core'
import type { MinimalAssetResolver } from '@sidekick/types'
import { createCleanupHandler } from './handlers/index.js'
import { StateManager } from './state-manager.js'
import { TaskEngine } from './task-engine.js'
import { createTaskRegistry } from './task-registry.js'

/**
 * Register standard task handlers with the TaskEngine.
 * Call this during supervisor initialization.
 */
export function registerStandardTaskHandlers(
  taskEngine: TaskEngine,
  stateManager: StateManager,
  projectDir: string,
  logger: Logger,
  _config: SidekickConfig,
  assetResolver: MinimalAssetResolver
): void {
  const taskRegistry = createTaskRegistry(stateManager, logger)

  // Create shared dependencies for all handlers
  const deps = {
    taskRegistry,
    projectDir,
    logger,
    assetResolver,
  }

  // Register infrastructure task handlers
  taskEngine.registerHandler(TaskTypes.CLEANUP, createCleanupHandler(deps))

  logger.info('Standard task handlers registered', {
    types: [TaskTypes.CLEANUP],
  })
}

// Re-export TaskRegistry and factory for use by supervisor
export { createTaskRegistry, TaskRegistry } from './task-registry.js'
