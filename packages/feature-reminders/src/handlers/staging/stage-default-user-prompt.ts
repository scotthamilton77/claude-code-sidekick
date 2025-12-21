/**
 * Stage default UserPromptSubmit reminder on SessionStart
 * @see docs/design/FEATURE-REMINDERS.md §5.1
 */
import type { RuntimeContext } from '@sidekick/core'
import { isHookEvent, isSessionStartEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds } from '../../types.js'

export function registerStageDefaultUserPrompt(context: RuntimeContext): void {
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
}
