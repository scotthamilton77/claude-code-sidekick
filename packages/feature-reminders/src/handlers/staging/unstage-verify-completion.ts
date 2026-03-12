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
import { logEvent } from '@sidekick/core'
import type { DaemonContext, VCUnverifiedState, EventLogContext } from '@sidekick/types'
import { ReminderEvents } from '../../events.js'
import { isDaemonContext, isHookEvent } from '@sidekick/types'
import { ReminderIds, ALL_VC_REMINDER_IDS, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'
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
        logEvent(
          daemonCtx.logger,
          ReminderEvents.reminderUnstaged(
            { sessionId: '' },
            { reminderName: ReminderIds.VERIFY_COMPLETION, hookName: 'Stop', reason: 'no_session_id' }
          )
        )
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
        const maxCycles = config.max_verification_cycles ?? -1

        daemonCtx.logger.info('VC unstage: unverified changes detected on UserPromptSubmit', {
          sessionId,
          cycleCount: unverifiedState.cycleCount,
          maxCycles,
          lastCategory: unverifiedState.lastClassification.category,
          lastConfidence: unverifiedState.lastClassification.confidence,
          setAtTurn: unverifiedState.setAt.turnCount,
          setAtToolCount: unverifiedState.setAt.toolCount,
        })

        if (maxCycles < 0 || unverifiedState.cycleCount < maxCycles) {
          // Check if any tools actually need verification before re-staging wrapper
          const verificationToolsResult = await remindersState.verificationTools.read(sessionId)
          const toolsState = verificationToolsResult.data
          const verificationTools = config.verification_tools ?? {}

          const hasToolsNeedingVerification = Object.entries(verificationTools).some(([toolName, toolConfig]) => {
            if (!toolConfig.enabled) return false
            const state = toolsState[toolName]
            if (!state) return true // never tracked = needs verification
            if (state.status === 'staged') return true
            if (state.status === 'verified' || state.status === 'cooldown') {
              return state.editsSinceVerified >= toolConfig.clearing_threshold
            }
            return false
          })

          if (!hasToolsNeedingVerification) {
            daemonCtx.logger.info('VC unstage: all tools verified, skipping wrapper re-stage', {
              sessionId,
              cycleCount: unverifiedState.cycleCount,
            })
            await remindersState.vcUnverified.delete(sessionId)
            // Fall through to delete all VC reminders
          } else {
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
              daemonCtx.logger.info('VC unstage: re-staged for next Stop', {
                sessionId,
                cycleCount: unverifiedState.cycleCount,
                lastCategory: unverifiedState.lastClassification.category,
              })
              // Don't delete - we just re-staged it
              return
            } else {
              daemonCtx.logger.warn('VC unstage: failed to resolve reminder for re-staging')
            }
          }
        } else {
          // Cycle limit reached - delete vc-unverified state
          daemonCtx.logger.info('VC unstage: cycle limit reached, clearing', {
            sessionId,
            cycleCount: unverifiedState.cycleCount,
            maxCycles,
          })
          await remindersState.vcUnverified.delete(sessionId)
        }
      } else {
        daemonCtx.logger.info('VC unstage: no unverified changes, clearing reminder', {
          sessionId,
          hadState: unverifiedState !== null,
        })
      }

      // Delete the existing staged reminders (no unverified state or limit reached)
      const eventContext: EventLogContext = { sessionId }
      const reason = unverifiedState?.hasUnverifiedChanges ? 'cycle_limit_reached' : 'no_unverified_changes'
      for (const vcId of ALL_VC_REMINDER_IDS) {
        await daemonCtx.staging.deleteReminder('Stop', vcId)
        logEvent(
          daemonCtx.logger,
          ReminderEvents.reminderUnstaged(eventContext, { reminderName: vcId, hookName: 'Stop', reason })
        )
      }
      daemonCtx.logger.debug('VC unstage: deleted all VC reminders')
    },
  })
}
