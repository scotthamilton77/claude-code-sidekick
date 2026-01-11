/**
 * Stage verify-completion reminder when source files are edited
 * @see docs/design/FEATURE-REMINDERS.md §5.3
 */
import type { RuntimeContext } from '@sidekick/core'
import { isTranscriptEvent } from '@sidekick/types'
import picomatch from 'picomatch'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds, DEFAULT_REMINDERS_SETTINGS, type RemindersSettings } from '../../types.js'

const FILE_EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit']

export function registerStageStopReminders(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-stop-reminders',
    priority: 60,
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: async (event, ctx) => {
      if (!isTranscriptEvent(event)) return undefined

      // Check if this is a file edit tool
      const toolName = event.payload.toolName
      ctx.logger.debug('stage-stop-reminders: checking tool', { toolName, isEditTool: toolName ? FILE_EDIT_TOOLS.includes(toolName) : false })
      if (!toolName || !FILE_EDIT_TOOLS.includes(toolName)) return undefined

      // Get config for source code pattern filtering
      const featureConfig = context.config.getFeature<RemindersSettings>('reminders')
      const config = { ...DEFAULT_REMINDERS_SETTINGS, ...featureConfig.settings }

      // Extract file path from tool input
      const entry = event.payload.entry as { input?: { file_path?: string } }
      const filePath = entry?.input?.file_path
      ctx.logger.debug('stage-stop-reminders: checking file path', { filePath, hasEntry: !!entry, hasInput: !!entry?.input })
      if (!filePath) return undefined

      // Check if file path matches any configured source code patterns
      const isMatch = picomatch.isMatch(filePath, config.source_code_patterns)
      ctx.logger.debug('stage-stop-reminders: pattern match', { filePath, isMatch, patternCount: config.source_code_patterns.length })
      if (!isMatch) return undefined

      const metrics = event.metadata.metrics

      // Check consumption history for reactivation decision
      // VC should only fire ONCE per turn - reactivate only on new turn
      const lastConsumed = await ctx.staging.getLastConsumed('Stop', ReminderIds.VERIFY_COMPLETION)
      if (lastConsumed?.stagedAt) {
        const shouldReactivate = metrics.turnCount > lastConsumed.stagedAt.turnCount

        if (!shouldReactivate) return undefined
      }

      return {
        reminderId: ReminderIds.VERIFY_COMPLETION,
        targetHook: 'Stop',
      }
    },
  })
}
