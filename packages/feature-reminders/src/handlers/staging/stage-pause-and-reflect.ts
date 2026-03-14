/**
 * Stage "pause and reflect" reminder when toolsThisTurn exceeds threshold
 *
 * Threshold is calculated relative to:
 * 1. Start of turn (default baseline = 0)
 * 2. Last P&R consumption (reactivation)
 * 3. Last VC consumption (baseline reset via pr-baseline.json)
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { logEvent } from '@sidekick/core'
import { isTranscriptEvent, type PRBaselineState } from '@sidekick/types'
import { ReminderEvents } from '../../events.js'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'
import { createRemindersState } from '../../state.js'

export function registerStagePauseAndReflect(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-pause-and-reflect',
    priority: 80,
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return undefined

      const metrics = event.metadata.metrics
      const sessionId = event.context?.sessionId
      const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }

      // Read P&R baseline set by VC consumption (if any)
      // Note: Baseline tracking vs countdown has similar complexity. Cross-reminder coordination
      // (baseline resets, turn resets) is now handled by ReminderOrchestrator per 9.6 refactoring.
      let prBaseline: PRBaselineState | null = null
      if (sessionId) {
        const remindersState = createRemindersState(ctx.stateService)
        const result = await remindersState.prBaseline.read(sessionId)
        if (result.source !== 'default') {
          prBaseline = result.data
        }
      }

      // Calculate effective baseline for threshold
      // If VC was consumed this turn, use its toolsThisTurn as the new baseline
      let effectiveBaseline = 0
      if (prBaseline && prBaseline.turnCount === metrics.turnCount) {
        effectiveBaseline = prBaseline.toolsThisTurn
      }

      // Check consumption history for reactivation decision
      const lastConsumed = await ctx.staging.getLastConsumed('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)
      if (lastConsumed?.stagedAt) {
        // Use last P&R consumption as baseline if it's higher than VC baseline
        if (lastConsumed.stagedAt.turnCount === metrics.turnCount) {
          effectiveBaseline = Math.max(effectiveBaseline, lastConsumed.stagedAt.toolsThisTurn)
        }

        // Reactivate only on new turn OR after threshold more tools since baseline
        const shouldReactivate =
          metrics.turnCount > lastConsumed.stagedAt.turnCount ||
          metrics.toolsThisTurn >= effectiveBaseline + config.pause_and_reflect_threshold

        if (!shouldReactivate) {
          logEvent(
            ctx.logger,
            ReminderEvents.reminderNotStaged(
              { sessionId: event.context?.sessionId ?? '' },
              {
                reminderName: 'pause-and-reflect',
                hookName: 'PreToolUse',
                reason: 'same_turn',
                triggeredBy: 'tool_result',
              }
            )
          )
          return undefined
        }
      }

      // Check threshold relative to baseline
      const toolsSinceBaseline = metrics.toolsThisTurn - effectiveBaseline
      if (toolsSinceBaseline < config.pause_and_reflect_threshold) {
        logEvent(
          ctx.logger,
          ReminderEvents.reminderNotStaged(
            { sessionId: event.context?.sessionId ?? '' },
            {
              reminderName: 'pause-and-reflect',
              hookName: 'PreToolUse',
              reason: 'below_threshold',
              threshold: config.pause_and_reflect_threshold,
              currentValue: toolsSinceBaseline,
              triggeredBy: 'tool_result',
            }
          )
        )
        return undefined
      }

      // Note: Unstaging verify-completion is now handled by orchestrator.onReminderStaged()
      // in staging-handler-utils.ts after this handler returns the staging action.

      return {
        reminderId: ReminderIds.PAUSE_AND_REFLECT,
        targetHook: 'PreToolUse',
        templateContext: { toolsThisTurn: metrics.toolsThisTurn, toolsSinceBaseline },
      }
    },
  })
}
