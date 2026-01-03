/**
 * Session Summary handler registration
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §2.2
 */

import type { RuntimeContext } from '@sidekick/core'
import { isHookEvent, isSessionStartEvent, isTranscriptEvent } from '@sidekick/core'
import type { SupervisorContext } from '@sidekick/types'
import { createFirstSessionSummary } from './create-first-summary.js'
import { updateSessionSummary } from './update-summary.js'

export function registerHandlers(context: RuntimeContext): void {
  // Only register in Supervisor
  if (context.role !== 'supervisor') return

  const ctx = context

  // CreateFirstSessionSummary - SessionStart hook
  ctx.handlers.register({
    id: 'session-summary:init',
    priority: 80,
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event) => {
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return
      await createFirstSessionSummary(event, ctx)
    },
  })

  // UpdateSessionSummary - UserPrompt transcript event (force)
  ctx.handlers.register({
    id: 'session-summary:update-user-prompt',
    priority: 80,
    filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
    handler: async (event, context) => {
      if (!isTranscriptEvent(event)) return
      await updateSessionSummary(event, context as unknown as SupervisorContext)
    },
  })

  // UpdateSessionSummary - ToolResult transcript event (conditional)
  ctx.handlers.register({
    id: 'session-summary:update-tool-result',
    priority: 70,
    filter: { kind: 'transcript', eventTypes: ['ToolResult'] },
    handler: async (event, context) => {
      if (!isTranscriptEvent(event)) return
      await updateSessionSummary(event, context as unknown as SupervisorContext)
    },
  })

  // BulkProcessingComplete - one-time analysis after bulk transcript replay
  ctx.handlers.register({
    id: 'session-summary:bulk-complete',
    priority: 80,
    filter: { kind: 'transcript', eventTypes: ['BulkProcessingComplete'] },
    handler: async (event, context) => {
      if (!isTranscriptEvent(event)) return
      await updateSessionSummary(event, context as unknown as SupervisorContext)
    },
  })
}

export { createFirstSessionSummary } from './create-first-summary.js'
export { updateSessionSummary } from './update-summary.js'
