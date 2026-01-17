/**
 * Unstage verify-completion reminder when UserPromptSubmit fires
 *
 * When a user submits a new prompt, normally the verify-completion reminder is cleared.
 * However, if there are unverified source code changes (from a non-blocking classification),
 * we re-stage the reminder instead so verification can occur on the next Stop.
 *
 * @see docs/design/FEATURE-REMINDERS.md §5.3
 */
import type { RuntimeContext } from '@sidekick/core'
import type { DaemonContext, VCUnverifiedState } from '@sidekick/types'
import { isDaemonContext, isHookEvent } from '@sidekick/types'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { createRemindersState } from '../../state.js'

export function registerUnstageVerifyCompletion(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  context.handlers.register({
    id: 'reminders:unstage-verify-completion',
    priority: 45, // Before consumption handlers (50)
    filter: { kind: 'hook', hooks: ['UserPromptSubmit'] },
    handler: async (event, ctx) => {
      if (!isHookEvent(event)) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context?.sessionId

      if (!sessionId) {
        daemonCtx.logger.warn('No sessionId in UserPromptSubmit event')
        await daemonCtx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
        return
      }

      // Read vc-unverified state using typed accessor
      const remindersState = createRemindersState(daemonCtx.stateService)
      const vcResult = await remindersState.vcUnverified.read(sessionId)
      const unverifiedState: VCUnverifiedState | null = vcResult.source !== 'default' ? vcResult.data : null

      if (unverifiedState?.hasUnverifiedChanges) {
        // Check cycle limit
        const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
        const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
        const maxCycles = config.max_verification_cycles ?? 0

        if (maxCycles === 0 || unverifiedState.cycleCount < maxCycles) {
          // Re-stage verify-completion for next Stop
          const reminder = resolveReminder(ReminderIds.VERIFY_COMPLETION, {
            context: {},
            assets: daemonCtx.assets,
          })

          if (reminder) {
            // Stage with fresh metrics from current state
            await stageReminder(daemonCtx, 'Stop', {
              ...reminder,
              stagedAt: {
                timestamp: Date.now(),
                turnCount: unverifiedState.setAt.turnCount,
                toolsThisTurn: unverifiedState.setAt.toolsThisTurn,
                toolCount: unverifiedState.setAt.toolCount,
              },
            })
            daemonCtx.logger.info('Re-staged verify-completion due to unverified changes', {
              cycleCount: unverifiedState.cycleCount,
              lastCategory: unverifiedState.lastClassification.category,
            })
            // Don't delete - we just re-staged it
            return
          } else {
            daemonCtx.logger.warn('Failed to resolve verify-completion reminder for re-staging')
          }
        } else {
          // Cycle limit reached - delete vc-unverified state
          daemonCtx.logger.info('Verification cycle limit reached, not re-staging', {
            cycleCount: unverifiedState.cycleCount,
            maxCycles,
          })
          await remindersState.vcUnverified.delete(sessionId)
        }
      }

      // Delete the existing staged reminder (no unverified state or limit reached)
      await daemonCtx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
      daemonCtx.logger.debug('Unstaged verify-completion reminder on UserPromptSubmit')
    },
  })
}
