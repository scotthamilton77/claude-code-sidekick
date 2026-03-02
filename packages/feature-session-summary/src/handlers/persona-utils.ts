/**
 * Shared Persona Utilities
 *
 * Common functions used by both update-summary.ts and on-demand-generation.ts
 * for persona loading, template context building, and text processing.
 */

import type { DaemonContext, PersonaDefinition, UserProfile } from '@sidekick/types'
import { createPersonaLoader, getDefaultPersonasDir, loadUserProfile } from '@sidekick/core'
import { createSessionSummaryState, type SessionSummaryStateAccessors } from '../state.js'
import type { LlmSubFeatureConfig, SessionSummaryConfig } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types.js'

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
 * Template context for user profile prompt injection.
 */
export interface UserProfileTemplateContext {
  user_name: string
  user_role: string
  user_interests: string
}

/**
 * Build user profile template context.
 * Returns empty strings if profile is null (file doesn't exist).
 */
export function buildUserProfileContext(profile: UserProfile | null): UserProfileTemplateContext {
  if (!profile) {
    return {
      user_name: '',
      user_role: '',
      user_interests: '',
    }
  }
  return {
    user_name: profile.name,
    user_role: profile.role,
    user_interests: profile.interests.join(', '),
  }
}

/**
 * Load user profile from disk and build template context.
 * Convenience wrapper combining loadUserProfile + buildUserProfileContext.
 */
export function loadUserProfileContext(logger: DaemonContext['logger']): UserProfileTemplateContext {
  return buildUserProfileContext(loadUserProfile({ logger }))
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

// ============================================================================
// Persona LLM Profile Resolution
// ============================================================================

/**
 * Persona config subset needed for profile resolution.
 * Matches SessionSummaryConfig.personas shape.
 */
export interface PersonaProfileConfig {
  defaultLlmProfile?: string
  llmProfiles?: Record<string, string>
}

/**
 * Resolve the LLM profile for a persona using a three-level cascade.
 *
 * Resolution order (highest wins):
 * 1. `personaConfig.llmProfiles[personaId]` — user per-persona config override
 * 2. `personaDef.llmProfile` — persona YAML author recommendation
 * 3. `personaConfig.defaultLlmProfile` — user global default
 * 4. `undefined` → caller uses feature's existing profile (zero change)
 *
 * Empty strings are treated as unset at every level.
 */
export function resolvePersonaLlmProfile(
  personaId: string,
  personaDef: PersonaDefinition | null,
  personaConfig: PersonaProfileConfig
): string | undefined {
  // Level 1: per-persona config override
  const perPersona = personaConfig.llmProfiles?.[personaId]
  if (perPersona) return perPersona

  // Level 2: persona YAML author recommendation
  if (personaDef?.llmProfile) return personaDef.llmProfile

  // Level 3: user global default
  if (personaConfig.defaultLlmProfile) return personaConfig.defaultLlmProfile

  // Level 4: no override
  return undefined
}

// ============================================================================
// Persona LLM Profile Validation
// ============================================================================

/** Tracks profiles already warned about to avoid log spam */
const _warnedProfiles = new Set<string>()
/** Tracks defaultLlmProfile errors already emitted */
const _erroredDefaults = new Set<string>()

/**
 * Reset warning/error dedup state. For test isolation only.
 */
export function _resetProfileWarningState(): void {
  _warnedProfiles.clear()
  _erroredDefaults.clear()
}

/** Successful validation result */
export interface ProfileValidResult {
  profileId: string
}

/** Error validation result (profile not found) */
export interface ProfileErrorResult {
  errorMessage: string
}

/** Discriminated union for validation outcome */
export type ProfileValidationResult = ProfileValidResult | ProfileErrorResult

/**
 * Validate a resolved persona LLM profile against available profiles.
 *
 * - Valid profile → returns `{ profileId }` to use
 * - Invalid profile → warns once, returns `{ profileId }` with feature fallback
 * - Invalid defaultLlmProfile as source → errors once, returns `{ errorMessage }`
 *
 * @param resolvedProfile - The profile ID from resolvePersonaLlmProfile
 * @param personaId - For logging context
 * @param featureProfile - The feature's own profile to fall back to (e.g. llmConfig.profile)
 * @param availableProfiles - Profile IDs available in config (keys of llm.profiles)
 * @param isFromDefault - Whether resolvedProfile came from defaultLlmProfile (triggers error path)
 * @param logger - Logger for warn/error messages
 */
export function validatePersonaLlmProfile(
  resolvedProfile: string,
  personaId: string,
  featureProfile: string,
  availableProfiles: Record<string, unknown>,
  isFromDefault: boolean,
  logger: {
    warn(msg: string, meta?: Record<string, unknown>): void
    error(msg: string, meta?: Record<string, unknown>): void
  }
): ProfileValidationResult {
  // Valid profile — use it
  if (resolvedProfile in availableProfiles) {
    return { profileId: resolvedProfile }
  }

  // Invalid defaultLlmProfile → error once, return error message
  if (isFromDefault) {
    if (!_erroredDefaults.has(resolvedProfile)) {
      _erroredDefaults.add(resolvedProfile)
      logger.error('Invalid defaultLlmProfile in persona config', {
        profileId: resolvedProfile,
        personaId,
        availableProfiles: Object.keys(availableProfiles),
      })
    }
    return { errorMessage: `Persona ${personaId}'s profile ${resolvedProfile} is not recognized` }
  }

  // Invalid per-persona or YAML profile → warn once, fall back to feature profile
  if (!_warnedProfiles.has(resolvedProfile)) {
    _warnedProfiles.add(resolvedProfile)
    logger.warn('Persona LLM profile not found, falling back to feature profile', {
      resolvedProfile,
      personaId,
      fallbackProfile: featureProfile,
      availableProfiles: Object.keys(availableProfiles),
    })
  }
  return { profileId: featureProfile }
}

// ============================================================================
// Persona Profile Resolution (combined resolve + validate)
// ============================================================================

/**
 * Merge user persona config with defaults.
 * Extracts the PersonaProfileConfig subset needed for profile resolution.
 */
export function mergePersonaConfig(config: SessionSummaryConfig): PersonaProfileConfig {
  return { ...DEFAULT_SESSION_SUMMARY_CONFIG.personas, ...config.personas }
}

/**
 * Resolve and validate the effective LLM profile for a persona-driven generation.
 *
 * Combines the resolve-validate-fallback pattern used by all 4 generation call sites
 * (snarky + resume in both update-summary and on-demand-generation).
 *
 * @returns `{ profileId }` on success, `{ errorMessage }` on invalid default profile
 */
export function getEffectiveProfile(
  persona: PersonaDefinition | null,
  llmConfig: LlmSubFeatureConfig,
  config: SessionSummaryConfig,
  availableProfiles: Record<string, unknown>,
  logger: {
    warn(msg: string, meta?: Record<string, unknown>): void
    error(msg: string, meta?: Record<string, unknown>): void
  }
): ProfileValidationResult {
  const personaId = persona?.id ?? ''
  const personaConfig = mergePersonaConfig(config)
  const resolvedProfile = resolvePersonaLlmProfile(personaId, persona, personaConfig)

  if (!resolvedProfile) {
    return { profileId: llmConfig.profile }
  }

  return validatePersonaLlmProfile(
    resolvedProfile,
    personaId,
    llmConfig.profile,
    availableProfiles,
    resolvedProfile === personaConfig.defaultLlmProfile,
    logger
  )
}
