/**
 * On-Demand Persona Message Generation
 *
 * Provides exported functions for CLI-triggered snarky and resume message generation.
 * Used by the `sidekick persona-test` command to test persona voice differentiation.
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md
 */

import type { DaemonContext, SessionPersonaState } from '@sidekick/types'
import type { SessionSummaryConfig } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG, RESUME_MIN_CONFIDENCE } from '../types.js'
import { createSessionSummaryState } from '../state.js'
import { createPersonaLoader, getDefaultPersonasDir } from '@sidekick/core'
import {
  generateSnarkyCore,
  generateResumeCore,
  SNARKY_PROMPT_FILE,
  RESUME_PROMPT_FILE,
} from './message-generation-core.js'

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

  // Load session summary (wrapper-level null check)
  const summaryResult = await summaryState.sessionSummary.read(sessionId)
  if (!summaryResult.data) {
    return {
      success: false,
      error: 'No session summary found. Run some commands first to generate a summary.',
    }
  }
  const summary = summaryResult.data

  // Load config
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }

  // Delegate to shared core pipeline
  const result = await generateSnarkyCore({ ctx, sessionId, summaryState, summary, config })

  // Map core result to GenerationResult
  switch (result.status) {
    case 'success':
      ctx.logger.info('Generated snarky message on-demand', { sessionId })
      return { success: true }
    case 'skipped':
      return {
        success: false,
        error:
          result.reason === 'persona_disabled'
            ? 'Persona is "disabled" - snarky messages are skipped.'
            : `Snarky prompt template not found: ${SNARKY_PROMPT_FILE}`,
      }
    case 'error':
      ctx.logger.error('Failed to generate snarky message on-demand', {
        sessionId,
        error: result.error.message,
      })
      return { success: false, error: `LLM call failed: ${result.error.message}` }
  }
}

/**
 * Generate a resume message on-demand.
 * Requires an existing session summary with sufficient confidence.
 */
export async function generateResumeMessageOnDemand(ctx: DaemonContext, sessionId: string): Promise<GenerationResult> {
  const summaryState = createSessionSummaryState(ctx.stateService)

  // Load session summary (wrapper-level null check)
  const summaryResult = await summaryState.sessionSummary.read(sessionId)
  if (!summaryResult.data) {
    return {
      success: false,
      error: 'No session summary found. Run some commands first to generate a summary.',
    }
  }
  const summary = summaryResult.data

  // Load config
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }

  // Hard-coded excerpt options for on-demand generation
  const excerptOptions = {
    maxLines: 50,
    includeToolMessages: true,
    includeToolOutputs: false,
    includeAssistantThinking: false,
  }

  // Delegate to shared core pipeline
  const result = await generateResumeCore({
    ctx,
    sessionId,
    summaryState,
    summary,
    config,
    excerptOptions,
    transcript: ctx.transcript,
  })

  // Map core result to GenerationResult
  switch (result.status) {
    case 'success':
      ctx.logger.info('Generated resume message on-demand', { sessionId })
      return { success: true }
    case 'deterministic':
      ctx.logger.info('Generated deterministic resume message (disabled persona)', { sessionId })
      return { success: true }
    case 'skipped':
      return {
        success: false,
        error:
          result.reason === 'low_confidence'
            ? `Confidence too low for resume generation. Title: ${summary.session_title_confidence}, Intent: ${summary.latest_intent_confidence}, Min: ${RESUME_MIN_CONFIDENCE}`
            : `Resume prompt template not found: ${RESUME_PROMPT_FILE}`,
      }
    case 'error':
      ctx.logger.error('Failed to generate resume message on-demand', {
        sessionId,
        error: result.error.message,
      })
      return { success: false, error: `LLM call failed: ${result.error.message}` }
  }
}
