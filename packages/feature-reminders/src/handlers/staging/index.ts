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
import { registerStageAreYouStuck } from './stage-are-you-stuck'
import { registerStageTimeForUpdate } from './stage-time-for-update'
import { registerStageStopReminders } from './stage-stop-reminders'

/**
 * Register all staging handlers
 */
export function registerStagingHandlers(context: RuntimeContext): void {
  registerStageDefaultUserPrompt(context)
  registerStageAreYouStuck(context)
  registerStageTimeForUpdate(context)
  registerStageStopReminders(context)
}
