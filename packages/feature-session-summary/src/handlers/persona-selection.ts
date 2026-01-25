/**
 * Persona Selection Handler
 *
 * Selects and persists a random persona on SessionStart.
 * Respects allowList configuration and logs warnings for unknown entries.
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Selection Algorithm
 */

import { createPersonaLoader, getDefaultPersonasDir } from '@sidekick/core'
import type { DaemonContext, SessionPersonaState, PersonaDefinition } from '@sidekick/types'
import { createSessionSummaryState } from '../state.js'
import type { SessionSummaryConfig } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types.js'

/**
 * Parse the allowList string into an array of persona IDs.
 * Splits on commas, trims whitespace, and filters empty entries.
 *
 * @param allowList - Comma-separated string of persona IDs
 * @returns Array of persona IDs (empty if allowList was empty/whitespace)
 */
export function parseAllowList(allowList: string): string[] {
  if (!allowList || !allowList.trim()) {
    return []
  }
  return allowList
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

/**
 * Filter personas by allowList and log warnings for unknown entries.
 *
 * @param personas - Map of all available personas
 * @param allowList - Array of allowed persona IDs (empty = all personas)
 * @param logger - Logger for warnings
 * @returns Filtered array of personas
 */
export function filterPersonasByAllowList(
  personas: Map<string, PersonaDefinition>,
  allowList: string[],
  logger: { warn: (msg: string, data?: Record<string, unknown>) => void }
): PersonaDefinition[] {
  // If allowList is empty, return all personas
  if (allowList.length === 0) {
    return Array.from(personas.values())
  }

  // Filter to allowed personas, logging warnings for unknown entries
  const result: PersonaDefinition[] = []
  for (const id of allowList) {
    const persona = personas.get(id)
    if (persona) {
      result.push(persona)
    } else {
      logger.warn('Unknown persona in allowList, ignoring', { personaId: id })
    }
  }

  return result
}

/**
 * Select a random persona from the available pool.
 *
 * @param personas - Array of personas to select from
 * @returns Selected persona, or null if pool is empty
 */
export function selectRandomPersona(personas: PersonaDefinition[]): PersonaDefinition | null {
  if (personas.length === 0) {
    return null
  }
  const index = Math.floor(Math.random() * personas.length)
  return personas[index]
}

/**
 * Select and persist a persona for the session.
 *
 * @param sessionId - Session identifier
 * @param config - Session summary feature config (merged with defaults)
 * @param ctx - Daemon context
 * @returns Selected persona ID, or null if selection was skipped/failed
 */
export async function selectPersonaForSession(
  sessionId: string,
  config: SessionSummaryConfig,
  ctx: DaemonContext
): Promise<string | null> {
  // Merge persona config with defaults
  const personaConfig = {
    ...DEFAULT_SESSION_SUMMARY_CONFIG.personas,
    ...config.personas,
  }

  // Create persona loader with project context
  const loader = createPersonaLoader({
    defaultPersonasDir: getDefaultPersonasDir(),
    projectRoot: ctx.paths.projectDir,
    logger: ctx.logger,
  })

  // Discover all available personas
  const allPersonas = loader.discover()

  if (allPersonas.size === 0) {
    ctx.logger.warn('No personas found, skipping persona selection', { sessionId })
    return null
  }

  // Parse and filter by allowList
  const allowList = parseAllowList(personaConfig.allowList ?? '')
  const eligiblePersonas = filterPersonasByAllowList(allPersonas, allowList, ctx.logger)

  if (eligiblePersonas.length === 0) {
    ctx.logger.warn('No eligible personas after allowList filtering', {
      sessionId,
      allowList,
      availablePersonas: Array.from(allPersonas.keys()),
    })
    return null
  }

  // Select random persona
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const selected = selectRandomPersona(eligiblePersonas)!

  // Persist selection
  const personaState: SessionPersonaState = {
    persona_id: selected.id,
    selected_from: eligiblePersonas.map((p) => p.id),
    timestamp: new Date().toISOString(),
  }

  const summaryState = createSessionSummaryState(ctx.stateService)
  await summaryState.sessionPersona.write(sessionId, personaState)

  ctx.logger.info('Selected persona for session', {
    sessionId,
    personaId: selected.id,
    personaName: selected.display_name,
    poolSize: eligiblePersonas.length,
  })

  return selected.id
}
