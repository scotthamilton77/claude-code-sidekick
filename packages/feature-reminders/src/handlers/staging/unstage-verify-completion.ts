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
import type { DaemonContext, VCUnverifiedState, EventLogContext, VerificationToolStatusState } from '@sidekick/types'
import { DecisionEvents } from '@sidekick/types'
import { ReminderEvents } from '../../events.js'
import { isDaemonContext, isHookEvent } from '@sidekick/types'
import {
  ReminderIds,
  TOOL_REMINDER_MAP,
  ALL_VC_REMINDER_IDS,
  getRemindersConfig,
  type RemindersSettings,
  type VerificationToolConfig,
} from '../../types.js'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { createRemindersState, type RemindersStateAccessors } from '../../state.js'

/** Check whether a single verification tool needs (re-)verification */
function toolNeedsVerification(
  toolConfig: VerificationToolConfig,
  state: VerificationToolStatusState | undefined
): boolean {
  if (!toolConfig.enabled) return false
  if (!state) return true
  if (state.status === 'staged') return true
  if (state.status === 'verified' || state.status === 'cooldown') {
    return state.editsSinceVerified >= toolConfig.clearing_threshold
  }
  return false
}

/**
 * Re-stage per-tool VC reminders for tools that still need verification.
 * Returns true if the wrapper reminder was successfully re-staged (caller should return early).
 */
async function restageUnverifiedTools(
  daemonCtx: DaemonContext,
  sessionId: string,
  config: RemindersSettings,
  unverifiedState: VCUnverifiedState,
  remindersState: RemindersStateAccessors
): Promise<boolean> {
  const verificationToolsResult = await remindersState.verificationTools.read(sessionId)
  const toolsState = verificationToolsResult.data
  const verificationTools = config.verification_tools ?? {}

  // Collect tools needing verification in a single pass (avoids double iteration)
  const toolsToRestage = Object.entries(verificationTools)
    .filter(([toolName, toolConfig]) => toolNeedsVerification(toolConfig, toolsState[toolName]))
    .map(([toolName]) => ({ toolName, reminderId: TOOL_REMINDER_MAP[toolName] }))
    .filter((entry): entry is { toolName: string; reminderId: string } => entry.reminderId !== undefined)

  if (toolsToRestage.length === 0) {
    daemonCtx.logger.info('VC unstage: all tools verified, skipping wrapper re-stage', {
      sessionId,
      cycleCount: unverifiedState.cycleCount,
    })
    await remindersState.vcUnverified.delete(sessionId)
    return false // Fall through to cleanup
  }

  // Re-stage per-tool reminders for tools that still need verification
  const stagedAt = {
    timestamp: Date.now(),
    turnCount: unverifiedState.setAt.turnCount,
    toolsThisTurn: unverifiedState.setAt.toolsThisTurn,
    toolCount: unverifiedState.setAt.toolCount,
  }

  for (const { reminderId } of toolsToRestage) {
    const toolReminder = resolveReminder(reminderId, {
      context: {},
      assets: daemonCtx.assets,
    })
    if (toolReminder) {
      await stageReminder(daemonCtx, 'Stop', { ...toolReminder, stagedAt })
    }
  }

  // Re-stage verify-completion wrapper for next Stop
  const reminder = resolveReminder(ReminderIds.VERIFY_COMPLETION, {
    context: {},
    assets: daemonCtx.assets,
  })

  if (reminder) {
    await stageReminder(daemonCtx, 'Stop', { ...reminder, stagedAt })
    daemonCtx.logger.info('VC unstage: re-staged for next Stop', {
      sessionId,
      cycleCount: unverifiedState.cycleCount,
      lastCategory: unverifiedState.lastClassification.category,
    })
    return true // Caller should return early — reminders were re-staged
  }

  daemonCtx.logger.warn('VC unstage: failed to resolve reminder for re-staging')
  return false
}

/**
 * Handle cycle limit exceeded: clear unverified state and log decision.
 */
async function handleCycleLimitReached(
  daemonCtx: DaemonContext,
  sessionId: string,
  unverifiedState: VCUnverifiedState,
  maxCycles: number,
  remindersState: RemindersStateAccessors
): Promise<void> {
  daemonCtx.logger.info('VC unstage: cycle limit reached, clearing', {
    sessionId,
    cycleCount: unverifiedState.cycleCount,
    maxCycles,
  })
  await remindersState.vcUnverified.delete(sessionId)
  logEvent(
    daemonCtx.logger,
    DecisionEvents.decisionRecorded(
      { sessionId },
      {
        decision: 'unstaged-all',
        reason: `verification cycle limit reached (${unverifiedState.cycleCount}/${maxCycles})`,
        subsystem: 'vc-reminders',
        title: 'Unstage all VC reminders (cycle limit)',
      }
    )
  )
}

/**
 * Delete all VC reminders from staging with event logging.
 */
async function deleteAllVCReminders(
  daemonCtx: DaemonContext,
  sessionId: string,
  reason: string,
  triggeredBy: string
): Promise<void> {
  const eventContext: EventLogContext = { sessionId }
  let deletedCount = 0
  for (const vcId of ALL_VC_REMINDER_IDS) {
    const deleted = await daemonCtx.staging.deleteReminder('Stop', vcId)
    if (deleted) {
      deletedCount++
      logEvent(
        daemonCtx.logger,
        ReminderEvents.reminderUnstaged(eventContext, {
          reminderName: vcId,
          hookName: 'Stop',
          reason,
          triggeredBy,
        })
      )
    }
  }
  daemonCtx.logger.debug('VC unstage: cleanup complete', {
    reason,
    deletedCount,
    totalChecked: ALL_VC_REMINDER_IDS.length,
  })
}

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
        await deleteAllVCReminders(daemonCtx, '', 'no_session_id', 'no_session_id')
        return
      }

      // Read vc-unverified state using typed accessor
      const remindersState = createRemindersState(daemonCtx.stateService)
      const vcResult = await remindersState.vcUnverified.read(sessionId)
      const unverifiedState: VCUnverifiedState | null = vcResult.source !== 'default' ? vcResult.data : null

      if (unverifiedState?.hasUnverifiedChanges) {
        const config = getRemindersConfig(context.config)
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
          const restaged = await restageUnverifiedTools(daemonCtx, sessionId, config, unverifiedState, remindersState)
          if (restaged) return // Reminders were re-staged, don't delete them
        } else {
          await handleCycleLimitReached(daemonCtx, sessionId, unverifiedState, maxCycles, remindersState)
        }
      } else {
        logEvent(
          daemonCtx.logger,
          ReminderEvents.reminderNotStaged(
            { sessionId },
            {
              reminderName: 'verify-completion',
              hookName: 'Stop',
              reason: 'no_unverified_changes',
            }
          )
        )
        daemonCtx.logger.info('VC unstage: no unverified changes, clearing reminder', {
          sessionId,
          hadState: unverifiedState !== null,
        })
      }

      // Delete the existing staged reminders (no unverified state or limit reached)
      const reason = unverifiedState?.hasUnverifiedChanges ? 'cycle_limit_reached' : 'no_unverified_changes'
      const triggeredBy = unverifiedState?.hasUnverifiedChanges ? 'cycle_limit' : 'no_unverified_changes'
      await deleteAllVCReminders(daemonCtx, sessionId, reason, triggeredBy)
    },
  })
}
