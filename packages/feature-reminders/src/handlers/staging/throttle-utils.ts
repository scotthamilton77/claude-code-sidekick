/**
 * Shared throttle utilities for reminder staging handlers
 *
 * Extracted from stage-default-user-prompt.ts to avoid cross-handler
 * dependencies (e.g., persona staging importing from UPS staging).
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */
import type { DaemonContext, HookName, StagedReminder } from '@sidekick/types'
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
  state[reminderId] = {
    messagesSinceLastStaging: 0,
    targetHook,
    cachedReminder: {
      name: resolvedReminder.name,
      blocking: resolvedReminder.blocking,
      priority: resolvedReminder.priority,
      persistent: resolvedReminder.persistent,
      throttle: resolvedReminder.throttle,
      userMessage: resolvedReminder.userMessage,
      additionalContext: resolvedReminder.additionalContext,
      reason: resolvedReminder.reason,
    },
  }
  await remindersState.reminderThrottle.write(sessionId, state)
}
