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

  ctx.logger.info('VC unverified state set', {
    sessionId,
    category: classification.category,
    confidence: classification.confidence,
    cycleCount: newCycleCount,
    turnCount: metrics.turnCount,
    toolCount: metrics.toolCount,
  })
}

/** Removes unverified state when verification actually occurs. */
export async function handleVCUnverifiedClear(params: VCUnverifiedClearParams, ctx: IPCHandlerContext): Promise<void> {
  const { sessionId } = params

  const remindersState = createRemindersState(ctx.stateService)
  await remindersState.vcUnverified.delete(sessionId)

  ctx.logger.info('VC unverified state cleared', { sessionId })
}
