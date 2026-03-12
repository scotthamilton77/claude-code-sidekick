/**
 * Stage user profile reminders on SessionStart
 *
 * Stages a persistent "user-profile" reminder for both
 * UserPromptSubmit and SessionStart hooks when a user profile
 * exists at ~/.sidekick/user.yaml.
 */
import type { RuntimeContext } from '@sidekick/core'
import { loadUserProfile, logEvent } from '@sidekick/core'
import { ReminderEvents } from '../../events.js'
import type { DaemonContext, HookName, SidekickEvent, HandlerContext } from '@sidekick/types'
import { isDaemonContext, isHookEvent, isSessionStartEvent } from '@sidekick/types'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { ReminderIds } from '../../types.js'

/** Target hooks for user profile reminders */
const USER_PROFILE_REMINDER_HOOKS: HookName[] = ['UserPromptSubmit', 'SessionStart']

/**
 * Stage user profile reminders for a session.
 * Loads ~/.sidekick/user.yaml and stages the reminder if profile exists.
 */
export async function stageUserProfileRemindersForSession(ctx: DaemonContext, sessionId: string): Promise<void> {
  const profile = loadUserProfile({ logger: ctx.logger })

  if (!profile) {
    const eventContext = { sessionId }
    for (const hook of USER_PROFILE_REMINDER_HOOKS) {
      await ctx.staging.deleteReminder(hook, ReminderIds.USER_PROFILE)
      logEvent(
        ctx.logger,
        ReminderEvents.reminderUnstaged(eventContext, {
          reminderName: ReminderIds.USER_PROFILE,
          hookName: hook,
          reason: 'no_user_profile',
        })
      )
    }
    return
  }

  const templateContext: Record<string, string> = {
    user_name: profile.name,
    user_role: profile.role,
    user_interests: profile.interests.join(', '),
  }

  const reminder = resolveReminder(ReminderIds.USER_PROFILE, {
    context: templateContext,
    assets: ctx.assets,
  })

  if (reminder) {
    for (const targetHook of USER_PROFILE_REMINDER_HOOKS) {
      await stageReminder(ctx, targetHook, reminder)
    }
    ctx.logger.debug('Staged user profile reminders', { sessionId, userName: profile.name })
  } else {
    ctx.logger.warn('Failed to resolve user-profile reminder', { sessionId })
  }
}

/**
 * Register the user profile reminder staging handler.
 * Triggers on SessionStart to stage user profile reminders.
 */
export function registerStageUserProfileReminders(context: RuntimeContext): void {
  if (!isDaemonContext(context)) return

  context.handlers.register({
    id: 'reminders:stage-user-profile-reminders',
    priority: 39, // Run after persona reminders (priority 40)
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event: SidekickEvent, ctx: HandlerContext) => {
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return

      const daemonCtx = ctx as unknown as DaemonContext
      const sessionId = event.context.sessionId

      await stageUserProfileRemindersForSession(daemonCtx, sessionId)
    },
  })
}
