/**
 * Handle vc-unverified IPC from CLI.
 *
 * Manages unverified state when verify-completion returns non-blocking.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import type { VCUnverifiedState } from '@sidekick/types'
import { createRemindersState } from '../../state.js'
import type { IPCHandlerContext, VCUnverifiedSetParams, VCUnverifiedClearParams } from './types.js'

/** Stores unverified state and increments cycleCount from existing state if present. */
export async function handleVCUnverifiedSet(params: VCUnverifiedSetParams, ctx: IPCHandlerContext): Promise<void> {
  const { sessionId, classification, metrics } = params

  const remindersState = createRemindersState(ctx.stateService)

  // Read existing state to increment cycleCount
  const existing = await remindersState.vcUnverified.read(sessionId)
  const existingCycleCount = existing.data?.cycleCount ?? 0

  const newCycleCount = existingCycleCount + 1
  const state: VCUnverifiedState = {
    hasUnverifiedChanges: true,
    cycleCount: newCycleCount,
    setAt: {
      timestamp: Date.now(),
      turnCount: metrics.turnCount,
      toolsThisTurn: metrics.toolsThisTurn,
      toolCount: metrics.toolCount,
    },
    lastClassification: classification,
  }

  await remindersState.vcUnverified.write(sessionId, state)

  ctx.logger.debug('Set VC unverified state', { sessionId, classification, cycleCount: newCycleCount })
}

/** Removes unverified state when verification actually occurs. */
export async function handleVCUnverifiedClear(params: VCUnverifiedClearParams, ctx: IPCHandlerContext): Promise<void> {
  const { sessionId } = params

  const remindersState = createRemindersState(ctx.stateService)
  await remindersState.vcUnverified.delete(sessionId)

  ctx.logger.debug('Cleared VC unverified state', { sessionId })
}
