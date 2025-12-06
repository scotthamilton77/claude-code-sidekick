/**
 * UpdateSessionSummary Handler
 *
 * Performs LLM-based transcript analysis. Triggered by:
 * - UserPrompt events (force analysis)
 * - ToolCall events (conditional, based on countdown)
 *
 * @see docs/design/FEATURE-SESSION-SUMMARY.md §3.2
 */

import type { TranscriptEvent } from '@sidekick/core'
import { logEvent, LogEvents } from '@sidekick/core'
import type { SupervisorContext } from '@sidekick/types'
import fs from 'node:fs/promises'
import path from 'node:path'
import { z } from 'zod'
import type { SessionSummaryState, SummaryCountdownState } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types.js'

const STATE_FILE = 'session-summary.json'
const COUNTDOWN_FILE = 'summary-countdown.json'
const PROMPT_FILE = 'prompts/session-summary.prompt.txt'

/**
 * Zod schema for LLM response validation.
 * Matches assets/sidekick/schemas/session-summary.schema.json
 */
const SessionSummaryResponseSchema = z.object({
  session_title: z.string().max(80),
  session_title_confidence: z.number().min(0).max(1),
  session_title_key_phrases: z.array(z.string()).min(3).max(7).optional(),
  latest_intent: z.string().max(120),
  latest_intent_confidence: z.number().min(0).max(1),
  latest_intent_key_phrases: z.array(z.string()).min(2).max(5).optional(),
  pivot_detected: z.boolean(),
})

type SessionSummaryResponse = z.infer<typeof SessionSummaryResponseSchema>

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
    await performAnalysis(event, ctx, countdown, 'user_prompt_forced')
    return
  }

  // ToolCall: check countdown
  if (countdown.countdown > 0) {
    countdown.countdown--
    await saveCountdownState(ctx, sessionId, countdown)
    ctx.logger.debug('Summary countdown decremented', { sessionId, countdown: countdown.countdown })
    return
  }

  // Countdown reached zero - perform analysis
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
  reason: 'user_prompt_forced' | 'countdown_reached' | 'compaction_reset'
): Promise<void> {
  const { sessionId } = event.context
  const startTime = Date.now()
  const config = DEFAULT_SESSION_SUMMARY_CONFIG

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

  // Call LLM
  let llmResponse: SessionSummaryResponse | null = null
  let tokensUsed = 0

  try {
    const response = await ctx.llm.complete({
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.3, // Low temperature for consistent analysis
      maxTokens: 1000,
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
  await fs.writeFile(statePath, JSON.stringify(summary, null, 2), 'utf-8')
}
