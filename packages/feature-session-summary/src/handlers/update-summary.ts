/**
 * UpdateSessionSummary Handler
 *
 * Performs LLM-based transcript analysis. Triggered by:
 * - UserPrompt events (force analysis)
 * - ToolResult events (conditional, based on countdown)
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Prompt Injection
 */

import type { TranscriptEvent } from '@sidekick/core'
import { logEvent, LogEvents } from '@sidekick/core'
import { SessionSummaryEvents } from '../events.js'
import { DecisionEvents } from '@sidekick/types'
import type { DaemonContext, EventContext, SummaryCountdownState, SnarkyMessageState } from '@sidekick/types'
import { z } from 'zod'
import type { ResumeMessageState, SessionSummaryConfig, SessionSummaryState } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG, RESUME_MIN_CONFIDENCE } from '../types.js'
import { createSessionSummaryState, type SessionSummaryStateAccessors } from '../state.js'
import {
  buildPersonaContext,
  getEffectiveProfile,
  loadSessionPersona,
  loadUserProfileContext,
  stripSurroundingQuotes,
} from './persona-utils.js'
import { ensurePersonaForSession } from './persona-selection.js'

/** Human-readable titles for decision:recorded events shown in the UI timeline. */
const DECISION_TITLE_SKIP = 'Skip session analysis'
const DECISION_TITLE_RUN = 'Run session analysis'

/**
 * Per-session concurrency guard for analysis with coalescing.
 * When analysis is requested while one is already in-flight,
 * the pending flag is set so a single rerun occurs after completion.
 * This prevents dropped analyses while bounding concurrency to at most
 * two sequential runs (current + one coalesced rerun).
 *
 * Map key: sessionId, value: true if a rerun is pending.
 */
const analysisInFlight = new Map<string, boolean>()

const PROMPT_FILE = 'prompts/session-summary.prompt.txt'
const SNARKY_PROMPT_FILE = 'prompts/snarky-message.prompt.txt'
const RESUME_PROMPT_FILE = 'prompts/resume-message.prompt.txt'
const SESSION_SUMMARY_SCHEMA_FILE = 'schemas/session-summary.schema.json'

/**
 * Zod schema for LLM response validation.
 * Matches assets/sidekick/schemas/session-summary.schema.json
 * Note: No .max() constraints - prompts specify limits, we accept if LLM overshoots.
 */
const SessionSummaryResponseSchema = z.object({
  session_title: z.string(),
  session_title_confidence: z.number().min(0).max(1),
  session_title_key_phrases: z.array(z.string()).optional(),
  latest_intent: z.string(),
  latest_intent_confidence: z.number().min(0).max(1),
  latest_intent_key_phrases: z.array(z.string()).optional(),
  pivot_detected: z.boolean(),
})

/** @internal Exported for test assertions on step function return types */
export type SessionSummaryResponse = z.infer<typeof SessionSummaryResponseSchema>

// Re-export for backward compatibility with tests
export { buildPersonaContext, type PersonaTemplateContext } from './persona-utils.js'

/**
 * Reset the per-session concurrency guard.
 * @internal Exported for test isolation only.
 */
export function resetAnalysisGuard(): void {
  analysisInFlight.clear()
}

/**
 * Simple template processor with Handlebars-like {{#if}}...{{/if}} support.
 * Handles:
 * - {{#if var}}...{{/if}} conditional blocks
 * - {{variable}} simple replacements
 * @internal Exported for testing
 */
export function interpolateTemplate(template: string, context: Record<string, string | boolean | number>): string {
  let result = template

  // Process {{#if var}}...{{/if}} blocks iteratively until no more matches
  // This handles nested conditionals by processing innermost first
  const conditionalRegex = /\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g
  let previous = ''
  while (result !== previous) {
    previous = result
    result = result.replace(conditionalRegex, (_, varName: string, content: string) => {
      const value = context[varName]
      return value ? content : ''
    })
  }

  // Process {{variable}} replacements
  result = result.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
    const value = context[varName]
    return value !== undefined ? String(value) : ''
  })

  return result
}

