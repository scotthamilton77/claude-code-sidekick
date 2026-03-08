/**
 * Shared throttle utilities for reminder staging handlers
 *
 * Extracted from stage-default-user-prompt.ts to avoid cross-handler
 * dependencies (e.g., persona staging importing from UPS staging).
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */
import type { CachedReminder, DaemonContext, HookName, ReminderThrottleState, StagedReminder } from '@sidekick/types'
import { createRemindersState } from '../../state.js'

/**
 * Register a reminder in the throttle state.
 * Called by originating handlers when they first stage a throttle-eligible reminder.
 * Stores the counter (reset to 0) and caches the resolved reminder for re-staging.
 */
export async function registerThrottledReminder(
  ctx: DaemonContext,
  sessionId: string,
  reminderId: string,
  targetHook: HookName,
  resolvedReminder: StagedReminder
): Promise<void> {
  const remindersState = createRemindersState(ctx.stateService)
  const result = await remindersState.reminderThrottle.read(sessionId)
  const state = { ...result.data }
  // Strip stagedAt via destructure-rest — keeps cachedReminder in sync if StagedReminder gains fields
  const { stagedAt: _stagedAt, ...cachedReminder }: StagedReminder = resolvedReminder
  state[reminderId] = {
    messagesSinceLastStaging: 0,
    targetHook,
    cachedReminder: cachedReminder as CachedReminder,
  }
  await remindersState.reminderThrottle.write(sessionId, state)
}

/**
 * Reset all throttle counters for a session.
 * Called on SessionStart and BulkProcessingComplete to restart throttle intervals.
 */
export async function resetThrottleCounters(ctx: DaemonContext, sessionId: string): Promise<void> {
  const remindersState = createRemindersState(ctx.stateService)
  const result = await remindersState.reminderThrottle.read(sessionId)
  const state: ReminderThrottleState = { ...result.data }
  for (const key of Object.keys(state)) {
    state[key] = { ...state[key], messagesSinceLastStaging: 0 }
  }
  await remindersState.reminderThrottle.write(sessionId, state)
}
