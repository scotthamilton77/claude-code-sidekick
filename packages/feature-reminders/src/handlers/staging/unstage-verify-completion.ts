/**
 * Unstage verify-completion reminder when UserPromptSubmit fires
 *
 * When a user submits a new prompt, the previous task context is considered
 * complete and the verify-completion reminder should be cleared.
 *
 * @see docs/design/FEATURE-REMINDERS.md §5.3
 */
import type { RuntimeContext } from '@sidekick/core'
import type { SupervisorContext } from '@sidekick/types'
import { isSupervisorContext, isHookEvent } from '@sidekick/types'
import { ReminderIds } from '../../types.js'

export function registerUnstageVerifyCompletion(context: RuntimeContext): void {
  if (!isSupervisorContext(context)) return

  context.handlers.register({
    id: 'reminders:unstage-verify-completion',
    priority: 45, // Before consumption handlers (50)
    filter: { kind: 'hook', hooks: ['UserPromptSubmit'] },
    handler: async (event, ctx) => {
      if (!isHookEvent(event)) return
      if (!isSupervisorContext(ctx as unknown as RuntimeContext)) return

      const supervisorCtx = ctx as unknown as SupervisorContext

      // Delete verify-completion from Stop hook - new prompt means previous task context is done
      await supervisorCtx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
      supervisorCtx.logger.debug('Unstaged verify-completion reminder on UserPromptSubmit')
    },
  })
}