/**
 * Update session summary based on transcript events
 */
export async function updateSessionSummary(event: TranscriptEvent, ctx: DaemonContext): Promise<void> {
  const { sessionId } = event.context
  const isUserPrompt = event.eventType === 'UserPrompt'

  // Create typed state accessors for this request
  const summaryState = createSessionSummaryState(ctx.stateService)

  // Skip LLM calls during bulk processing (first-time transcript replay)
  // Handlers will be triggered again with BulkProcessingComplete for single analysis
  if (event.metadata?.isBulkProcessing) {
    ctx.logger.debug('Skipping session summary during bulk processing', {
      sessionId,
      eventType: event.eventType,
      lineNumber: event.payload.lineNumber,
    })
    return
  }

  // Handle BulkProcessingComplete - run one-time analysis after bulk replay
  if (event.eventType === 'BulkProcessingComplete') {
    // Ensure persona state exists (recovery after clean-all or setup reset)
    // BulkProcessingComplete fires when daemon starts watching a session,
    // which happens after daemon restart following state-clearing operations.
    await ensurePersonaForSession(sessionId, ctx)

    // Skip if no user interaction in transcript (e.g., only summary/system entries)
    const metrics = ctx.transcript.getMetrics()
    if (metrics.turnCount === 0) {
      logEvent(
        ctx.logger,
        DecisionEvents.decisionRecorded(event.context, {
          decision: 'skipped',
          reason: 'BulkProcessingComplete with no user turns (turnCount=0)',
          subsystem: 'session-summary',
          title: DECISION_TITLE_SKIP,
        })
      )
      return
    }

    logEvent(
      ctx.logger,
      DecisionEvents.decisionRecorded(event.context, {
        decision: 'calling',
        reason: 'Bulk transcript replay complete — running catch-up analysis',
        subsystem: 'session-summary',
        title: DECISION_TITLE_RUN,
      })
    )
    const countdown = await loadCountdownState(summaryState, sessionId)
    void performAnalysis(event, ctx, summaryState, countdown, 'bulk_replay_complete')
    return
  }

  // Load current countdown state
  const countdown = await loadCountdownState(summaryState, sessionId)

  // UserPrompt forces immediate analysis
  if (isUserPrompt) {
    void performAnalysis(event, ctx, summaryState, countdown, 'user_prompt_forced')
    return
  }

  // ToolResult: check countdown
  if (countdown.countdown > 0) {
    countdown.countdown--
    await saveCountdownState(summaryState, sessionId, countdown)
    return
  }

  // Countdown reached zero - perform analysis
  logEvent(
    ctx.logger,
    DecisionEvents.decisionRecorded(event.context, {
      decision: 'calling',
      reason: 'Prompt countdown reached zero — running scheduled analysis',
      subsystem: 'session-summary',
      title: DECISION_TITLE_RUN,
    })
  )
  void performAnalysis(event, ctx, summaryState, countdown, 'countdown_reached')
}

async function loadCountdownState(
  summaryState: SessionSummaryStateAccessors,
  sessionId: string
): Promise<SummaryCountdownState> {
  const result = await summaryState.summaryCountdown.read(sessionId)
  return result.data
}

/**
 * Check if resume-message.json already exists for this session.
 * Used to trigger initial resume generation even without pivot detection.
 * @see docs/design/FEATURE-RESUME.md §3.2
 */
async function resumeMessageExists(summaryState: SessionSummaryStateAccessors, sessionId: string): Promise<boolean> {
  // read() returns null when file is missing (default value)
  const result = await summaryState.resumeMessage.read(sessionId)
  return result.data !== null
}

async function saveCountdownState(
  summaryState: SessionSummaryStateAccessors,
  sessionId: string,
  state: SummaryCountdownState
): Promise<void> {
  await summaryState.summaryCountdown.write(sessionId, state)
}

/**
 * Load and interpolate prompt template.
 * Uses {{variable}} mustache-style placeholders.
 */
