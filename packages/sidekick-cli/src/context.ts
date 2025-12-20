/**
 * CLI Context Builder
 *
 * Converts RuntimeShell to CLIContext for consumption handler registration.
 * Implements Phase 8.5.4: CLI-side reminder consumption.
 *
 * @see docs/design/FEATURE-REMINDERS.md §4.2 Consumption Handlers
 */

import { join } from 'node:path'
import { homedir } from 'node:os'
import { HandlerRegistryImpl, SupervisorClient } from '@sidekick/core'
import type { CLIContext, HandlerContext, RuntimePaths } from '@sidekick/types'
import type { RuntimeShell } from './runtime.js'
import { registerConsumptionHandlers } from '@sidekick/feature-reminders'

export interface BuildCLIContextOptions {
  runtime: RuntimeShell
  sessionId: string
  transcriptPath?: string
}

/**
 * Build CLIContext from RuntimeShell for handler registration.
 *
 * This converts the minimal RuntimeShell (bootstrap services) into a full
 * CLIContext suitable for registering consumption handlers.
 *
 * @param options - Runtime shell, session ID, transcript path
 * @returns Fully initialized CLIContext
 */
export function buildCLIContext(options: BuildCLIContextOptions): CLIContext {
  const { runtime, sessionId, transcriptPath } = options

  // Validate projectRoot - consumption handlers require project scope for staging directories
  if (!runtime.scope.projectRoot) {
    throw new Error('Cannot build CLIContext without project root - reminder consumption requires project scope')
  }

  const projectRoot = runtime.scope.projectRoot

  const paths: RuntimePaths = {
    projectDir: projectRoot,
    userConfigDir: join(homedir(), '.sidekick'),
    projectConfigDir: join(projectRoot, '.sidekick'),
    hookScriptPath: runtime.scope.hookScriptPath,
  }

  const handlers = new HandlerRegistryImpl({
    logger: runtime.logger,
    sessionId,
    transcriptPath,
    scope: runtime.scope.scope,
  })

  const supervisor = new SupervisorClient(projectRoot, runtime.logger)

  const context: CLIContext = {
    role: 'cli',
    config: runtime.config,
    logger: runtime.logger,
    assets: runtime.assets,
    paths,
    handlers,
    supervisor,
  }

  // Wire context into handlers for invocation
  // The double-cast is required: CLIContext → unknown → HandlerContext (Record<string, unknown>)
  // This circular reference is contained within the factory to keep callers clean
  handlers.setContext(context as unknown as HandlerContext)

  return context
}

/**
 * Register CLI-side features.
 *
 * Currently registers:
 * - Reminder consumption handlers (read staged reminders, inject into hook responses)
 *
 * @param context - Fully initialized CLIContext
 */
export function registerCLIFeatures(context: CLIContext): void {
  registerConsumptionHandlers(context)
}
