/**
 * Stage "time for user update" reminder
 * @see docs/design/FEATURE-REMINDERS.md §5.4
 */
import type { RuntimeContext } from '@sidekick/core'
import { isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDER_CONFIG } from '../../types.js'

export function registerStageTimeForUpdate(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-time-for-update',
    priority: 70, // Lower than stuck (80), so stuck wins
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: (event) => {
      if (!isTranscriptEvent(event)) return undefined

      const metrics = event.metadata.metrics
      const config = DEFAULT_REMINDER_CONFIG

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
