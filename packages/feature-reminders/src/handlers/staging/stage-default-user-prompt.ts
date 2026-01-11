/**
 * Stage default UserPromptSubmit reminder on SessionStart and BulkProcessingComplete
 *
 * Two entry points ensure the reminder is staged:
 * 1. SessionStart: Normal session initialization (startup, resume, clear)
 * 2. BulkProcessingComplete: Mid-session supervisor restart after state cleanup
 *    (e.g., dev-mode.sh clean-all removes staging directory, then supervisor
 *    restarts and reconstructs transcript - SessionStart doesn't fire mid-session)
 *
 * @see docs/design/FEATURE-REMINDERS.md §5.1
 */
import type { RuntimeContext } from '@sidekick/core'
import { isHookEvent, isSessionStartEvent, isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds } from '../../types.js'

export function registerStageDefaultUserPrompt(context: RuntimeContext): void {
  // Handler 1: Stage on SessionStart (normal flow)
  createStagingHandler(context, {
    id: 'reminders:stage-default-user-prompt',
    priority: 50,
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    execute: (event) => {
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return undefined

      // Stage on every session start (startup, resume, or clear)
      return {
        reminderId: ReminderIds.USER_PROMPT_SUBMIT,
        targetHook: 'UserPromptSubmit',
        skipIfExists: false, // Always stage on session start
      }
    },
  })

  // Handler 2: Stage after bulk transcript reconstruction (mid-session restart)
  // This handles the case where supervisor restarts without a SessionStart event
  // (e.g., after dev-mode.sh clean-all removes the staging directory)
  createStagingHandler(context, {
    id: 'reminders:stage-default-user-prompt-after-bulk',
    priority: 50,
    filter: { kind: 'transcript', eventTypes: ['BulkProcessingComplete'] },
    execute: (event) => {
      if (!isTranscriptEvent(event)) return undefined

      // Only stage if not already present (SessionStart may have already staged it)
      return {
        reminderId: ReminderIds.USER_PROMPT_SUBMIT,
        targetHook: 'UserPromptSubmit',
        skipIfExists: true, // Don't duplicate if SessionStart already staged
      }
    },
  })
}