function interpolatePrompt(
  template: string,
  context: {
    transcript: string
    previousConfidence: number
    previousAnalysis: string
    maxTitleWords: number
    maxIntentWords: number
  }
): string {
  return template
    .replace(/\{\{transcript\}\}/g, context.transcript)
    .replace(/\{\{previousConfidence\}\}/g, String(context.previousConfidence))
    .replace(/\{\{previousAnalysis\}\}/g, context.previousAnalysis)
    .replace(/\{\{maxTitleWords\}\}/g, String(context.maxTitleWords))
    .replace(/\{\{maxIntentWords\}\}/g, String(context.maxIntentWords))
}

/**
 * Parse and validate LLM response as JSON.
 */
function parseResponse(content: string): SessionSummaryResponse | null {
  try {
    // Extract JSON from response (handle markdown code blocks)
    let jsonStr = content
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }

    const parsed: unknown = JSON.parse(jsonStr)
    return SessionSummaryResponseSchema.parse(parsed)
  } catch {
    return null
  }
}

// ============================================================================
// Analysis Step Functions
// ============================================================================
// Extracted from performAnalysis for testability and clarity.
// Each step is a pure-ish function with explicit inputs/outputs.
// ============================================================================

/** Return type for loadAnalysisInputs */
export interface AnalysisInputs {
  config: SessionSummaryConfig
  currentSummary: SessionSummaryState | null
  excerpt: string
  previousContext: string
  previousConfidence: number
  prompt: string | null
  schema:
    | {
        name: string
        schema: Record<string, unknown>
      }
    | undefined
}

/**
 * Step 1: Load all inputs needed for LLM analysis.
 * Loads config, current summary, transcript excerpt, prompt template, and schema.
 * Returns null prompt when asset not found (caller should bail).
 * @internal Exported for testing.
 */
export async function loadAnalysisInputs(
  ctx: DaemonContext,
  summaryState: SessionSummaryStateAccessors,
  transcript: DaemonContext['transcript'],
  countdown: SummaryCountdownState,
  sessionId: string
): Promise<AnalysisInputs> {
  // Merge feature config with defaults
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }

  // Load current summary (null when file is missing)
  const summaryResult = await summaryState.sessionSummary.read(sessionId)
  const currentSummary = summaryResult.data

  // Extract transcript excerpt via TranscriptService
  const excerptResult = transcript.getExcerpt({
    maxLines: config.excerptLines,
    bookmarkLine: countdown.bookmark_line,
    includeToolMessages: config.includeToolMessages,
    includeToolOutputs: config.includeToolOutputs,
    includeAssistantThinking: config.includeAssistantThinking,
  })
  const excerpt = excerptResult.content

  // Build previous analysis context
  const previousContext = currentSummary
    ? JSON.stringify(
        {
          session_title: currentSummary.session_title,
          latest_intent: currentSummary.latest_intent,
        },
        null,
        2
      )
    : 'No previous analysis'
  const previousConfidence = currentSummary?.session_title_confidence ?? 0

  // Load prompt template
  const promptTemplate = ctx.assets.resolve(PROMPT_FILE)
  let prompt: string | null = null
  if (promptTemplate) {
    prompt = interpolatePrompt(promptTemplate, {
      transcript: excerpt,
      previousConfidence,
      previousAnalysis: previousContext,
      maxTitleWords: config.maxTitleWords,
      maxIntentWords: config.maxIntentWords,
    })
  } else {
    ctx.logger.error('Failed to load session summary prompt template', { path: PROMPT_FILE })
  }

  // Load JSON schema for structured output
  const schemaContent = ctx.assets.resolve(SESSION_SUMMARY_SCHEMA_FILE)
  const schema = schemaContent
    ? {
        name: 'session-summary',
        schema: JSON.parse(schemaContent) as Record<string, unknown>,
      }
    : undefined

  return { config, currentSummary, excerpt, previousContext, previousConfidence, prompt, schema }
}

/** Return type for callSummaryLLM */
export interface LLMResult {
  parsedResponse: SessionSummaryResponse | null
  tokenCount: number
}

