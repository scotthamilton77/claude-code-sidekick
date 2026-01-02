/**
 * UpdateSessionSummary Handler
 *
 * Performs LLM-based transcript analysis. Triggered by:
 * - UserPrompt events (force analysis)
 * - ToolResult events (conditional, based on countdown)
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2
 */

import type { TranscriptEvent } from '@sidekick/core'
import { backupIfDevMode, logEvent, LogEvents } from '@sidekick/core'
import type { SupervisorContext, EventContext } from '@sidekick/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { ResumeMessageState, SessionSummaryConfig, SessionSummaryState, SummaryCountdownState } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG, RESUME_MIN_CONFIDENCE } from '../types.js'

const STATE_FILE = 'session-summary.json'
const COUNTDOWN_FILE = 'summary-countdown.json'
const RESUME_FILE = 'resume-message.json'
const SNARKY_FILE = 'snarky-message.txt'
const PROMPT_FILE = 'prompts/session-summary.prompt.txt'
const SNARKY_PROMPT_FILE = 'prompts/snarky-message.prompt.txt'
const RESUME_PROMPT_FILE = 'prompts/resume-message.prompt.txt'
const SESSION_SUMMARY_SCHEMA_FILE = 'schemas/session-summary.schema.json'
const RESUME_MESSAGE_SCHEMA_FILE = 'schemas/resume-message.schema.json'

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

/**
 * Zod schema for resume message LLM response validation.
 * Matches assets/sidekick/schemas/resume-message.schema.json
 * Note: No .max() constraints - prompts specify limits, we accept if LLM overshoots.
 */
const ResumeMessageResponseSchema = z.object({
  resume_message: z.string(),
  snarky_welcome: z.string(),
})

type ResumeMessageResponse = z.infer<typeof ResumeMessageResponseSchema>

/**
 * Update session summary based on transcript events
 */
export async function updateSessionSummary(event: TranscriptEvent, ctx: SupervisorContext): Promise<void> {
  const { sessionId } = event.context
  const isUserPrompt = event.eventType === 'UserPrompt'

  // Load current countdown state
  const countdown = await loadCountdownState(ctx, sessionId)

  // UserPrompt forces immediate analysis
  if (isUserPrompt) {
    ctx.logger.info('LLM call: session-summary analysis', {
      sessionId,
      decision: 'calling',
      reason: 'UserPrompt event forces immediate analysis',
    })
    await performAnalysis(event, ctx, countdown, 'user_prompt_forced')
    return
  }

  // ToolResult: check countdown
  if (countdown.countdown > 0) {
    ctx.logger.info('LLM call: session-summary analysis', {
      sessionId,
      decision: 'skipped',
      reason: `countdown not reached (${countdown.countdown} tool results remaining)`,
    })
    countdown.countdown--
    await saveCountdownState(ctx, sessionId, countdown)
    return
  }

  // Countdown reached zero - perform analysis
  ctx.logger.info('LLM call: session-summary analysis', {
    sessionId,
    decision: 'calling',
    reason: 'countdown reached zero after ToolResult',
  })
  await performAnalysis(event, ctx, countdown, 'countdown_reached')
}

async function loadCountdownState(ctx: SupervisorContext, sessionId: string): Promise<SummaryCountdownState> {
  try {
    const stateDir = ctx.paths.projectConfigDir ?? ctx.paths.userConfigDir
    const statePath = path.join(stateDir, 'sessions', sessionId, 'state', COUNTDOWN_FILE)
    const content = await fs.readFile(statePath, 'utf-8')
    return JSON.parse(content) as SummaryCountdownState
  } catch {
    return { countdown: 0, bookmark_line: 0 }
  }
}

/**
 * Check if resume-message.json already exists for this session.
 * Used to trigger initial resume generation even without pivot detection.
 * @see docs/design/FEATURE-RESUME.md §3.2
 */
