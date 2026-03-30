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
import { DEFAULT_SESSION_SUMMARY_CONFIG, RESUME_MIN_CONFIDENCE } from '../types.js'
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
}

export interface ResumeCoreParams extends SnarkyCoreParams {
  excerptOptions: ExcerptOptions
  transcript: TranscriptService
}

// ============================================================================
// Constants
// ============================================================================

export const SNARKY_PROMPT_FILE = 'prompts/snarky-message.prompt.txt'
export const RESUME_PROMPT_FILE = 'prompts/resume-message.prompt.txt'

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
  const { ctx, sessionId, summaryState, summary, config } = params

  const persona = await loadSessionPersona(ctx, sessionId, summaryState)
  if (persona?.id === 'disabled') {
    ctx.logger.debug('Skipping snarky message generation (disabled persona)', { sessionId })
    return { status: 'skipped', reason: 'persona_disabled' }
  }

  const promptTemplate = ctx.assets.resolve(SNARKY_PROMPT_FILE)
  if (!promptTemplate) {
    ctx.logger.warn('Snarky message prompt not found', { path: SNARKY_PROMPT_FILE })
    return { status: 'skipped', reason: 'prompt_not_found' }
  }

  const personaContext = buildPersonaContext(persona)
  const userProfileContext = loadUserProfileContext(ctx.logger)

  const metrics = ctx.transcript.getMetrics()
  const prompt = interpolateTemplate(promptTemplate, {
    ...personaContext,
    ...userProfileContext,
    session_title: summary.session_title,
    latest_intent: summary.latest_intent,
    turn_count: metrics.turnCount,
    tool_count: metrics.toolCount,
    sessionSummary: JSON.stringify(summary, null, 2),
    maxSnarkyWords: config.maxSnarkyWords,
  })

  const llmConfig = config.llm?.snarkyComment ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.snarkyComment!
  const profileResult = getEffectiveProfile(persona, llmConfig, config, ctx.config.llm.profiles, ctx.logger)
  if ('errorMessage' in profileResult) {
    return { status: 'error', error: new Error(profileResult.errorMessage) }
  }

  const provider = ctx.profileFactory.createForProfile(profileResult.profileId, llmConfig.fallbackProfile)

  logEvent(ctx.logger, SessionSummaryEvents.snarkyMessageStart({ sessionId }, { sessionId }))

  try {
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
    })

    const snarkyMessage = stripSurroundingQuotes(response.content.trim())
    const snarkyState: SnarkyMessageState = {
      message: snarkyMessage,
      timestamp: new Date().toISOString(),
    }

    await summaryState.snarkyMessage.write(sessionId, snarkyState)

    logEvent(ctx.logger, SessionSummaryEvents.snarkyMessageFinish({ sessionId }, { generatedMessage: snarkyMessage }))

    return { status: 'success', state: snarkyState }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return { status: 'error', error }
  }
}

// ============================================================================
// generateResumeCore
// ============================================================================

/**
 * Shared resume message generation pipeline.
 *
 * Extracts the identical steps from generateResumeMessage (periodic) and
 * generateResumeMessageOnDemand (on-demand). Callers handle their own
 * logging and result translation.
 *
 * No events are emitted by core — resume-specific log events
 * (resumeUpdated, resumeSkipped) stay in the periodic wrapper.
 *
 * @returns Discriminated union: success (with state), deterministic, skipped, or error
 */
export async function generateResumeCore(params: ResumeCoreParams): Promise<ResumeResult> {
  const { ctx, sessionId, summaryState, summary, config } = params

  if (
    summary.session_title_confidence < RESUME_MIN_CONFIDENCE ||
    summary.latest_intent_confidence < RESUME_MIN_CONFIDENCE
  ) {
    return { status: 'skipped', reason: 'low_confidence' }
  }

  const persona = await loadSessionPersona(ctx, sessionId, summaryState)

  if (persona?.id === 'disabled') {
    const resumeState: ResumeMessageState = {
      last_task_id: null,
      session_title: summary.session_title,
      snarky_comment: summary.latest_intent,
      timestamp: new Date().toISOString(),
      persona_id: null,
      persona_display_name: null,
    }
    await summaryState.resumeMessage.write(sessionId, resumeState)
    return { status: 'deterministic', state: resumeState }
  }

  const promptTemplate = ctx.assets.resolve(RESUME_PROMPT_FILE)
  if (!promptTemplate) {
    ctx.logger.warn('Resume message prompt not found', { path: RESUME_PROMPT_FILE })
    return { status: 'skipped', reason: 'prompt_not_found' }
  }

  const personaContext = buildPersonaContext(persona)
  const userProfileContext = loadUserProfileContext(ctx.logger)

  const excerpt = params.transcript.getExcerpt(params.excerptOptions)

  const keyPhrases = summary.session_title_key_phrases?.join(', ') ?? ''

  const prompt = interpolateTemplate(promptTemplate, {
    ...personaContext,
    ...userProfileContext,
    sessionTitle: summary.session_title,
    confidence: summary.session_title_confidence,
    latestIntent: summary.latest_intent,
    keyPhrases,
    transcript: excerpt.content,
    maxResumeWords: config.maxResumeWords,
  })

  const llmConfig = config.llm?.resumeMessage ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.resumeMessage!
  const profileResult = getEffectiveProfile(persona, llmConfig, config, ctx.config.llm.profiles, ctx.logger)
  if ('errorMessage' in profileResult) {
    return { status: 'error', error: new Error(profileResult.errorMessage) }
  }

  const provider = ctx.profileFactory.createForProfile(profileResult.profileId, llmConfig.fallbackProfile)

  try {
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
    })

    const snarkyWelcome = stripSurroundingQuotes(response.content.trim())
    const resumeState: ResumeMessageState = {
      last_task_id: null,
      session_title: summary.session_title,
      snarky_comment: snarkyWelcome,
      timestamp: new Date().toISOString(),
      persona_id: persona?.id ?? null,
      persona_display_name: persona?.display_name ?? null,
    }

    await summaryState.resumeMessage.write(sessionId, resumeState)

    return { status: 'success', state: resumeState }
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err))
    return { status: 'error', error }
  }
}