/**
 * Step 2: Call the LLM provider and parse the response.
 * Returns parsed response (null on failure) and token count.
 * @internal Exported for testing.
 */
export async function callSummaryLLM(
  ctx: DaemonContext,
  prompt: string,
  schema: AnalysisInputs['schema'],
  config: SessionSummaryConfig,
  sessionId: string
): Promise<LLMResult> {
  const llmConfig = config.llm?.sessionSummary ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.sessionSummary!
  const provider = ctx.profileFactory.createForProfile(llmConfig.profile, llmConfig.fallbackProfile)

  let parsedResponse: SessionSummaryResponse | null = null
  let tokenCount = 0

  try {
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
      jsonSchema: schema,
    })

    tokenCount = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0)
    parsedResponse = parseResponse(response.content)

    if (!parsedResponse) {
      ctx.logger.warn('Failed to parse LLM response', { sessionId, content: response.content.slice(0, 200) })
    }
  } catch (err) {
    ctx.logger.error('LLM call failed', { sessionId, error: String(err) })
  }

  return { parsedResponse, tokenCount }
}

/**
 * Step 3: Merge LLM response into existing summary and persist.
 * Returns the updated summary state.
 * @internal Exported for testing.
 */
export async function updateSummaryState(
  summaryState: SessionSummaryStateAccessors,
  parsedResponse: SessionSummaryResponse | null,
  currentSummary: SessionSummaryState | null,
  sessionId: string,
  tokenCount: number,
  startTime: number
): Promise<SessionSummaryState> {
  const updatedSummary: SessionSummaryState = {
    ...currentSummary,
    session_id: sessionId,
    timestamp: new Date().toISOString(),
    session_title: parsedResponse?.session_title ?? currentSummary?.session_title ?? 'Analysis pending...',
    session_title_confidence: parsedResponse?.session_title_confidence ?? currentSummary?.session_title_confidence ?? 0,
    session_title_key_phrases: parsedResponse?.session_title_key_phrases ?? currentSummary?.session_title_key_phrases,
    latest_intent: parsedResponse?.latest_intent ?? currentSummary?.latest_intent ?? 'Processing...',
    latest_intent_confidence: parsedResponse?.latest_intent_confidence ?? currentSummary?.latest_intent_confidence ?? 0,
    latest_intent_key_phrases: parsedResponse?.latest_intent_key_phrases ?? currentSummary?.latest_intent_key_phrases,
    pivot_detected: parsedResponse?.pivot_detected ?? false,
    previous_title: currentSummary?.session_title,
    previous_intent: currentSummary?.latest_intent,
    stats: {
      total_tokens: tokenCount,
      processing_time_ms: Date.now() - startTime,
    },
  }

  await summaryState.sessionSummary.write(sessionId, updatedSummary)
  return updatedSummary
}

/**
 * Step 4: Reset countdown and bookmark based on confidence thresholds.
 * High confidence → bookmark at current line, long countdown.
 * Low confidence → reset bookmark to 0, short countdown.
 * Medium → preserve existing bookmark, medium countdown.
 * @internal Exported for testing.
 */
export async function resetCountdown(
  summaryState: SessionSummaryStateAccessors,
  config: SessionSummaryConfig,
  updatedSummary: SessionSummaryState,
  lineNumber: number,
  countdown: SummaryCountdownState,
  sessionId: string
): Promise<void> {
  const avgConfidence = (updatedSummary.session_title_confidence + updatedSummary.latest_intent_confidence) / 2
  let newCountdown: number
  if (avgConfidence > 0.8) {
    newCountdown = config.countdown.highConfidence
  } else if (avgConfidence > 0.6) {
    newCountdown = config.countdown.mediumConfidence
  } else {
    newCountdown = config.countdown.lowConfidence
  }

  // Update bookmark line based on confidence thresholds
  // - High confidence (> confidenceThreshold): set bookmark to current line
  // - Low confidence (< resetThreshold): reset bookmark (possible topic pivot)
  // - Medium confidence: preserve existing bookmark
  let bookmarkLine: number
  if (avgConfidence > config.bookmark.confidenceThreshold) {
    bookmarkLine = lineNumber
  } else if (avgConfidence < config.bookmark.resetThreshold) {
    bookmarkLine = 0
  } else {
    bookmarkLine = countdown.bookmark_line
  }

  await saveCountdownState(summaryState, sessionId, {
    countdown: newCountdown,
    bookmark_line: bookmarkLine,
  })
}

