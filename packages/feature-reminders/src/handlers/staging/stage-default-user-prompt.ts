/**
 * Stage default UserPromptSubmit reminder on SessionStart and BulkProcessingComplete
 *
 * Two entry points ensure the reminder is staged:
 * 1. SessionStart: Normal session initialization (startup, resume, clear)
 * 2. BulkProcessingComplete: Mid-session daemon restart after state cleanup
 *    (e.g., dev-mode.sh clean-all removes staging directory, then daemon
 *    restarts and reconstructs transcript - SessionStart doesn't fire mid-session)
 *
 * Throttle opt-in: Reminders are throttled by explicit `registerThrottledReminder`
 * calls in their originating handlers (not by YAML config). The YAML
 * `reminder_thresholds` map controls the re-staging interval (message count)
 * but does not control which reminders are throttled.
 *
 * @see docs/design/FEATURE-REMINDERS.md §5.1
 */
import type { RuntimeContext } from '@sidekick/core'
import type { DaemonContext, ReminderThrottleEntry, StagedReminder, StagingMetrics } from '@sidekick/types'
import { isDaemonContext, isHookEvent, isSessionStartEvent, isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'
import { resolveReminder, stageReminder } from '../../reminder-utils.js'
import { createRemindersState } from '../../state.js'
import { registerThrottledReminder, resetThrottleCounters } from './throttle-utils.js'

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

  // Daemon-only handlers: throttle registration, counter resets, and re-staging
  if (!isDaemonContext(context)) return

  // Handler 3: Register UPS reminder in throttle state on SessionStart
  context.handlers.register({
    id: 'reminders:throttle-register-ups-session-start',
    priority: 49,
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event, ctx) => {
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
      const handlerCtx = ctx as unknown as DaemonContext
      const sessionId = event.context.sessionId
      if (!sessionId) return
      const reminder = resolveReminder(ReminderIds.USER_PROMPT_SUBMIT, {
        context: { sessionId },
        assets: handlerCtx.assets,
      })
      if (reminder) {
        await registerThrottledReminder(
          handlerCtx,
          sessionId,
          ReminderIds.USER_PROMPT_SUBMIT,
          'UserPromptSubmit',
          reminder
        )
      }
    },
  })

  // Handler 4: Reset all throttle counters on SessionStart
  context.handlers.register({
    id: 'reminders:throttle-reset-session-start',
    priority: 48,
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event, ctx) => {
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
      const handlerCtx = ctx as unknown as DaemonContext
      const sessionId = event.context.sessionId
      if (!sessionId) return
      await resetThrottleCounters(handlerCtx, sessionId)
    },
  })

  // Handler 5: Reset all throttle counters on BulkProcessingComplete
  context.handlers.register({
    id: 'reminders:throttle-reset-bulk',
    priority: 49,
    filter: { kind: 'transcript', eventTypes: ['BulkProcessingComplete'] },
    handler: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return
      if (event.metadata.isBulkProcessing) return
      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
      const handlerCtx = ctx as unknown as DaemonContext
      const sessionId = event.context?.sessionId
      if (!sessionId) return
      await resetThrottleCounters(handlerCtx, sessionId)
    },
  })

  // Handler 6: Generic throttle re-staging based on conversation message count
  context.handlers.register({
    id: 'reminders:throttle-restage',
    priority: 50,
    filter: { kind: 'transcript', eventTypes: ['UserPrompt', 'AssistantMessage'] },
    handler: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return

      // Skip bulk replay
      if (event.metadata.isBulkProcessing) return

      if (!isDaemonContext(ctx as unknown as RuntimeContext)) return
      const handlerCtx = ctx as unknown as DaemonContext
      const sessionId = event.context?.sessionId
      if (!sessionId) return

      const remindersState = createRemindersState(handlerCtx.stateService)

      // Read all throttle entries
      const result = await remindersState.reminderThrottle.read(sessionId)
      const state = { ...result.data }

      if (Object.keys(state).length === 0) return

      // Read thresholds from config
      const featureConfig = handlerCtx.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }
      const thresholds = config.reminder_thresholds ?? {}

      let changed = false

      for (const [reminderId, entry] of Object.entries(state)) {
        const typedEntry = entry as ReminderThrottleEntry
        const threshold = thresholds[reminderId]
        if (threshold === undefined) continue

        const newCount = typedEntry.messagesSinceLastStaging + 1

        if (newCount >= threshold) {
          // Build stagedAt metrics from the triggering transcript event (consistent with createStagingHandler)
          const metrics = event.metadata.metrics
          const stagedAt: StagingMetrics = {
            timestamp: Date.now(),
            turnCount: metrics.turnCount,
            toolsThisTurn: metrics.toolsThisTurn,
            toolCount: metrics.toolCount,
          }
          await stageReminder(handlerCtx, typedEntry.targetHook, {
            ...(typedEntry.cachedReminder as StagedReminder),
            stagedAt,
          })
          state[reminderId] = { ...typedEntry, messagesSinceLastStaging: 0 }
          handlerCtx.logger.debug('Throttle: re-staged reminder', {
            sessionId,
            reminderId,
            messageCount: newCount,
            threshold,
          })
        } else {
          state[reminderId] = { ...typedEntry, messagesSinceLastStaging: newCount }
        }
        changed = true
      }

      if (changed) {
        await remindersState.reminderThrottle.write(sessionId, state)
      }
    },
  })
}
