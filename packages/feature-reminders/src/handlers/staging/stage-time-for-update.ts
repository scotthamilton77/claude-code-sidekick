/**
 * Stage "time for user update" reminder
 * @see docs/design/FEATURE-REMINDERS.md §5.4
 */
import type { RuntimeContext, FeaturesConfig } from '@sidekick/core'
import { isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDER_CONFIG, type ReminderConfig } from '../../types.js'

export function registerStageTimeForUpdate(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-time-for-update',
    priority: 70, // Lower than stuck (80), so stuck wins
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return undefined

      const metrics = event.metadata.metrics
      const allConfig = context.config.getAll() as { features: FeaturesConfig }
      const featureConfig = allConfig.features['reminders'] ?? { enabled: true, settings: {} }
      const config = { ...DEFAULT_REMINDER_CONFIG, ...(featureConfig.settings as Partial<ReminderConfig>) }

      // Check consumption history for reactivation decision
      const lastConsumed = await ctx.staging.getLastConsumed('PreToolUse', ReminderIds.TIME_FOR_USER_UPDATE)
      if (lastConsumed?.stagedAt) {
        // Reactivate only on new turn OR after threshold more tools
        const shouldReactivate =
          metrics.turnCount > lastConsumed.stagedAt.turnCount ||
          metrics.toolsThisTurn >= lastConsumed.stagedAt.toolsThisTurn + config.update_threshold

        if (!shouldReactivate) return undefined
      }

      // Only trigger if below stuck threshold but above update threshold
      if (metrics.toolsThisTurn < config.update_threshold) return undefined
      if (metrics.toolsThisTurn >= config.stuck_threshold) return undefined

      return {
        reminderId: ReminderIds.TIME_FOR_USER_UPDATE,
        targetHook: 'PreToolUse',
        templateContext: { toolsThisTurn: metrics.toolsThisTurn },
      }
    },
  })
}