/**
 * Step 5: Orchestrate side-effect generation (snarky + resume messages).
 * Spawns snarky and resume generation in parallel when conditions are met.
 * @internal Exported for testing.
 */
export async function orchestrateSideEffects(
  ctx: DaemonContext,
  eventContext: EventContext,
  sessionId: string,
  summaryState: SessionSummaryStateAccessors,
  config: SessionSummaryConfig,
  transcript: string,
  currentSummary: SessionSummaryState | null,
  updatedSummary: SessionSummaryState
): Promise<void> {
  const sideEffects: Promise<void>[] = []

  // Snarky message: generate when title or intent changed significantly
  // OR when this is the first summary (no previous state exists)
  const changes = hasSignificantChange(updatedSummary, currentSummary)
  const isInitialAnalysis = !currentSummary
  if (config.snarkyMessages && (isInitialAnalysis || changes.titleChanged || changes.intentChanged)) {
    // Note: We don't delete the old file first. If LLM fails, we keep stale over nothing.
    sideEffects.push(generateSnarkyMessage(ctx, summaryState, sessionId, updatedSummary, config))
  }

  // Resume message: generate when pivot detected OR when no resume exists yet
  // @see docs/design/FEATURE-RESUME.md §3.2
  const hasResume = await resumeMessageExists(summaryState, sessionId)
  if (updatedSummary.pivot_detected || !hasResume) {
    sideEffects.push(generateResumeMessage(ctx, summaryState, eventContext, updatedSummary, transcript, config))
  }

  // Await all side-effects (errors are logged internally, won't fail main flow)
  if (sideEffects.length > 0) {
    await Promise.all(sideEffects)
  }
}

/**
 * Step 6: Emit analysis completion events.
 * Emits title-changed, intent-changed (when applicable), and summary-finish (always).
 * @internal Exported for testing.
 */
export function emitAnalysisEvents(
  logger: DaemonContext['logger'],
  eventContext: EventContext,
  currentSummary: SessionSummaryState | null,
  updatedSummary: SessionSummaryState
): void {
  // Emit title-changed if title differs
  if (currentSummary && updatedSummary.session_title !== currentSummary.session_title) {
    logEvent(
      logger,
      SessionSummaryEvents.titleChanged(eventContext, {
        previousValue: currentSummary.session_title,
        newValue: updatedSummary.session_title,
        confidence: updatedSummary.session_title_confidence,
      })
    )
  }

  // Emit intent-changed if intent differs
  if (currentSummary && updatedSummary.latest_intent !== currentSummary.latest_intent) {
    logEvent(
      logger,
      SessionSummaryEvents.intentChanged(eventContext, {
        previousValue: currentSummary.latest_intent,
        newValue: updatedSummary.latest_intent,
        confidence: updatedSummary.latest_intent_confidence,
      })
    )
  }

  // Always emit summary-finish
  logEvent(
    logger,
    SessionSummaryEvents.summaryFinish(eventContext, {
      session_title: updatedSummary.session_title,
      session_title_confidence: updatedSummary.session_title_confidence,
      latest_intent: updatedSummary.latest_intent,
      latest_intent_confidence: updatedSummary.latest_intent_confidence,
      processing_time_ms: updatedSummary.stats?.processing_time_ms ?? 0,
      pivot_detected: updatedSummary.pivot_detected ?? false,
    })
  )
}

// ============================================================================
// Orchestrator
// ============================================================================

