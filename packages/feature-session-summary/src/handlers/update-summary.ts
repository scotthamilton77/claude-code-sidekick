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
import { SessionSummaryEvents, DecisionEvents } from '../events.js'
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
const DECISION_TITLE_DEFER = 'Defer session analysis'

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

type SessionSummaryResponse = z.infer<typeof SessionSummaryResponseSchema>

// Re-export for backward compatibility with tests
export { buildPersonaContext, type PersonaTemplateContext } from './persona-utils.js'

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
          detail: 'session-summary analysis',
          title: DECISION_TITLE_SKIP,
        })
      )
      return
    }

    logEvent(
      ctx.logger,
      DecisionEvents.decisionRecorded(event.context, {
        decision: 'calling',
        reason: 'BulkProcessingComplete - analyzing full transcript',
        detail: 'session-summary analysis',
        title: DECISION_TITLE_RUN,
      })
    )
    const countdown = await loadCountdownState(summaryState, sessionId)
    void performAnalysis(event, ctx, summaryState, countdown, 'user_prompt_forced')
    return
  }

  // Load current countdown state
  const countdown = await loadCountdownState(summaryState, sessionId)

  // UserPrompt forces immediate analysis
  if (isUserPrompt) {
    logEvent(
      ctx.logger,
      DecisionEvents.decisionRecorded(event.context, {
        decision: 'calling',
        reason: 'UserPrompt event forces immediate analysis',
        detail: 'session-summary analysis',
        title: DECISION_TITLE_RUN,
      })
    )
    void performAnalysis(event, ctx, summaryState, countdown, 'user_prompt_forced')
    return
  }

  // ToolResult: check countdown
  if (countdown.countdown > 0) {
    logEvent(
      ctx.logger,
      DecisionEvents.decisionRecorded(event.context, {
        decision: 'skipped',
        reason: `countdown not reached (${countdown.countdown} tool results remaining)`,
        detail: 'session-summary analysis',
        title: DECISION_TITLE_DEFER,
      })
    )
    countdown.countdown--
    await saveCountdownState(summaryState, sessionId, countdown)
    return
  }

  // Countdown reached zero - perform analysis
  logEvent(
    ctx.logger,
    DecisionEvents.decisionRecorded(event.context, {
      decision: 'calling',
      reason: 'countdown reached zero after ToolResult',
      detail: 'session-summary analysis',
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

async function performAnalysis(
  event: TranscriptEvent,
  ctx: DaemonContext,
  summaryState: SessionSummaryStateAccessors,
  countdown: SummaryCountdownState,
  // Note: compaction_reset reserved for future compaction-triggered re-analysis
  reason: 'user_prompt_forced' | 'countdown_reached' | 'compaction_reset'
): Promise<void> {
  const { sessionId } = event.context
  try {
    const startTime = Date.now()

    // Emit session-summary:start event
    logEvent(
      ctx.logger,
      SessionSummaryEvents.summaryStart(event.context, {
        reason,
        countdown: countdown.countdown,
      })
    )

    // Use getFeature() to get merged config from cascade
    const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }

    // Load current summary
    const currentSummary = await loadCurrentSummary(summaryState, sessionId)

    // Extract transcript excerpt via TranscriptService
    const excerpt = ctx.transcript.getExcerpt({
      maxLines: config.excerptLines,
      bookmarkLine: countdown.bookmark_line,
      includeToolMessages: config.includeToolMessages,
      includeToolOutputs: config.includeToolOutputs,
      includeAssistantThinking: config.includeAssistantThinking,
    })
    const transcript = excerpt.content

    // Build previous analysis context
    const previousAnalysis = currentSummary
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
    if (!promptTemplate) {
      ctx.logger.error('Failed to load session summary prompt template', { path: PROMPT_FILE })
      return
    }

    // Interpolate prompt
    const prompt = interpolatePrompt(promptTemplate, {
      transcript,
      previousConfidence,
      previousAnalysis,
      maxTitleWords: config.maxTitleWords,
      maxIntentWords: config.maxIntentWords,
    })

    // Load JSON schema for structured output
    const schemaContent = ctx.assets.resolve(SESSION_SUMMARY_SCHEMA_FILE)
    const jsonSchema = schemaContent
      ? {
          name: 'session-summary',
          schema: JSON.parse(schemaContent) as Record<string, unknown>,
        }
      : undefined

    // Get profile configuration for session summary
    const llmConfig = config.llm?.sessionSummary ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.sessionSummary!
    const provider = ctx.profileFactory.createForProfile(llmConfig.profile, llmConfig.fallbackProfile)

    // Call LLM
    let llmResponse: SessionSummaryResponse | null = null
    let tokensUsed = 0

    try {
      const response = await provider.complete({
        messages: [{ role: 'user', content: prompt }],
        jsonSchema,
      })

      tokensUsed = (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0)
      llmResponse = parseResponse(response.content)

      if (!llmResponse) {
        ctx.logger.warn('Failed to parse LLM response', { sessionId, content: response.content.slice(0, 200) })
      }
    } catch (err) {
      ctx.logger.error('LLM call failed', { sessionId, error: String(err) })
    }

    // Build updated summary (fallback to current if LLM failed)
    const updatedSummary: SessionSummaryState = {
      ...currentSummary,
      session_id: sessionId,
      timestamp: new Date().toISOString(),
      session_title: llmResponse?.session_title ?? currentSummary?.session_title ?? 'Analysis pending...',
      session_title_confidence: llmResponse?.session_title_confidence ?? currentSummary?.session_title_confidence ?? 0,
      session_title_key_phrases: llmResponse?.session_title_key_phrases ?? currentSummary?.session_title_key_phrases,
      latest_intent: llmResponse?.latest_intent ?? currentSummary?.latest_intent ?? 'Processing...',
      latest_intent_confidence: llmResponse?.latest_intent_confidence ?? currentSummary?.latest_intent_confidence ?? 0,
      latest_intent_key_phrases: llmResponse?.latest_intent_key_phrases ?? currentSummary?.latest_intent_key_phrases,
      pivot_detected: llmResponse?.pivot_detected ?? false,
      previous_title: currentSummary?.session_title,
      previous_intent: currentSummary?.latest_intent,
      stats: {
        total_tokens: tokensUsed,
        processing_time_ms: Date.now() - startTime,
      },
    }

    await saveSummary(summaryState, sessionId, updatedSummary)

    // Reset countdown based on confidence
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
      bookmarkLine = event.payload.lineNumber
    } else if (avgConfidence < config.bookmark.resetThreshold) {
      bookmarkLine = 0
    } else {
      bookmarkLine = countdown.bookmark_line
    }

    await saveCountdownState(summaryState, sessionId, {
      countdown: newCountdown,
      bookmark_line: bookmarkLine,
    })

    // Generate side-effects in parallel (if conditions met)
    // Side-effects are independent LLM calls that don't affect the main summary flow
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
    // @see docs/design/FEATURE-RESUME.md §3.2: "a pivot was detected OR there is no resume-message.json already generated"
    const hasResume = await resumeMessageExists(summaryState, sessionId)
    if (updatedSummary.pivot_detected || !hasResume) {
      sideEffects.push(generateResumeMessage(ctx, summaryState, event.context, updatedSummary, transcript, config))
    }

    // Await all side-effects (errors are logged internally, won't fail main flow)
    if (sideEffects.length > 0) {
      await Promise.all(sideEffects)
    }

    // Log summary completion
    logEvent(
      ctx.logger,
      SessionSummaryEvents.summaryFinish(event.context, {
        session_title: updatedSummary.session_title,
        session_title_confidence: updatedSummary.session_title_confidence,
        latest_intent: updatedSummary.latest_intent,
        latest_intent_confidence: updatedSummary.latest_intent_confidence,
        processing_time_ms: updatedSummary.stats?.processing_time_ms ?? 0,
        pivot_detected: updatedSummary.pivot_detected ?? false,
      })
    )

    // Emit title-changed if title differs
    if (currentSummary && updatedSummary.session_title !== currentSummary.session_title) {
      logEvent(
        ctx.logger,
        SessionSummaryEvents.titleChanged(event.context, {
          previousValue: currentSummary.session_title,
          newValue: updatedSummary.session_title,
          confidence: updatedSummary.session_title_confidence,
        })
      )
    }

    // Emit intent-changed if intent differs
    if (currentSummary && updatedSummary.latest_intent !== currentSummary.latest_intent) {
      logEvent(
        ctx.logger,
        SessionSummaryEvents.intentChanged(event.context, {
          previousValue: currentSummary.latest_intent,
          newValue: updatedSummary.latest_intent,
          confidence: updatedSummary.latest_intent_confidence,
        })
      )
    }

    ctx.logger.info('Updated session summary', {
      sessionId,
      reason,
      title: updatedSummary.session_title,
      confidence: avgConfidence,
      tokensUsed,
    })
  } catch (err) {
    ctx.logger.error('performAnalysis failed', {
      sessionId,
      reason,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

async function loadCurrentSummary(
  summaryState: SessionSummaryStateAccessors,
  sessionId: string
): Promise<SessionSummaryState | null> {
  // read() returns null when file is missing (default value)
  const result = await summaryState.sessionSummary.read(sessionId)
  return result.data
}

async function saveSummary(
  summaryState: SessionSummaryStateAccessors,
  sessionId: string,
  summary: SessionSummaryState
): Promise<void> {
  await summaryState.sessionSummary.write(sessionId, summary)
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
