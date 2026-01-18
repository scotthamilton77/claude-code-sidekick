/**
 * Handle reminder.consumed IPC from CLI.
 *
 * When verify-completion is consumed, stores P&R baseline to reset threshold.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { PRBaselineState } from '@sidekick/types'
import { createRemindersState } from '../../state.js'
import { ReminderIds } from '../../types.js'
import type { IPCHandlerContext, ReminderConsumedParams } from './types.js'

export async function handleReminderConsumed(params: ReminderConsumedParams, ctx: IPCHandlerContext): Promise<void> {
  const { sessionId, reminderName, metrics } = params

  // Only update P&R baseline for verify-completion consumption
  if (reminderName === ReminderIds.VERIFY_COMPLETION) {
    const remindersState = createRemindersState(ctx.stateService)

    const baseline: PRBaselineState = {
      turnCount: metrics.turnCount,
      toolsThisTurn: metrics.toolsThisTurn,
      timestamp: Date.now(),
    }

    await remindersState.prBaseline.write(sessionId, baseline)

    ctx.logger.debug('Updated P&R baseline after VC consumption', { sessionId, baseline })
  }
}