async function performAnalysis(
  event: TranscriptEvent,
  ctx: DaemonContext,
  summaryState: SessionSummaryStateAccessors,
  countdown: SummaryCountdownState,
  // Note: compaction_reset reserved for future compaction-triggered re-analysis
  reason: 'user_prompt_forced' | 'countdown_reached' | 'compaction_reset' | 'bulk_replay_complete'
): Promise<void> {
  const { context: eventContext, payload } = event
  const { sessionId } = eventContext

  // Concurrency guard with coalescing: if analysis is already in-flight,
  // set the pending flag so a rerun occurs after the current one finishes.
  // This prevents dropped analyses while bounding concurrency.
  if (analysisInFlight.has(sessionId)) {
    analysisInFlight.set(sessionId, true)
    logEvent(
      ctx.logger,
      DecisionEvents.decisionRecorded(eventContext, {
        decision: 'deferred',
        reason: 'Analysis deferred — will rerun after current analysis completes',
        subsystem: 'session-summary',
        title: DECISION_TITLE_SKIP,
      })
    )
    return
  }
  analysisInFlight.set(sessionId, false)

  try {
    const startTime = Date.now()

    // Emit start event
    logEvent(ctx.logger, SessionSummaryEvents.summaryStart(eventContext, { reason, countdown: countdown.countdown }))

    const inputs = await loadAnalysisInputs(ctx, summaryState, ctx.transcript, countdown, sessionId)
    if (!inputs.prompt) {
      return
    }

    const llmResult = await callSummaryLLM(ctx, inputs.prompt, inputs.schema, inputs.config, sessionId)
    const updated = await updateSummaryState(
      summaryState,
      llmResult.parsedResponse,
      inputs.currentSummary,
      sessionId,
      llmResult.tokenCount,
      startTime
    )
    await resetCountdown(summaryState, inputs.config, updated, payload.lineNumber, countdown, sessionId)
    await orchestrateSideEffects(
      ctx,
      eventContext,
      sessionId,
      summaryState,
      inputs.config,
      inputs.excerpt,
      inputs.currentSummary,
      updated
    )
    emitAnalysisEvents(ctx.logger, eventContext, inputs.currentSummary, updated)

    // Log completion
    const avgConfidence = (updated.session_title_confidence + updated.latest_intent_confidence) / 2
    ctx.logger.info('Updated session summary', {
      sessionId,
      reason,
      title: updated.session_title,
      confidence: avgConfidence,
      tokensUsed: llmResult.tokenCount,
    })
  } catch (err) {
    ctx.logger.error('performAnalysis failed', {
      sessionId,
      reason,
      error: err instanceof Error ? err.message : String(err),
    })
  } finally {
    const rerunPending = analysisInFlight.get(sessionId) ?? false
    analysisInFlight.delete(sessionId)

    // If a rerun was requested while we were running, perform one coalesced rerun.
    // Re-load countdown state to get the latest bookmark/countdown values.
    if (rerunPending) {
      const freshCountdown = await loadCountdownState(summaryState, sessionId)
      void performAnalysis(event, ctx, summaryState, freshCountdown, reason)
    }
  }
}

/**
 * Check if title or intent changed significantly.
 * A significant change is when the text content differs (not just confidence).
 *
 * Note: This is intentionally different from pivot_detected:
 * - pivot_detected = hard topic shift → triggers resume message
 * - hasSignificantChange = any text change → triggers snarky message
 * Snarky messages fire on incremental changes within the same topic.
 */
function hasSignificantChange(
  current: SessionSummaryState,
  previous: SessionSummaryState | null
): { titleChanged: boolean; intentChanged: boolean } {
  if (!previous) {
    return { titleChanged: false, intentChanged: false }
  }
  return {
    titleChanged: current.session_title !== previous.session_title,
    intentChanged: current.latest_intent !== previous.latest_intent,
  }
}

/**
 * Generate snarky message as a side-effect.
 * Called when title or intent changed significantly.
 * Uses separate LLM call with higher temperature for creativity.
 *
 * Persona injection:
 * - If persona is "disabled", skip LLM call entirely
 * - If persona is selected, inject persona context into prompt
 * - If no persona, omit persona block from prompt
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.4
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Disabled Persona Behavior
 */
