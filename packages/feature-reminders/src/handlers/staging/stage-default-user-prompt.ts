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

      // Only stage on startup or clear (fresh session)
      if (event.payload.startType !== 'startup' && event.payload.startType !== 'clear') {
        return undefined
      }

      return {
        reminderId: ReminderIds.USER_PROMPT_SUBMIT,
        targetHook: 'UserPromptSubmit',
        skipIfExists: false, // Always stage on session start
      }
    },
  })
}
