/**
 * Standard Task Handlers Registration
 *
 * Registers handlers for the standard task types:
 * - cleanup: Prune old session data
 *
 * @see docs/design/DAEMON.md §4.3 Task Execution Engine
 */

import { Logger, SidekickConfig, StateService, TaskTypes } from '@sidekick/core'
import type { MinimalAssetResolver } from '@sidekick/types'
import { createCleanupHandler } from './handlers/index.js'
import { TaskEngine } from './task-engine.js'
import { TaskRegistry } from './task-registry.js'

/**
 * Register standard task handlers with the TaskEngine.
 * Call this during daemon initialization.
 */
export function registerStandardTaskHandlers(
  taskEngine: TaskEngine,
  stateService: StateService,
  projectDir: string,
  logger: Logger,
  _config: SidekickConfig,
  assetResolver: MinimalAssetResolver
): void {
  const taskRegistry = new TaskRegistry(stateService, logger)

  // Create shared dependencies for all handlers
  const deps = {
    taskRegistry,
    stateService,
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

// Re-export TaskRegistry for use by daemon
export { TaskRegistry } from './task-registry.js'
