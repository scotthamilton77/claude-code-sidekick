/**
 * Standard Task Handlers Registration
 *
 * Registers handlers for the standard task types:
 * - session_summary: Generate session summary (placeholder, actual logic in Phase 6)
 * - resume_generation: Generate resume message (placeholder, actual logic in Phase 6)
 * - cleanup: Prune old session data
 * - metrics_persist: Persist TranscriptService metrics
 * - first_prompt_summary: Generate first-prompt snarky message
 *
 * @see docs/design/SUPERVISOR.md §4.3 Task Execution Engine
 * @see docs/ROADMAP.md Phase 5.2.1
 */

import {
  DEFAULT_FIRST_PROMPT_CONFIG,
  FirstPromptConfigSchema,
  Logger,
  SidekickConfig,
  TaskTypes,
  type FirstPromptConfig,
} from '@sidekick/core'
import {
  createCleanupHandler,
  createFirstPromptSummaryHandler,
  createMetricsPersistHandler,
  createResumeGenerationHandler,
  createSessionSummaryHandler,
} from './handlers/index.js'
import { StateManager } from './state-manager.js'
import { TaskEngine } from './task-engine.js'
import { createTaskRegistry } from './task-registry.js'

/**
 * Get first-prompt config from features config, with validation and defaults.
 * Exported for use by supervisor.ts handleUserPromptSubmit.
 * // FIXME this adds a responsibility to this class that doesn't belong here
 */
export function getFirstPromptConfig(config: SidekickConfig, logger: Logger): FirstPromptConfig {
  const featureConfig = config.features['first-prompt']
  if (!featureConfig) {
    return DEFAULT_FIRST_PROMPT_CONFIG
  }

  const result = FirstPromptConfigSchema.safeParse(featureConfig.settings)
  if (!result.success) {
    logger.warn('Invalid first-prompt config in features, using defaults', {
      errors: result.error.issues,
    })
    return DEFAULT_FIRST_PROMPT_CONFIG
  }

  return {
    ...result.data,
    enabled: featureConfig.enabled && result.data.enabled,
  }
}

/**
 * Register standard task handlers with the TaskEngine.
 * Call this during supervisor initialization.
 */
export function registerStandardTaskHandlers(
  taskEngine: TaskEngine,
  stateManager: StateManager,
  projectDir: string,
  logger: Logger,
  config: SidekickConfig
): void {
  const taskRegistry = createTaskRegistry(stateManager, logger)

  // Create shared dependencies for all handlers
  const deps = {
    taskRegistry,
    projectDir,
    logger,
  }

  // Get first-prompt config from features
  const firstPromptConfig = getFirstPromptConfig(config, logger)

  // Register all handlers
  // NOTE: Placeholder handlers for Phase 5. In Phase 6, features will
  // self-register their task handlers via context.tasks.registerHandler().
  // Only infrastructure tasks (cleanup, metrics_persist) will remain here.
  taskEngine.registerHandler(TaskTypes.SESSION_SUMMARY, createSessionSummaryHandler(deps))
  taskEngine.registerHandler(TaskTypes.RESUME_GENERATION, createResumeGenerationHandler(deps))
  taskEngine.registerHandler(TaskTypes.CLEANUP, createCleanupHandler(deps))
  taskEngine.registerHandler(TaskTypes.METRICS_PERSIST, createMetricsPersistHandler(deps))
  taskEngine.registerHandler(
    TaskTypes.FIRST_PROMPT_SUMMARY,
    createFirstPromptSummaryHandler({ ...deps, config: firstPromptConfig })
  )

  logger.info('Standard task handlers registered', {
    types: Object.values(TaskTypes),
  })
}

// Re-export TaskRegistry and factory for use by supervisor
export { createTaskRegistry, TaskRegistry } from './task-registry.js'