async function generateSnarkyMessage(
  ctx: DaemonContext,
  summaryState: SessionSummaryStateAccessors,
  sessionId: string,
  summary: SessionSummaryState,
  config: SessionSummaryConfig
): Promise<void> {
  // Load session persona
  const persona = await loadSessionPersona(ctx, sessionId, summaryState)

  // Disabled persona: skip snarky generation entirely
  if (persona?.id === 'disabled') {
    ctx.logger.debug('Skipping snarky message generation (disabled persona)', { sessionId })
    return
  }

  const promptTemplate = ctx.assets.resolve(SNARKY_PROMPT_FILE)
  if (!promptTemplate) {
    ctx.logger.warn('Snarky message prompt not found', { path: SNARKY_PROMPT_FILE })
    return
  }

  // Build persona and user profile context for template interpolation
  const personaContext = buildPersonaContext(persona)
  const userProfileContext = loadUserProfileContext(ctx.logger)

  // Interpolate prompt with session summary data and persona
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

  // Get profile configuration for snarky comment (creative profile)
  const llmConfig = config.llm?.snarkyComment ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.snarkyComment!

  // Resolve persona-specific LLM profile override
  const profileResult = getEffectiveProfile(persona, llmConfig, config, ctx.config.llm.profiles, ctx.logger)
  if ('errorMessage' in profileResult) {
    // Write error as the snarky message
    const snarkyState: SnarkyMessageState = {
      message: profileResult.errorMessage,
      timestamp: new Date().toISOString(),
    }
    await summaryState.snarkyMessage.write(sessionId, snarkyState)
    return
  }

  const provider = ctx.profileFactory.createForProfile(profileResult.profileId, llmConfig.fallbackProfile)

  // Emit snarky-message:start event before LLM call
  logEvent(ctx.logger, SessionSummaryEvents.snarkyMessageStart({ sessionId }, { sessionId }))

  try {
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
    })

    // Strip surrounding quotes if they enclose the entire response
    const snarkyMessage = stripSurroundingQuotes(response.content.trim())

    // Build state object
    const snarkyState: SnarkyMessageState = {
      message: snarkyMessage,
      timestamp: new Date().toISOString(),
    }

    // Save via typed accessor (atomic write with schema validation)
    await summaryState.snarkyMessage.write(sessionId, snarkyState)

    // Emit snarky-message:finish event after writing
    logEvent(ctx.logger, SessionSummaryEvents.snarkyMessageFinish({ sessionId }, { generatedMessage: snarkyMessage }))

    ctx.logger.debug('Generated snarky message', {
      sessionId,
      personaId: persona?.id ?? 'none',
      message: snarkyMessage.slice(0, 50),
    })
  } catch (err) {
    ctx.logger.warn('Failed to generate snarky message', { sessionId, error: String(err) })
  }
}

/**
 * Generate resume message as a side-effect.
 * Called when pivot is detected in summary analysis.
 * Uses separate LLM call with higher temperature for creativity.
 *
 * Persona injection:
 * - If persona is "disabled", use deterministic output (session_title and latest_intent)
 * - If persona is selected, inject persona context into prompt
 * - If no persona, omit persona block from prompt
 *
 * @see docs/design/FEATURE-RESUME.md §3.2
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Disabled Persona Behavior
 */
