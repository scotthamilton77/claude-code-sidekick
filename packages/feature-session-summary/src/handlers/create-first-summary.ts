/**
 * CreateFirstSessionSummary Handler
 *
 * Creates placeholder summary on session start. Only writes for startup/clear.
 * Resume/compact preserve existing summary.
 * Also selects and persists a persona for the session.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.1
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Session Persona State
 */

import type { SessionStartHookEvent } from '@sidekick/core'
import type { DaemonContext, SessionSummaryState } from '@sidekick/types'
import { SESSION_SUMMARY_PLACEHOLDERS } from '@sidekick/types'
import { createSessionSummaryState } from '../state.js'
import { selectPersonaForSession } from './persona-selection.js'
import type { SessionSummaryConfig } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types.js'

export async function createFirstSessionSummary(event: SessionStartHookEvent, ctx: DaemonContext): Promise<void> {
  const { sessionId } = event.context
  const { startType } = event.payload

  // Only create placeholder for fresh sessions
  if (startType !== 'startup' && startType !== 'clear') {
    ctx.logger.debug('Preserving existing summary', { startType, sessionId })
    return
  }

  // Get feature config for persona settings
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }

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

  // Select and persist persona for this session
  // Runs in parallel with summary creation (fire and forget style error handling)
  await selectPersonaForSession(sessionId, config, ctx, { startType })
}
