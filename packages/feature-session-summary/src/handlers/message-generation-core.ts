/**
 * Message Generation Core
 *
 * Shared pipeline for snarky and resume message generation.
 * Extracts the common steps used by both periodic (update-summary.ts)
 * and on-demand (on-demand-generation.ts) generation paths.
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md
 */

import type { DaemonContext, SnarkyMessageState, SessionSummaryState, TranscriptService } from '@sidekick/types'
import type { SessionSummaryStateAccessors } from '../state.js'
import type { ResumeMessageState, SessionSummaryConfig } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types.js'
import type { Logger } from '@sidekick/types'
import type { ExcerptOptions } from '@sidekick/types'
import { logEvent } from '@sidekick/core'
import { SessionSummaryEvents } from '../events.js'
import { interpolateTemplate } from './update-summary.js'
import {
  buildPersonaContext,
  getEffectiveProfile,
  loadSessionPersona,
  loadUserProfileContext,
  stripSurroundingQuotes,
} from './persona-utils.js'

// ============================================================================
// Result Types
// ============================================================================

export type SnarkyResult =
  | { status: 'success'; state: SnarkyMessageState }
  | { status: 'skipped'; reason: 'persona_disabled' | 'prompt_not_found' }
  | { status: 'error'; error: Error }

export type ResumeResult =
  | { status: 'success'; state: ResumeMessageState }
  | { status: 'deterministic'; state: ResumeMessageState }
  | { status: 'skipped'; reason: 'low_confidence' | 'prompt_not_found' }
  | { status: 'error'; error: Error }

// ============================================================================
// Parameter Types
// ============================================================================

export interface SnarkyCoreParams {
  ctx: DaemonContext
  sessionId: string
  summaryState: SessionSummaryStateAccessors
  summary: SessionSummaryState
  config: SessionSummaryConfig
  logger: Logger
}

export interface ResumeCoreParams extends SnarkyCoreParams {
  excerptOptions: ExcerptOptions
  transcript: TranscriptService
}

// ============================================================================
// Constants
// ============================================================================

const SNARKY_PROMPT_FILE = 'prompts/snarky-message.prompt.txt'
// RESUME_PROMPT_FILE will be added by Task 3 (generateResumeCore)

// ============================================================================
// generateSnarkyCore
// ============================================================================

/**
 * Shared snarky message generation pipeline.
 *
 * Extracts the identical steps from generateSnarkyMessage (periodic) and
 * generateSnarkyMessageOnDemand (on-demand). Callers handle their own
 * error-to-state mapping, logging, and result translation.
 *
 * @returns Discriminated union: success (with state), skipped, or error
 */
export async function generateSnarkyCore(params: SnarkyCoreParams): Promise<SnarkyResult> {
  const { ctx, sessionId, summaryState, summary, config, logger } = params

  // 1. Load persona and check disabled
  const persona = await loadSessionPersona(ctx, sessionId, summaryState)
  if (persona?.id === 'disabled') {
    logger.debug('Skipping snarky message generation (disabled persona)', { sessionId })
    return { status: 'skipped', reason: 'persona_disabled' }
  }

  // 2. Resolve prompt template
  const promptTemplate = ctx.assets.resolve(SNARKY_PROMPT_FILE)
  if (!promptTemplate) {
    logger.warn('Snarky message prompt not found', { path: SNARKY_PROMPT_FILE })
    return { status: 'skipped', reason: 'prompt_not_found' }
  }

  // 3. Build persona + user profile context
  const personaContext = buildPersonaContext(persona)
  const userProfileContext = loadUserProfileContext(logger)

  // 4. Interpolate template
  const prompt = interpolateTemplate(promptTemplate, {
    ...personaContext,
    ...userProfileContext,
    session_title: summary.session_title,
    latest_intent: summary.latest_intent,
    turn_count: ctx.transcript.getMetrics().turnCount,
    tool_count: ctx.transcript.getMetrics().toolCount,
    sessionSummary: JSON.stringify(summary, null, 2),
    maxSnarkyWords: config.maxSnarkyWords,
  })

  // 5. Resolve LLM profile
  const llmConfig = config.llm?.snarkyComment ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.snarkyComment!
  const profileResult = getEffectiveProfile(persona, llmConfig, config, ctx.config.llm.profiles, logger)
  if ('errorMessage' in profileResult) {
    return { status: 'error', error: new Error(profileResult.errorMessage) }
  }

  // 6. Create LLM provider
  const provider = ctx.profileFactory.createForProfile(profileResult.profileId, llmConfig.fallbackProfile)

  // 7. Emit snarkyMessageStart
  logEvent(logger, SessionSummaryEvents.snarkyMessageStart({ sessionId }, { sessionId }))

  try {
    // 8. Call provider.complete()
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
    })

    // 9. Strip quotes, build state
    const snarkyMessage = stripSurroundingQuotes(response.content.trim())
    const snarkyState: SnarkyMessageState = {
      message: snarkyMessage,
      timestamp: new Date().toISOString(),
    }

    // 10. Write state
    await summaryState.snarkyMessage.write(sessionId, snarkyState)

    // 11. Emit snarkyMessageFinish
    logEvent(logger, SessionSummaryEvents.snarkyMessageFinish({ sessionId }, { generatedMessage: snarkyMessage }))

    // 12. Return success
    return { status: 'success', state: snarkyState }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    logger.warn('Failed to generate snarky message', { sessionId, error: String(err) })
    return { status: 'error', error }
  }
}
