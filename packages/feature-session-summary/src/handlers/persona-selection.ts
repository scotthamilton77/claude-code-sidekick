/**
 * Persona Selection Handler
 *
 * Selects and persists a random persona on SessionStart.
 * Respects allowList and blockList configuration and logs warnings for unknown entries.
 *
 * @see docs/design/PERSONA-PROFILES-DESIGN.md - Selection Algorithm
 */

import { createPersonaLoader, getDefaultPersonasDir, logEvent, LogEvents } from '@sidekick/core'
import type { DaemonContext, SessionPersonaState, PersonaDefinition } from '@sidekick/types'
import { createSessionSummaryState } from '../state.js'
import type { SessionSummaryConfig } from '../types.js'
import { DEFAULT_SESSION_SUMMARY_CONFIG } from '../types.js'

/**
 * Parse a comma-separated persona list string into an array of persona IDs.
 * Splits on commas, trims whitespace, and filters empty entries.
 *
 * @param list - Comma-separated string of persona IDs
 * @returns Array of persona IDs (empty if list was empty/whitespace)
 */
export function parsePersonaList(list: string): string[] {
  if (!list || !list.trim()) {
    return []
  }
  return list
    .split(',')
    .map((id) => id.trim())
    .filter((id) => id.length > 0)
}

/**
 * Filter personas by allowList and blockList, logging warnings for unknown entries.
 *
 * @param personas - Map of all available personas
 * @param allowList - Array of allowed persona IDs (empty = all personas)
 * @param blockList - Array of blocked persona IDs to exclude
 * @param logger - Logger for warnings
 * @returns Filtered array of personas
 */
export function filterPersonas(
  personas: Map<string, PersonaDefinition>,
  allowList: string[],
  blockList: string[],
  logger: { warn: (msg: string, data?: Record<string, unknown>) => void }
): PersonaDefinition[] {
  // Step 1: Apply allowList (empty = all, non-empty = only listed)
  let result: PersonaDefinition[]
  if (allowList.length === 0) {
    result = Array.from(personas.values())
  } else {
    result = []
    for (const id of allowList) {
      const persona = personas.get(id)
      if (persona) {
        result.push(persona)
      } else {
        logger.warn('Unknown persona in allowList, ignoring', { personaId: id })
      }
    }
  }

  // Step 2: Remove blocked personas
  if (blockList.length > 0) {
    const blockedSet = new Set(blockList)
    // Warn about unknown blockList entries
    for (const id of blockList) {
      if (!personas.has(id)) {
        logger.warn('Unknown persona in blockList, ignoring', { personaId: id })
      }
    }
    result = result.filter((p) => !blockedSet.has(p.id))
  }

  return result
}

/**
 * Select a random persona from the available pool, optionally using weights.
 * When weights are provided, personas with non-positive or non-finite weights are excluded and selection
 * probability is proportional to each persona's weight. Unspecified weights default to 1.
 *
 * @param personas - Array of personas to select from
 * @param weights - Optional map of persona ID to selection weight (default 1, non-positive/non-finite = excluded). Values are coerced via Number() to handle YAML string inputs.
 * @returns Selected persona, or null if pool is empty or all weights are non-positive/non-finite
 */
export function selectRandomPersona(
  personas: PersonaDefinition[],
  weights?: Record<string, number | string>
): PersonaDefinition | null {
  if (personas.length === 0) {
    return null
  }

  // Build weighted entries: assign weight per persona, filter out non-positive/invalid weights
  const weighted = personas
    .map((p) => {
      const raw = weights?.[p.id]
      const weight = raw === undefined ? 1 : Number(raw)
      return { persona: p, weight }
    })
    .filter((entry) => Number.isFinite(entry.weight) && entry.weight > 0)

  if (weighted.length === 0) {
    return null
  }

  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0)
  const threshold = Math.random() * totalWeight

  let accumulated = 0
  for (const entry of weighted) {
    accumulated += entry.weight
    if (accumulated > threshold) {
      return entry.persona
    }
  }

  // Floating-point edge case: return last entry
  return weighted[weighted.length - 1].persona
}

/**
 * Options for persona selection behavior.
 */
export interface PersonaSelectionOptions {
  /** How the session started */
  startType?: 'startup' | 'clear' | 'resume' | 'compact'
}

/**
 * Select and persist a persona for the session.
 *
 * @param sessionId - Session identifier
 * @param config - Session summary feature config (merged with defaults)
 * @param ctx - Daemon context
 * @param options - Optional selection behavior overrides
 * @returns Selected persona ID, or null if selection was skipped/failed
 */
