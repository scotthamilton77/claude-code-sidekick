/**
 * Staging handlers for Reminders feature (Supervisor-side)
 *
 * These handlers run in the Supervisor process in response to transcript events.
 * They decide when to stage reminders for CLI consumption.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { RuntimeContext } from '@sidekick/core'
import { registerStageDefaultUserPrompt } from './stage-default-user-prompt'
import { registerStagePauseAndReflect } from './stage-pause-and-reflect'
import { registerStageStopReminders } from './stage-stop-reminders'

/**
 * Register all staging handlers
 */
export function registerStagingHandlers(context: RuntimeContext): void {
  registerStageDefaultUserPrompt(context)
  registerStagePauseAndReflect(context)
  registerStageStopReminders(context)
}
