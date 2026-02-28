/**
 * On-Demand Persona Message Generation
 *
 * Provides exported functions for CLI-triggered snarky and resume message generation.
 * Used by the `sidekick persona-test` command to test persona voice differentiation.
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md
 */

import type { DaemonContext, SessionPersonaState, SnarkyMessageState } from '@sidekick/types'
import type { ResumeMessageState, SessionSummaryConfig } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG, RESUME_MIN_CONFIDENCE } from '../types.js'
import { createSessionSummaryState } from '../state.js'
import { createPersonaLoader, getDefaultPersonasDir } from '@sidekick/core'
import { interpolateTemplate } from './update-summary.js'
import {
  buildPersonaContext,
  getEffectiveProfile,
  loadSessionPersona,
  stripSurroundingQuotes,
} from './persona-utils.js'

const SNARKY_PROMPT_FILE = 'prompts/snarky-message.prompt.txt'
const RESUME_PROMPT_FILE = 'prompts/resume-message.prompt.txt'

/**
 * Result of on-demand generation operations.
 */
export interface GenerationResult {
  success: boolean
  error?: string
}

/**
 * Result of SetSessionPersona operation.
 */
export interface SetPersonaResult {
  success: boolean
  previousPersonaId?: string
  error?: string
}

/**
 * Set the session persona, overwriting any existing selection.
 * Used by persona-test CLI to override persona before generation.
 */
export async function setSessionPersona(
  ctx: DaemonContext,
  sessionId: string,
  personaId: string
): Promise<SetPersonaResult> {
  const summaryState = createSessionSummaryState(ctx.stateService)

  // Validate persona exists
  const loader = createPersonaLoader({
    defaultPersonasDir: getDefaultPersonasDir(),
    projectRoot: ctx.paths.projectDir,
    logger: ctx.logger,
  })
  const personas = loader.discover()

  if (!personas.has(personaId)) {
    return {
      success: false,
      error: `Persona "${personaId}" not found. Available: ${Array.from(personas.keys()).join(', ')}`,
    }
  }

  // Read existing persona (if any) for logging
  const existingResult = await summaryState.sessionPersona.read(sessionId)
  const previousPersonaId = existingResult.data?.persona_id

  // Write new persona selection
  const newState: SessionPersonaState = {
    persona_id: personaId,
    selected_from: Array.from(personas.keys()),
    timestamp: new Date().toISOString(),
  }

  await summaryState.sessionPersona.write(sessionId, newState)

  ctx.logger.info('Session persona set', { sessionId, personaId, previousPersonaId })

  return {
    success: true,
    previousPersonaId,
  }
}

/**
 * Generate a snarky message on-demand.
 * Requires an existing session summary.
 */
export async function generateSnarkyMessageOnDemand(ctx: DaemonContext, sessionId: string): Promise<GenerationResult> {
  const summaryState = createSessionSummaryState(ctx.stateService)

  // Load session summary
  const summaryResult = await summaryState.sessionSummary.read(sessionId)
  if (!summaryResult.data) {
    return {
      success: false,
      error: 'No session summary found. Run some commands first to generate a summary.',
    }
  }
  const summary = summaryResult.data

  // Load session persona (pass summaryState to avoid redundant creation)
  const persona = await loadSessionPersona(ctx, sessionId, summaryState)

  // Disabled persona: skip generation
  if (persona?.id === 'disabled') {
    return {
      success: false,
      error: 'Persona is "disabled" - snarky messages are skipped.',
    }
  }

  const promptTemplate = ctx.assets.resolve(SNARKY_PROMPT_FILE)
  if (!promptTemplate) {
    return {
      success: false,
      error: `Snarky prompt template not found: ${SNARKY_PROMPT_FILE}`,
    }
  }

  // Build persona context for template interpolation
  const personaContext = buildPersonaContext(persona)

  // Get profile configuration for snarky comment
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }

  // Interpolate prompt with session summary data and persona
  const prompt = interpolateTemplate(promptTemplate, {
    ...personaContext,
    session_title: summary.session_title,
    latest_intent: summary.latest_intent,
    turn_count: ctx.transcript.getMetrics().turnCount,
    tool_count: ctx.transcript.getMetrics().toolCount,
    sessionSummary: JSON.stringify(summary, null, 2),
    maxSnarkyWords: config.maxSnarkyWords,
  })
  const llmConfig = config.llm?.snarkyComment ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.snarkyComment!

  // Resolve persona-specific LLM profile override
  const profileResult = getEffectiveProfile(persona, llmConfig, config, ctx.config.llm.profiles, ctx.logger)
  if ('errorMessage' in profileResult) {
    return { success: false, error: profileResult.errorMessage }
  }

  const provider = ctx.profileFactory.createForProfile(profileResult.profileId, llmConfig.fallbackProfile)

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

    ctx.logger.info('Generated snarky message on-demand', {
      sessionId,
      personaId: persona?.id ?? 'none',
    })

    return { success: true }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    ctx.logger.error('Failed to generate snarky message on-demand', { sessionId, error: errorMsg })
    return {
      success: false,
      error: `LLM call failed: ${errorMsg}`,
    }
  }
}

