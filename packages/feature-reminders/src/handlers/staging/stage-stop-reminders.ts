/**
 * Stage verify-completion reminder when source files are edited
 * @see docs/design/FEATURE-REMINDERS.md §5.3
 */
import type { RuntimeContext } from '@sidekick/core'
import { isTranscriptEvent } from '@sidekick/types'
import { createStagingHandler } from './staging-handler-utils.js'
import { ReminderIds } from '../../types.js'

const FILE_EDIT_TOOLS = ['Write', 'Edit', 'MultiEdit']

export function registerStageStopReminders(context: RuntimeContext): void {
  createStagingHandler(context, {
    id: 'reminders:stage-stop-reminders',
    priority: 60,
    filter: { kind: 'transcript', eventTypes: ['ToolCall'] },
    execute: (event) => {
      if (!isTranscriptEvent(event)) return undefined

      // Check if this is a file edit tool
      const toolName = event.payload.toolName
      if (!toolName || !FILE_EDIT_TOOLS.includes(toolName)) return undefined

      return {
        reminderId: ReminderIds.VERIFY_COMPLETION,
        targetHook: 'Stop',
      }
    },
  })
}
