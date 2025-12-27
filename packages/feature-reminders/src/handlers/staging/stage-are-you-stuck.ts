/**
 * Stage "are you stuck?" reminder when toolsThisTurn exceeds threshold
 * @see docs/design/FEATURE-REMINDERS.md §5.2
 */
import type { RuntimeContext, FeaturesConfig } from '@sidekick/core'
import { isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDER_CONFIG, type ReminderConfig } from '../../types.js'

export function registerStageAreYouStuck(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-are-you-stuck',
    priority: 80, // High priority - check first
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return undefined

      const metrics = event.metadata.metrics
      const allConfig = context.config.getAll() as { features: FeaturesConfig }
      const featureConfig = allConfig.features['reminders'] ?? { enabled: true, settings: {} }
      const config = { ...DEFAULT_REMINDER_CONFIG, ...(featureConfig.settings as Partial<ReminderConfig>) }

      // Check consumption history for reactivation decision
      const lastConsumed = await ctx.staging.getLastConsumed('PreToolUse', ReminderIds.ARE_YOU_STUCK)
      if (lastConsumed?.stagedAt) {
        // Reactivate only on new turn OR after threshold more tools
        const shouldReactivate =
          metrics.turnCount > lastConsumed.stagedAt.turnCount ||
          metrics.toolsThisTurn >= lastConsumed.stagedAt.toolsThisTurn + config.stuck_threshold

        if (!shouldReactivate) return undefined
      }

      if (metrics.toolsThisTurn < config.stuck_threshold) return undefined

      return {
        reminderId: ReminderIds.ARE_YOU_STUCK,
        targetHook: 'PreToolUse',
        templateContext: { toolsThisTurn: metrics.toolsThisTurn },
        suppressHooks: ['Stop'], // Avoid double-nagging
      }
    },
  })
}
