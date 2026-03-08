/**
 * Session Summary handler registration
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §2.2
 */

import type { RuntimeContext } from '@sidekick/core'
import { isHookEvent, isSessionStartEvent, isTranscriptEvent } from '@sidekick/core'
import type { DaemonContext } from '@sidekick/types'
import { createFirstSessionSummary } from './create-first-summary.js'
import { updateSessionSummary } from './update-summary.js'

export function registerHandlers(context: RuntimeContext): void {
  // Only register in Daemon
  if (context.role !== 'daemon') return

  const ctx = context

  // CreateFirstSessionSummary - SessionStart hook
  ctx.handlers.register({
    id: 'session-summary:init',
    priority: 80,
    filter: { kind: 'hook', hooks: ['SessionStart'] },
    handler: async (event, context) => {
      if (!isHookEvent(event) || !isSessionStartEvent(event)) return
      await createFirstSessionSummary(event, context as unknown as DaemonContext)
    },
  })

  // UpdateSessionSummary - UserPrompt transcript event (force)
  ctx.handlers.register({
    id: 'session-summary:update-user-prompt',
    priority: 80,
    filter: { kind: 'transcript', eventTypes: ['UserPrompt'] },
    handler: async (event, context) => {
      if (!isTranscriptEvent(event)) return
      await updateSessionSummary(event, context as unknown as DaemonContext)
    },
  })

  // UpdateSessionSummary - ToolResult transcript event (conditional)
  ctx.handlers.register({
    id: 'session-summary:update-tool-result',
    priority: 70,
    filter: { kind: 'transcript', eventTypes: ['ToolResult'] },
    handler: async (event, context) => {
      if (!isTranscriptEvent(event)) return
      await updateSessionSummary(event, context as unknown as DaemonContext)
    },
  })

  // BulkProcessingComplete - one-time analysis after bulk transcript replay
  ctx.handlers.register({
    id: 'session-summary:bulk-complete',
    priority: 80,
    filter: { kind: 'transcript', eventTypes: ['BulkProcessingComplete'] },
    handler: async (event, context) => {
      if (!isTranscriptEvent(event)) return
      await updateSessionSummary(event, context as unknown as DaemonContext)
    },
  })
}

export { createFirstSessionSummary } from './create-first-summary.js'
export { updateSessionSummary } from './update-summary.js'
export {
  setSessionPersona,
  generateSnarkyMessageOnDemand,
  generateResumeMessageOnDemand,
  type GenerationResult,
  type SetPersonaResult,
} from './on-demand-generation.js'
export { type PersonaSelectionOptions } from './persona-selection.js'
