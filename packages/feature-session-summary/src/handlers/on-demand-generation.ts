/**
 * On-Demand Persona Message Generation
 *
 * Provides exported functions for CLI-triggered snarky and resume message generation.
 * Used by the `sidekick persona-test` command to test persona voice differentiation.
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md
 */

import type { DaemonContext, PersonaDefinition, SessionPersonaState, SnarkyMessageState } from '@sidekick/types'
import type { ResumeMessageState, SessionSummaryConfig } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG, RESUME_MIN_CONFIDENCE } from '../types.js'
import { createSessionSummaryState } from '../state.js'
import { createPersonaLoader, getDefaultPersonasDir } from '@sidekick/core'

const SNARKY_PROMPT_FILE = 'prompts/snarky-message.prompt.txt'
const RESUME_PROMPT_FILE = 'prompts/resume-message.prompt.txt'
const RESUME_MESSAGE_SCHEMA_FILE = 'schemas/resume-message.schema.json'

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
 * Build persona template context from a PersonaDefinition.
 */
function buildPersonaContext(persona: PersonaDefinition | null): Record<string, string | boolean> {
  if (!persona) {
    return {
      persona: false,
      persona_name: '',
      persona_theme: '',
      persona_personality: '',
      persona_tone: '',
      persona_snarky_examples: '',
      persona_resume_examples: '',
    }
  }

  const formatExamples = (examples: string[] | undefined): string => {
    if (!examples || examples.length === 0) return ''
    return examples.map((ex) => `- "${ex}"`).join('\n')
  }

  return {
    persona: true,
    persona_name: persona.display_name,
    persona_theme: persona.theme,
    persona_personality: persona.personality_traits.join(', '),
    persona_tone: persona.tone_traits.join(', '),
    persona_snarky_examples: formatExamples(persona.snarky_examples),
    persona_resume_examples: formatExamples(persona.resume_examples),
  }
}

/**
 * Simple template processor with Handlebars-like {{#if}}...{{/if}} support.
 */
function interpolateTemplate(template: string, context: Record<string, string | boolean | number>): string {
  let result = template.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (_, varName: string, content: string) => {
    const value = context[varName]
    return value ? content : ''
  })

  result = result.replace(/\{\{(\w+)\}\}/g, (_, varName: string) => {
    const value = context[varName]
    return value !== undefined ? String(value) : ''
  })

  return result
}

/**
 * Strip surrounding quotes from a string if they enclose the entire content.
 */
function stripSurroundingQuotes(text: string): string {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * Load the persona selected for this session.
 */
async function loadSessionPersona(ctx: DaemonContext, sessionId: string): Promise<PersonaDefinition | null> {
  const summaryState = createSessionSummaryState(ctx.stateService)
  const result = await summaryState.sessionPersona.read(sessionId)
  if (!result.data) {
    return null
  }

  const loader = createPersonaLoader({
    defaultPersonasDir: getDefaultPersonasDir(),
    projectRoot: ctx.paths.projectDir,
    logger: ctx.logger,
  })

  const personas = loader.discover()
  return personas.get(result.data.persona_id) ?? null
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

  // Load session persona
  const persona = await loadSessionPersona(ctx, sessionId)

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

  // Interpolate prompt with session summary data and persona
  const prompt = interpolateTemplate(promptTemplate, {
    ...personaContext,
    session_title: summary.session_title,
    latest_intent: summary.latest_intent,
    turn_count: ctx.transcript.getMetrics().turnCount,
    tool_count: ctx.transcript.getMetrics().toolCount,
    sessionSummary: JSON.stringify(summary, null, 2),
  })

  // Get profile configuration for snarky comment
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }
  const llmConfig = config.llm?.snarkyComment ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.snarkyComment!
  const provider = ctx.profileFactory.createForProfile(llmConfig.profile, llmConfig.fallbackProfile)

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

  // Load session persona
  const persona = await loadSessionPersona(ctx, sessionId)

  // Disabled persona: use deterministic output
  if (persona?.id === 'disabled') {
    const resumeState: ResumeMessageState = {
      last_task_id: null,
      session_title: summary.session_title,
      resume_last_goal_message: summary.session_title,
      snarky_comment: summary.latest_intent,
      timestamp: new Date().toISOString(),
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

  // Load JSON schema for structured output
  const resumeSchemaContent = ctx.assets.resolve(RESUME_MESSAGE_SCHEMA_FILE)
  const resumeJsonSchema = resumeSchemaContent
    ? {
        name: 'resume-message',
        schema: JSON.parse(resumeSchemaContent) as Record<string, unknown>,
      }
    : undefined

  // Build persona context for template interpolation
  const personaContext = buildPersonaContext(persona)

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
  })

  // Get profile configuration for resume message
  const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
  const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }
  const llmConfig = config.llm?.resumeMessage ?? DEFAULT_SESSION_SUMMARY_CONFIG.llm!.resumeMessage!
  const provider = ctx.profileFactory.createForProfile(llmConfig.profile, llmConfig.fallbackProfile)

  try {
    const response = await provider.complete({
      messages: [{ role: 'user', content: prompt }],
      jsonSchema: resumeJsonSchema,
    })

    // Parse response
    let jsonStr = response.content
    const jsonMatch = response.content.match(/```(?:json)?\s*([\s\S]*?)```/)
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim()
    }

    let parsed: { resume_message: string; snarky_welcome: string }
    try {
      parsed = JSON.parse(jsonStr) as { resume_message: string; snarky_welcome: string }
    } catch {
      return {
        success: false,
        error: `Failed to parse LLM response as JSON: ${response.content.slice(0, 200)}`,
      }
    }

    const resumeState: ResumeMessageState = {
      last_task_id: null,
      session_title: summary.session_title,
      resume_last_goal_message: parsed.resume_message,
      snarky_comment: parsed.snarky_welcome,
      timestamp: new Date().toISOString(),
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
