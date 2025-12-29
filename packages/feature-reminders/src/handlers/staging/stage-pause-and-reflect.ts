/**
 * Stage "pause and reflect" reminder when toolsThisTurn exceeds threshold
 * @see docs/design/FEATURE-REMINDERS.md
 */
import type { RuntimeContext } from '@sidekick/core'
import { isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'

export function registerStagePauseAndReflect(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-pause-and-reflect',
    priority: 80,
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return undefined

      const metrics = event.metadata.metrics
      const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }

      // Check consumption history for reactivation decision
      const lastConsumed = await ctx.staging.getLastConsumed('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)
      if (lastConsumed?.stagedAt) {
        // Reactivate only on new turn OR after threshold more tools
        const shouldReactivate =
          metrics.turnCount > lastConsumed.stagedAt.turnCount ||
          metrics.toolsThisTurn >= lastConsumed.stagedAt.toolsThisTurn + config.pause_and_reflect_threshold

        if (!shouldReactivate) return undefined
      }

      if (metrics.toolsThisTurn < config.pause_and_reflect_threshold) return undefined

      return {
        reminderId: ReminderIds.PAUSE_AND_REFLECT,
        targetHook: 'PreToolUse',
        templateContext: { toolsThisTurn: metrics.toolsThisTurn },
        suppressHooks: ['Stop'], // Avoid double-nagging
      }
    },
  })
}
