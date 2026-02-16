/**
 * Reminders Feature
 *
 * Context-aware prompts injected at specific intervals or events.
 * Uses staging/consumption pattern where Daemon stages reminders
 * and CLI consumes them.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { Feature, FeatureManifest, RuntimeContext } from '@sidekick/core'
import { registerStagingHandlers } from './handlers/staging'
import { registerConsumptionHandlers } from './handlers/consumption'

export const manifest: FeatureManifest = {
  id: 'reminders',
  version: '0.0.0',
  description: 'Context-aware prompts at specific intervals or events',
  needs: [], // No dependencies on other features
}

export function register(context: RuntimeContext): void {
  // Register staging handlers (runs in Daemon, transcript events)
  registerStagingHandlers(context)

  // Register consumption handlers (runs in CLI, hook events)
  registerConsumptionHandlers(context)
}

// Default export for dynamic loading
const feature: Feature = { manifest, register }
export default feature

// Re-export types and utilities
export * from './types'
export * from './reminder-utils'

// Re-export consumption handlers for CLI use
export { registerConsumptionHandlers } from './handlers/consumption'

// Re-export staging handlers for Daemon use
export { registerStagingHandlers } from './handlers/staging'

// Re-export persona staging for daemon persona-change wiring
export { stagePersonaRemindersForSession } from './handlers/staging/stage-persona-reminders'

// Re-export completion classifier for IPC use
export {
  classifyCompletion,
  type ClassifyCompletionOptions,
  type ClassifyCompletionResult,
} from './completion-classifier'

// Re-export IPC handlers for Daemon use
export {
  handleReminderConsumed,
  handleVCUnverifiedSet,
  handleVCUnverifiedClear,
  type IPCHandlerContext,
  type IPCLogger,
  type ReminderConsumedParams,
  type VCUnverifiedSetParams,
  type VCUnverifiedClearParams,
} from './handlers/ipc'

// Re-export event factories for logging
export { ReminderEvents, type EventLogContext as ReminderEventLogContext } from './events.js'

// Re-export orchestrator for cross-reminder coordination
// Types ReminderRef and CoordinationMetrics are available from @sidekick/types
export { ReminderOrchestrator, type ReminderOrchestratorDeps } from './orchestrator.js'

// Re-export state accessors for orchestrator dependencies
export { createRemindersState, type RemindersStateAccessors } from './state.js'