async function generateResumeMessage(
  ctx: DaemonContext,
  summaryState: SessionSummaryStateAccessors,
  eventContext: EventContext,
  summary: SessionSummaryState,
  transcriptExcerpt: string,
  config: SessionSummaryConfig
): Promise<void> {
  const { sessionId } = eventContext

  // Check confidence thresholds
  if (
    summary.session_title_confidence < RESUME_MIN_CONFIDENCE ||
    summary.latest_intent_confidence < RESUME_MIN_CONFIDENCE
  ) {
    // Log structured skip event
    logEvent(
      ctx.logger,
      LogEvents.resumeSkipped(
        { sessionId },
        {
          title_confidence: summary.session_title_confidence,
          intent_confidence: summary.latest_intent_confidence,
          min_confidence: RESUME_MIN_CONFIDENCE,
        },
        'confidence_below_threshold'
      )
    )
    return
  }

  // Load session persona
  const persona = await loadSessionPersona(ctx, sessionId, summaryState)

  // Disabled persona: use deterministic output without LLM call
  // @see docs/design/PERSONA-PROFILES-DESIGN.md - Disabled Persona Behavior
  if (persona?.id === 'disabled') {
    ctx.logger.debug('Using deterministic resume message (disabled persona)', { sessionId })

    const resumeState: ResumeMessageState = {
      last_task_id: null,
      session_title: summary.session_title,
      snarky_comment: summary.latest_intent,
      timestamp: new Date().toISOString(),
      persona_id: null,
      persona_display_name: null,
    }

    await summaryState.resumeMessage.write(sessionId, resumeState)

    logEvent(
      ctx.logger,
      LogEvents.resumeUpdated(
        { sessionId },
        {
          snarky_comment: resumeState.snarky_comment,
          timestamp: resumeState.timestamp,
        }
      )
    )
    return
  }

  const promptTemplate = ctx.assets.resolve(RESUME_PROMPT_FILE)
  if (!promptTemplate) {
    ctx.logger.warn('Resume message prompt not found', { path: RESUME_PROMPT_FILE })
    return
  }

  // Log resume generation start
  logEvent(
    ctx.logger,
    LogEvents.resumeGenerating(
      { sessionId },
      {
        title_confidence: summary.session_title_confidence,
        intent_confidence: summary.latest_intent_confidence,
      }
    )
  )

  // Build persona and user profile context for template interpolation
  const personaContext = buildPersonaContext(persona)
  const userProfileContext = loadUserProfileContext(ctx.logger)

  // Interpolate prompt with session data and persona
  const keyPhrases = summary.session_title_key_phrases?.join(', ') ?? ''
  const prompt = interpolateTemplate(promptTemplate, {
    ...personaContext,
    ...userProfileContext,
    sessionTitle: summary.session_title,
    confidence: summary.session_title_confidence,
    latestIntent: summary.latest_intent,
    keyPhrases,
    transcript: transcriptExcerpt,
    maxResumeWords: config.maxResumeWords,
  })

  // Get profile configuration for resume message (creative-long profile)
  const llmConfig = config.llm?.resumeMessage ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.resumeMessage!

  // Resolve persona-specific LLM profile override
  const profileResult = getEffectiveProfile(persona, llmConfig, config, ctx.config.llm.profiles, ctx.logger)
  if ('errorMessage' in profileResult) {
    ctx.logger.error('Skipping resume generation due to invalid persona profile', {
      sessionId,
      errorMessage: profileResult.errorMessage,
    })
    return
  }

  const provider = ctx.profileFactory.createForProfile(profileResult.profileId, llmConfig.fallbackProfile)

  try {
    // Resume message outputs plain text (snarky_welcome only)
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
    })

    // Strip surrounding quotes if present
    const snarkyWelcome = stripSurroundingQuotes(response.content.trim())

    // Build resume message state
    const resumeState: ResumeMessageState = {
      last_task_id: null, // Not tracked in summary
      session_title: summary.session_title,
      snarky_comment: snarkyWelcome,
      timestamp: new Date().toISOString(),
      persona_id: persona?.id ?? null,
      persona_display_name: persona?.display_name ?? null,
    }

    // Save via typed accessor
    await summaryState.resumeMessage.write(sessionId, resumeState)

    // Log resume updated event
    logEvent(
      ctx.logger,
      LogEvents.resumeUpdated(
        { sessionId },
        {
          snarky_comment: resumeState.snarky_comment,
          timestamp: resumeState.timestamp,
        }
      )
    )

    ctx.logger.debug('Generated resume message', {
      sessionId,
      personaId: persona?.id ?? 'none',
    })
  } catch (err) {
    ctx.logger.warn('Failed to generate resume message', { sessionId, error: String(err) })
  }
}
