/**
 * Staging handlers for Reminders feature (Daemon-side)
 *
 * These handlers run in the Daemon process in response to transcript events.
 * They decide when to stage reminders for CLI consumption.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { RuntimeContext } from '@sidekick/core'
import { registerStageDefaultUserPrompt } from './stage-default-user-prompt'
import { registerStagePauseAndReflect } from './stage-pause-and-reflect'
import { registerStageBashChanges } from './stage-stop-bash-changes'
import { registerTrackVerificationTools } from './track-verification-tools'
import { registerUnstageVerifyCompletion } from './unstage-verify-completion'
import { registerStagePersonaReminders } from './stage-persona-reminders'
import { registerStageUserProfileReminders } from './stage-user-profile-reminders'

/**
 * Register all staging handlers
 */
export function registerStagingHandlers(context: RuntimeContext): void {
  registerStageDefaultUserPrompt(context)
  registerStagePauseAndReflect(context)
  registerTrackVerificationTools(context)
  registerStageBashChanges(context)
  registerUnstageVerifyCompletion(context)
  registerStagePersonaReminders(context)
  registerStageUserProfileReminders(context)
}
