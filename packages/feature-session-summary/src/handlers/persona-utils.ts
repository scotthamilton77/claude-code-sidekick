/**
 * Shared Persona Utilities
 *
 * Common functions used by both update-summary.ts and on-demand-generation.ts
 * for persona loading, template context building, and text processing.
 */

import type { DaemonContext, PersonaDefinition } from '@sidekick/types'
import { createPersonaLoader, getDefaultPersonasDir } from '@sidekick/core'
import { createSessionSummaryState, type SessionSummaryStateAccessors } from '../state.js'

/** Default situational context for persona prompts */
const DEFAULT_PERSONA_SITUATION = 'You are watching over the shoulder of a software developer as they work.'

/**
 * Template context for persona prompt injection.
 */
export interface PersonaTemplateContext {
  persona: boolean
  persona_name: string
  persona_theme: string
  persona_personality: string
  persona_tone: string
  persona_snarky_examples: string
  persona_snarky_welcome_examples: string
  persona_situation: string
}

/**
 * Format examples array as bulleted list for prompt injection.
 */
function formatExamples(examples: string[] | undefined): string {
  if (!examples || examples.length === 0) return ''
  return examples.map((ex) => `- "${ex}"`).join('\n')
}

/**
 * Build persona template context from a PersonaDefinition.
 * Returns context with persona=false if persona is null.
 */
export function buildPersonaContext(persona: PersonaDefinition | null): PersonaTemplateContext {
  if (!persona) {
    return {
      persona: false,
      persona_name: '',
      persona_theme: '',
      persona_personality: '',
      persona_tone: '',
      persona_snarky_examples: '',
      persona_snarky_welcome_examples: '',
      persona_situation: DEFAULT_PERSONA_SITUATION,
    }
  }

  return {
    persona: true,
    persona_name: persona.display_name,
    persona_theme: persona.theme,
    persona_personality: persona.personality_traits.join(', '),
    persona_tone: persona.tone_traits.join(', '),
    persona_snarky_examples: formatExamples(persona.snarky_examples),
    persona_snarky_welcome_examples: formatExamples(persona.snarky_welcome_examples),
    persona_situation: persona.situation ?? DEFAULT_PERSONA_SITUATION,
  }
}

/**
 * Strip surrounding quotes from a string if they enclose the entire content.
 * Handles both single and double quotes.
 * Only strips if the string starts AND ends with matching quotes.
 */
export function stripSurroundingQuotes(text: string): string {
  if (text.length < 2) return text
  const first = text[0]
  const last = text[text.length - 1]
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return text.slice(1, -1)
  }
  return text
}

/**
 * Load the persona selected for a session.
 * Returns null if no persona is selected or if the persona ID is not found.
 *
 * @param ctx - Daemon context for logging and paths
 * @param sessionId - The session to load persona for
 * @param summaryState - Optional pre-created state accessors (created if not provided)
 */
export async function loadSessionPersona(
  ctx: DaemonContext,
  sessionId: string,
  summaryState?: SessionSummaryStateAccessors
): Promise<PersonaDefinition | null> {
  const state = summaryState ?? createSessionSummaryState(ctx.stateService)
  const result = await state.sessionPersona.read(sessionId)
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
