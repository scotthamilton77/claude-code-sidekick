/**
 * Stage "are you stuck?" reminder when toolsThisTurn exceeds threshold
 * @see docs/design/FEATURE-REMINDERS.md §5.2
 */
import type { RuntimeContext, ConfigService } from '@sidekick/core'
import { isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDER_CONFIG, type ReminderConfig } from '../../types.js'

export function registerStageAreYouStuck(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-are-you-stuck',
    priority: 80, // High priority - check first
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: (event) => {
      if (!isTranscriptEvent(event)) return undefined

      const metrics = event.metadata.metrics
      const featureConfig = (context.config as ConfigService).getFeature<ReminderConfig>('reminders')
      const config = { ...DEFAULT_REMINDER_CONFIG, ...featureConfig.settings }

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
