/**
 * Stage default UserPromptSubmit reminder on SessionStart and BulkProcessingComplete
 *
 * Two entry points ensure the reminder is staged:
 * 1. SessionStart: Normal session initialization (startup, resume, clear)
 * 2. BulkProcessingComplete: Mid-session daemon restart after state cleanup
 *    (e.g., dev-mode.sh clean-all removes staging directory, then daemon
 *    restarts and reconstructs transcript - SessionStart doesn't fire mid-session)
 *
 * @see docs/design/FEATURE-REMINDERS.md §5.1
 */
import type { RuntimeContext } from '@sidekick/core'
import type { DaemonContext } from '@sidekick/types'
import { isDaemonContext, isHookEvent, isSessionStartEvent, isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { createRemindersState } from '../../state.js'

export function registerStageDefaultUserPrompt(context: RuntimeContext): void {
  // Handler 1: Stage on SessionStart (normal flow)
  createStagingHandler(context, {
    id: 'reminders:stage-default-user-prompt',
    priority: 50,
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    execute: (event) => {
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return undefined

      // Stage on every session start (startup, resume, or clear)
      return {
        reminderId: ReminderIds.USER_PROMPT_SUBMIT,
        targetHook: 'UserPromptSubmit',
        skipIfExists: false, // Always stage on session start
        templateContext: { sessionId: event.context.sessionId },
      }
    },
  })

  // Handler 1b: Reset UPS throttle counter on SessionStart
  if (isDaemonContext(context)) {
    const startCtx = context as unknown as DaemonContext
    context.handlers.register({
      id: 'reminders:ups-throttle-reset-session-start',
      priority: 49,
      filter: { kind: 'hook', hooks: ['SessionStart'] },
      handler: async (event) => {
        if (!isHookEvent(event) || !isSessionStartEvent(event)) return
        const sessionId = event.context.sessionId
        if (!sessionId) return
        const remindersState = createRemindersState(startCtx.stateService)
        await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: 0 })
      },
    })
  }

  // Handler 2: Stage after bulk transcript reconstruction (mid-session restart)
  // This handles the case where daemon restarts without a SessionStart event
  // (e.g., after dev-mode.sh clean-all removes the staging directory)
  createStagingHandler(context, {
    id: 'reminders:stage-default-user-prompt-after-bulk',
    priority: 50,
    filter: { kind: 'transcript', eventTypes: ['BulkProcessingComplete'] },
    execute: (event) => {
      if (!isTranscriptEvent(event)) return undefined

      // Only stage if not already present (SessionStart may have already staged it)
      return {
        reminderId: ReminderIds.USER_PROMPT_SUBMIT,
        targetHook: 'UserPromptSubmit',
        skipIfExists: true, // Don't duplicate if SessionStart already staged
        templateContext: { sessionId: event.context?.sessionId ?? 'unknown' },
      }
    },
  })

  // Handler 2b: Reset UPS throttle counter on BulkProcessingComplete
  if (isDaemonContext(context)) {
    const bulkCtx = context as unknown as DaemonContext
    context.handlers.register({
      id: 'reminders:ups-throttle-reset-bulk',
      priority: 49,
      filter: { kind: 'transcript', eventTypes: ['BulkProcessingComplete'] },
      handler: async (event) => {
        if (!isTranscriptEvent(event)) return
        if (event.metadata.isBulkProcessing) return
        const sessionId = event.context?.sessionId
        if (!sessionId) return
        const remindersState = createRemindersState(bulkCtx.stateService)
        await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: 0 })
      },
    })
  }

  // Handler 3: Throttle re-staging based on conversation message count
  if (!isDaemonContext(context)) return

  context.handlers.register({
    id: 'reminders:ups-throttle-restage',
    priority: 50,
    filter: { kind: 'transcript', eventTypes: ['UserPrompt', 'AssistantMessage'] },
    handler: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return

      // Skip bulk replay
      if (event.metadata.isBulkProcessing) return

      const sessionId = event.context?.sessionId
      if (!sessionId) return

      const handlerCtx = ctx as unknown as DaemonContext
      const remindersState = createRemindersState(handlerCtx.stateService)

      // Read-modify-write is safe: transcript events are processed serially per session
      // Read current counter
      const result = await remindersState.upsThrottle.read(sessionId)
      const current = result.data.messagesSinceLastStaging

      // Read threshold from config
      const featureConfig = handlerCtx.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
      const threshold = config.user_prompt_submit_threshold ?? 10

      const newCount = current + 1

      if (newCount >= threshold) {
        // Idempotency check: skip if already staged
        const existing = await handlerCtx.staging.listReminders('UserPromptSubmit')
        if (existing.some((r) => r.name === ReminderIds.USER_PROMPT_SUBMIT)) {
          await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: 0 })
          return
        }

        // Re-stage the reminder
        const reminder = resolveReminder(ReminderIds.USER_PROMPT_SUBMIT, {
          context: { sessionId },
          assets: handlerCtx.assets,
        })

        if (reminder) {
          await stageReminder(handlerCtx, 'UserPromptSubmit', reminder)
          handlerCtx.logger.debug('UPS throttle: re-staged reminder', {
            sessionId,
            messageCount: newCount,
            threshold,
          })

          // Notify orchestrator for cross-reminder coordination
          if (handlerCtx.orchestrator) {
            await handlerCtx.orchestrator.onReminderStaged(
              { name: ReminderIds.USER_PROMPT_SUBMIT, hook: 'UserPromptSubmit' },
              sessionId
            )
          }

          // Reset counter only after successful stage
          await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: 0 })
        } else {
          // Resolve failed — increment counter, don't reset
          await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: newCount })
        }
      } else {
        // Increment counter
        await remindersState.upsThrottle.write(sessionId, { messagesSinceLastStaging: newCount })
      }
    },
  })
}