export async function selectPersonaForSession(
  sessionId: string,
  config: SessionSummaryConfig,
  ctx: DaemonContext,
  options?: PersonaSelectionOptions
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

  // Check for pinned persona (bypasses allowList/blockList/weights)
  const pinnedPersona = personaConfig.pinnedPersona?.trim()
  if (pinnedPersona) {
    const pinned = allPersonas.get(pinnedPersona)
    if (pinned) {
      // Persist pinned persona as session selection
      const personaState: SessionPersonaState = {
        persona_id: pinned.id,
        selected_from: [pinned.id],
        timestamp: new Date().toISOString(),
      }
      const summaryState = createSessionSummaryState(ctx.stateService)
      await summaryState.sessionPersona.write(sessionId, personaState)

      logEvent(
        ctx.logger,
        LogEvents.personaSelected(
          { sessionId },
          {
            personaId: pinned.id,
            selectionMethod: 'pinned',
            poolSize: 1,
          }
        )
      )
      return pinned.id
    }

    ctx.logger.warn('Pinned persona not found, falling back to random selection', {
      sessionId,
      pinnedPersona,
      availablePersonas: Array.from(allPersonas.keys()),
    })
  }

  // Check for persona preserved from /clear handoff
  const persistThroughClear = personaConfig.persistThroughClear ?? true
  ctx.logger.info('[persona-lifecycle] ClearHandoff: checking clear cache', {
    sessionId,
    persistThroughClear,
    startType: options?.startType,
    hasClearCache: !!ctx.personaClearCache,
  })
  if (persistThroughClear && options?.startType === 'clear' && ctx.personaClearCache) {
    const cachedPersonaId = ctx.personaClearCache.consume()
    ctx.logger.info('[persona-lifecycle] ClearHandoff: consumed cache', {
      sessionId,
      cachedPersonaId: cachedPersonaId ?? null,
    })
    if (cachedPersonaId) {
      const cachedPersona = allPersonas.get(cachedPersonaId)
      if (cachedPersona) {
        const personaState: SessionPersonaState = {
          persona_id: cachedPersona.id,
          selected_from: [cachedPersona.id],
          timestamp: new Date().toISOString(),
        }
        const summaryState = createSessionSummaryState(ctx.stateService)
        await summaryState.sessionPersona.write(sessionId, personaState)

        logEvent(
          ctx.logger,
          LogEvents.personaSelected(
            { sessionId },
            {
              personaId: cachedPersona.id,
              selectionMethod: 'handoff',
              poolSize: 1,
            }
          )
        )
        return cachedPersona.id
      } else {
        ctx.logger.warn('Cached persona from clear not found in available personas, falling back to selection', {
          sessionId,
          cachedPersonaId,
        })
      }
    }
  }

  // Parse and filter by allowList and blockList
  const allowList = parsePersonaList(personaConfig.allowList ?? '')
  const blockList = parsePersonaList(personaConfig.blockList ?? '')
  const eligiblePersonas = filterPersonas(allPersonas, allowList, blockList, ctx.logger)

  if (eligiblePersonas.length === 0) {
    ctx.logger.warn('No eligible personas after filtering', {
      sessionId,
      allowList,
      blockList,
      availablePersonas: Array.from(allPersonas.keys()),
    })
    return null
  }

  // Select random persona (weighted if configured)
  const selected = selectRandomPersona(eligiblePersonas, personaConfig.weights)
  if (!selected) {
    ctx.logger.warn('No eligible personas after applying weights', {
      sessionId,
      weights: personaConfig.weights,
      eligibleCount: eligiblePersonas.length,
    })
    return null
  }

  // Persist selection
  const personaState: SessionPersonaState = {
    persona_id: selected.id,
    selected_from: eligiblePersonas.map((p) => p.id),
    timestamp: new Date().toISOString(),
  }

  const summaryState = createSessionSummaryState(ctx.stateService)
  await summaryState.sessionPersona.write(sessionId, personaState)

  logEvent(
    ctx.logger,
    LogEvents.personaSelected(
      { sessionId },
      {
        personaId: selected.id,
        selectionMethod: 'random',
        poolSize: eligiblePersonas.length,
      }
    )
  )

  return selected.id
}

/**
 * Ensure persona state exists for a session, re-selecting if missing.
 * Recovers from state loss caused by clean-all, the sidekick-setup skill,
 * or other operations that clear session state mid-session.
 *
 * No-op when persona state already exists.
 *
 * @param sessionId - Session identifier
 * @param ctx - Daemon context
 */
export async function ensurePersonaForSession(sessionId: string, ctx: DaemonContext): Promise<void> {
  try {
    const summaryState = createSessionSummaryState(ctx.stateService)
    const result = await summaryState.sessionPersona.read(sessionId)
    if (result.data) return

    ctx.logger.info('Persona state missing for active session, re-selecting', { sessionId })
    const featureConfig = ctx.config.getFeature<SessionSummaryConfig>('session-summary')
    const config = { ...DEFAULT_SESSION_SUMMARY_CONFIG, ...featureConfig.settings }
    await selectPersonaForSession(sessionId, config, ctx)
  } catch (err) {
    ctx.logger.warn('Failed to ensure persona for session', {
      sessionId,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}