/**
 * Generate a resume message on-demand.
 * Requires an existing session summary with sufficient confidence.
 */
export async function generateResumeMessageOnDemand(ctx: DaemonContext, sessionId: string): Promise<GenerationResult> {
  const summaryState = createSessionSummaryState(ctx.stateService)

  // Load session summary
  const summaryResult = await summaryState.sessionSummary.read(sessionId)
  if (!summaryResult.data) {
    return {
      success: false,
      error: 'No session summary found. Run some commands first to generate a summary.',
    }
  }
  const summary = summaryResult.data

  // Check confidence thresholds
  if (
    summary.session_title_confidence < RESUME_MIN_CONFIDENCE ||
    summary.latest_intent_confidence < RESUME_MIN_CONFIDENCE
  ) {
    return {
      success: false,
      error: `Confidence too low for resume generation. Title: ${summary.session_title_confidence}, Intent: ${summary.latest_intent_confidence}, Min: ${RESUME_MIN_CONFIDENCE}`,
    }
  }

  // Load session persona (pass summaryState to avoid redundant creation)
  const persona = await loadSessionPersona(ctx, sessionId, summaryState)

  // Disabled persona: use deterministic output
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

    ctx.logger.info('Generated deterministic resume message (disabled persona)', { sessionId })
    return { success: true }
  }

  const promptTemplate = ctx.assets.resolve(RESUME_PROMPT_FILE)
  if (!promptTemplate) {
    return {
      success: false,
      error: `Resume prompt template not found: ${RESUME_PROMPT_FILE}`,
    }
  }

  // Build persona context for template interpolation
  const personaContext = buildPersonaContext(persona)

  // Get profile configuration for resume message
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }

  // Get transcript excerpt
  const excerpt = ctx.transcript.getExcerpt({
    maxLines: 50,
    includeToolMessages: true,
    includeToolOutputs: false,
    includeAssistantThinking: false,
  })

  // Interpolate prompt with session data and persona
  const keyPhrases = summary.session_title_key_phrases?.join(', ') ?? ''
  const prompt = interpolateTemplate(promptTemplate, {
    ...personaContext,
    sessionTitle: summary.session_title,
    confidence: summary.session_title_confidence,
    latestIntent: summary.latest_intent,
    keyPhrases,
    transcript: excerpt.content,
    maxResumeWords: config.maxResumeWords,
  })
  const llmConfig = config.llm?.resumeMessage ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.resumeMessage!

  // Resolve persona-specific LLM profile override
  const profileResult = getEffectiveProfile(persona, llmConfig, config, ctx.config.llm.profiles, ctx.logger)
  if ('errorMessage' in profileResult) {
    return { success: false, error: profileResult.errorMessage }
  }

  const provider = ctx.profileFactory.createForProfile(profileResult.profileId, llmConfig.fallbackProfile)

  try {
    // Resume message now outputs plain text (snarky_welcome only)
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
    })

    // Strip surrounding quotes if present
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

    ctx.logger.info('Generated resume message on-demand', {
      sessionId,
      personaId: persona?.id ?? 'none',
    })

    return { success: true }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    ctx.logger.error('Failed to generate resume message on-demand', { sessionId, error: errorMsg })
    return {
      success: false,
      error: `LLM call failed: ${errorMsg}`,
    }
  }
}
