/**
 * Unstage verify-completion reminder when UserPromptSubmit fires
 *
 * When a user submits a new prompt, normally the verify-completion reminder is cleared.
 * However, if there are unverified source code changes (from a non-blocking classification),
 * we re-stage the reminder instead so verification can occur on the next Stop.
 *
 * @see docs/design/FEATURE-REMINDERS.md §5.3
 */
import { readFileSync, unlinkSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import type { RuntimeContext } from '@sidekick/core'
import type { SupervisorContext, VCUnverifiedState } from '@sidekick/types'
import { isSupervisorContext, isHookEvent } from '@sidekick/types'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'

/**
 * Read vc-unverified.json state file if it exists
 */
function readVCUnverifiedState(projectDir: string, sessionId: string): VCUnverifiedState | null {
  const statePath = join(projectDir, '.sidekick', 'sessions', sessionId, 'state', 'vc-unverified.json')
  try {
    if (!existsSync(statePath)) return null
    const content = readFileSync(statePath, 'utf-8')
    return JSON.parse(content) as VCUnverifiedState
  } catch {
    return null
  }
}

/**
 * Clear vc-unverified.json state file
 */
function clearVCUnverifiedState(projectDir: string, sessionId: string): void {
  const statePath = join(projectDir, '.sidekick', 'sessions', sessionId, 'state', 'vc-unverified.json')
  try {
    if (existsSync(statePath)) {
      unlinkSync(statePath)
    }
  } catch {
    // Ignore errors
  }
}

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
      const sessionId = event.context?.sessionId

      if (!sessionId) {
        supervisorCtx.logger.warn('No sessionId in UserPromptSubmit event')
        await supervisorCtx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
        return
      }

      // Check for unverified changes state
      const projectDir = context.paths.projectDir
      if (!projectDir) {
        supervisorCtx.logger.warn('Cannot check vc-unverified state: projectDir not available')
        await supervisorCtx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
        return
      }

      const unverifiedState = readVCUnverifiedState(projectDir, sessionId)

      if (unverifiedState?.hasUnverifiedChanges) {
        // Check cycle limit
        const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
        const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
        const maxCycles = config.max_verification_cycles ?? 0

        if (maxCycles === 0 || unverifiedState.cycleCount < maxCycles) {
          // Re-stage verify-completion for next Stop
          const reminder = resolveReminder(ReminderIds.VERIFY_COMPLETION, {
            context: {},
            assets: supervisorCtx.assets,
          })

          if (reminder) {
            // Stage with fresh metrics from current state
            await stageReminder(supervisorCtx, 'Stop', {
              ...reminder,
              stagedAt: {
                timestamp: Date.now(),
                turnCount: unverifiedState.setAt.turnCount,
                toolsThisTurn: unverifiedState.setAt.toolsThisTurn,
                toolCount: unverifiedState.setAt.toolCount,
              },
            })
            supervisorCtx.logger.info('Re-staged verify-completion due to unverified changes', {
              cycleCount: unverifiedState.cycleCount,
              lastCategory: unverifiedState.lastClassification.category,
            })
            // Don't delete - we just re-staged it
            return
          } else {
            supervisorCtx.logger.warn('Failed to resolve verify-completion reminder for re-staging')
          }
        } else {
          // Cycle limit reached
          supervisorCtx.logger.info('Verification cycle limit reached, not re-staging', {
            cycleCount: unverifiedState.cycleCount,
            maxCycles,
          })
          clearVCUnverifiedState(projectDir, sessionId)
        }
      }

      // Delete the existing staged reminder (no unverified state or limit reached)
      await supervisorCtx.staging.deleteReminder('Stop', ReminderIds.VERIFY_COMPLETION)
      supervisorCtx.logger.debug('Unstaged verify-completion reminder on UserPromptSubmit')
    },
  })
}