async function resumeMessageExists(ctx: SupervisorContext, sessionId: string): Promise<boolean> {
  try {
    const stateDir = ctx.paths.projectConfigDir ?? ctx.paths.userConfigDir
    const resumePath = path.join(stateDir, 'sessions', sessionId, 'state', RESUME_FILE)
    await fs.access(resumePath)
    return true
  } catch {
    return false
  }
}

async function saveCountdownState(
  ctx: SupervisorContext,
  sessionId: string,
  state: SummaryCountdownState
): Promise<void> {
  const stateDir = ctx.paths.projectConfigDir ?? ctx.paths.userConfigDir
  const statePath = path.join(stateDir, 'sessions', sessionId, 'state', COUNTDOWN_FILE)
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await fs.writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8')
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
  }
): string {
  return template
    .replace(/\{\{transcript\}\}/g, context.transcript)
    .replace(/\{\{previousConfidence\}\}/g, String(context.previousConfidence))
    .replace(/\{\{previousAnalysis\}\}/g, context.previousAnalysis)
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
  ctx: SupervisorContext,
  countdown: SummaryCountdownState,
  // Note: compaction_reset reserved for future compaction-triggered re-analysis
  reason: 'user_prompt_forced' | 'countdown_reached' | 'compaction_reset'
): Promise<void> {
  const { sessionId } = event.context
  const startTime = Date.now()
  // Use getFeature() to get merged config from cascade
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }

  // Load current summary
  const currentSummary = await loadCurrentSummary(ctx, sessionId)

  // Extract transcript excerpt via TranscriptService
  const excerpt = ctx.transcript.getExcerpt({
    maxLines: config.excerptLines,
    bookmarkLine: countdown.bookmark_line,
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
  })

  // Load JSON schema for structured output
  const schemaContent = ctx.assets.resolve(SESSION_SUMMARY_SCHEMA_FILE)
  const jsonSchema = schemaContent
    ? {
        name: 'session-summary',
        schema: JSON.parse(schemaContent) as Record<string, unknown>,
      }
    : undefined

  // Call LLM
  let llmResponse: SessionSummaryResponse | null = null
  let tokensUsed = 0

  try {
    const response = await ctx.llm.complete({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0, // Zero temperature for deterministic classification
      maxTokens: 1000,
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

  await saveSummary(ctx, sessionId, updatedSummary)

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

  // Update bookmark line if high confidence
  const bookmarkLine =
    avgConfidence > config.bookmark.confidenceThreshold ? event.payload.lineNumber : currentSummary?.stats ? 0 : 0

  await saveCountdownState(ctx, sessionId, {
    countdown: newCountdown,
    bookmark_line: bookmarkLine,
  })

  // Generate side-effects in parallel (if conditions met)
  // Side-effects are independent LLM calls that don't affect the main summary flow
  const sideEffects: Promise<void>[] = []

  // Snarky message: generate when title or intent changed significantly
  const changes = hasSignificantChange(updatedSummary, currentSummary)
  if (config.snarkyMessages && (changes.titleChanged || changes.intentChanged)) {
    // Note: We don't delete the old file first. If LLM fails, we keep stale over nothing.
    sideEffects.push(generateSnarkyMessage(ctx, sessionId, updatedSummary))
  }

  // Resume message: generate when pivot detected OR when no resume exists yet
  // @see docs/design/FEATURE-RESUME.md §3.2: "a pivot was detected OR there is no resume-message.json already generated"
  const hasResume = await resumeMessageExists(ctx, sessionId)
  if (updatedSummary.pivot_detected || !hasResume) {
    sideEffects.push(generateResumeMessage(ctx, event.context, updatedSummary, transcript))
  }

  // Await all side-effects (errors are logged internally, won't fail main flow)
  if (sideEffects.length > 0) {
    await Promise.all(sideEffects)
  }

  // Log update event
  logEvent(
    ctx.logger,
    LogEvents.summaryUpdated(
      event.context,
      {
        session_title: updatedSummary.session_title,
        session_title_confidence: updatedSummary.session_title_confidence,
        latest_intent: updatedSummary.latest_intent,
        latest_intent_confidence: updatedSummary.latest_intent_confidence,
      },
      {
        countdown_reset_to: newCountdown,
        tokens_used: tokensUsed,
        processing_time_ms: updatedSummary.stats?.processing_time_ms ?? 0,
        pivot_detected: updatedSummary.pivot_detected ?? false,
        old_title: currentSummary?.session_title,
        old_intent: currentSummary?.latest_intent,
      },
      reason
    )
  )

  ctx.logger.info('Updated session summary', {
    sessionId,
    reason,
    title: updatedSummary.session_title,
    confidence: avgConfidence,
    tokensUsed,
  })
}

async function loadCurrentSummary(ctx: SupervisorContext, sessionId: string): Promise<SessionSummaryState | null> {
  try {
    const stateDir = ctx.paths.projectConfigDir ?? ctx.paths.userConfigDir
    const statePath = path.join(stateDir, 'sessions', sessionId, 'state', STATE_FILE)
    const content = await fs.readFile(statePath, 'utf-8')
    return JSON.parse(content) as SessionSummaryState
  } catch {
    return null
  }
}

async function saveSummary(ctx: SupervisorContext, sessionId: string, summary: SessionSummaryState): Promise<void> {
  const stateDir = ctx.paths.projectConfigDir ?? ctx.paths.userConfigDir
  const statePath = path.join(stateDir, 'sessions', sessionId, 'state', STATE_FILE)
  await fs.mkdir(path.dirname(statePath), { recursive: true })
  await backupIfDevMode(ctx.config.core.development.enabled, statePath, { logger: ctx.logger })
  await fs.writeFile(statePath, JSON.stringify(summary, null, 2), 'utf-8')
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
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2.4
 */
async function generateSnarkyMessage(
  ctx: SupervisorContext,
  sessionId: string,
  summary: SessionSummaryState
): Promise<void> {
  const promptTemplate = ctx.assets.resolve(SNARKY_PROMPT_FILE)
  if (!promptTemplate) {
    ctx.logger.warn('Snarky message prompt not found', { path: SNARKY_PROMPT_FILE })
    return
  }

  // Interpolate prompt with session summary data
  const prompt = promptTemplate
    .replace(/\{\{session_title\}\}/g, summary.session_title)
    .replace(/\{\{latest_intent\}\}/g, summary.latest_intent)
    .replace(/\{\{turn_count\}\}/g, String(ctx.transcript.getMetrics().turnCount))
    .replace(/\{\{tool_count\}\}/g, String(ctx.transcript.getMetrics().toolCount))
    .replace(/\{\{sessionSummary\}\}/g, JSON.stringify(summary, null, 2))

  try {
    const response = await ctx.llm.complete({
      messages: [{ role: 'user', content: prompt }],
      temperature: 1.2, // High temperature for creative snark
      maxTokens: 100,
    })

    // Snarky message is plain text, no JSON parsing needed
    const snarkyMessage = response.content.trim()

    // Save to state file
    const stateDir = ctx.paths.projectConfigDir ?? ctx.paths.userConfigDir
    const snarkyPath = path.join(stateDir, 'sessions', sessionId, 'state', SNARKY_FILE)
    await backupIfDevMode(ctx.config.core.development.enabled, snarkyPath, { logger: ctx.logger })
    await fs.writeFile(snarkyPath, snarkyMessage, 'utf-8')

    ctx.logger.debug('Generated snarky message', { sessionId, message: snarkyMessage.slice(0, 50) })
  } catch (err) {
    ctx.logger.warn('Failed to generate snarky message', { sessionId, error: String(err) })
  }
}

/**
 * Parse and validate resume message LLM response.
 */
function parseResumeResponse(content: string): ResumeMessageResponse | null {
  try {
    let jsonStr = content
    const jsonMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }
    const parsed: unknown = JSON.parse(jsonStr)
    return ResumeMessageResponseSchema.parse(parsed)
  } catch {
    return null
  }
}

/**
 * Generate resume message as a side-effect.
 * Called when pivot is detected in summary analysis.
 * Uses separate LLM call with higher temperature for creativity.
 * @see docs/design/FEATURE-RESUME.md §3.2
 */
async function generateResumeMessage(
  ctx: SupervisorContext,
  eventContext: EventContext,
  summary: SessionSummaryState,
  transcriptExcerpt: string
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
        { sessionId, scope: eventContext.scope },
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

  const promptTemplate = ctx.assets.resolve(RESUME_PROMPT_FILE)
  if (!promptTemplate) {
    ctx.logger.warn('Resume message prompt not found', { path: RESUME_PROMPT_FILE })
    return
  }

  // Log resume generation start
  logEvent(
    ctx.logger,
    LogEvents.resumeGenerating(
      { sessionId, scope: eventContext.scope },
      {
        title_confidence: summary.session_title_confidence,
        intent_confidence: summary.latest_intent_confidence,
      }
    )
  )

  // Load JSON schema for structured output
  const resumeSchemaContent = ctx.assets.resolve(RESUME_MESSAGE_SCHEMA_FILE)
  const resumeJsonSchema = resumeSchemaContent
    ? {
        name: 'resume-message',
        schema: JSON.parse(resumeSchemaContent) as Record<string, unknown>,
      }
    : undefined

  // Interpolate prompt with session data
  const keyPhrases = summary.session_title_key_phrases?.join(', ') ?? ''
  const prompt = promptTemplate
    .replace(/\{\{sessionTitle\}\}/g, summary.session_title)
    .replace(/\{\{confidence\}\}/g, String(summary.session_title_confidence))
    .replace(/\{\{latestIntent\}\}/g, summary.latest_intent)
    .replace(/\{\{keyPhrases\}\}/g, keyPhrases)
    .replace(/\{\{transcript\}\}/g, transcriptExcerpt)

  try {
    const response = await ctx.llm.complete({
      messages: [{ role: 'user', content: prompt }],
      temperature: 1.2, // High temperature for creative messages
      maxTokens: 500,
      jsonSchema: resumeJsonSchema,
    })

    const parsed = parseResumeResponse(response.content)
    if (!parsed) {
      ctx.logger.warn('Failed to parse resume message response', {
        sessionId,
        content: response.content.slice(0, 200),
      })
      return
    }

    // Build resume message state
    const resumeState: ResumeMessageState = {
      last_task_id: null, // Not tracked in summary
      resume_last_goal_message: parsed.resume_message,
      snarky_comment: parsed.snarky_welcome,
      timestamp: new Date().toISOString(),
    }

    // Save to state file
    const stateDir = ctx.paths.projectConfigDir ?? ctx.paths.userConfigDir
    const resumePath = path.join(stateDir, 'sessions', sessionId, 'state', RESUME_FILE)
    await fs.mkdir(path.dirname(resumePath), { recursive: true })
    await backupIfDevMode(ctx.config.core.development.enabled, resumePath, { logger: ctx.logger })
    await fs.writeFile(resumePath, JSON.stringify(resumeState, null, 2), 'utf-8')

    // Log resume updated event
    logEvent(
      ctx.logger,
      LogEvents.resumeUpdated(
        { sessionId, scope: eventContext.scope },
        {
          resume_last_goal_message: resumeState.resume_last_goal_message,
          snarky_comment: resumeState.snarky_comment,
          timestamp: resumeState.timestamp,
        }
      )
    )
  } catch (err) {
    ctx.logger.warn('Failed to generate resume message', { sessionId, error: String(err) })
  }
}
