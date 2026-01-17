/**
 * CreateFirstSessionSummary Handler
 *
 * Creates placeholder summary on session start. Only writes for startup/clear.
 * Resume/compact preserve existing summary.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.1
 */

import type { SessionStartHookEvent } from '@sidekick/core'
import type { DaemonContext, SessionSummaryState } from '@sidekick/types'
import { SESSION_SUMMARY_PLACEHOLDERS } from '@sidekick/types'
import { createSessionSummaryState } from '../state.js'

export async function createFirstSessionSummary(event: SessionStartHookEvent, ctx: DaemonContext): Promise<void> {
  const { sessionId } = event.context
  const { startType } = event.payload

  // Only create placeholder for fresh sessions
  if (startType !== 'startup' && startType !== 'clear') {
    ctx.logger.debug('Preserving existing summary', { startType, sessionId })
    return
  }

  const placeholder: SessionSummaryState = {
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    session_title: SESSION_SUMMARY_PLACEHOLDERS.newSession,
    session_title_confidence: 0,
    latest_intent: SESSION_SUMMARY_PLACEHOLDERS.awaitingFirstPrompt,
    latest_intent_confidence: 0,
  }

  // Write to .sidekick/sessions/{sessionId}/state/session-summary.json
  const summaryState = createSessionSummaryState(ctx.stateService)
  await summaryState.sessionSummary.write(sessionId, placeholder)

  ctx.logger.info('Created placeholder session summary', { sessionId })
}
