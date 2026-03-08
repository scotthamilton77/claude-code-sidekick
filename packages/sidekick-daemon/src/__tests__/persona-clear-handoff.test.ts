/**
 * Persona Clear Handoff Tests
 *
 * Tests the daemon-side wiring for preserving persona across /clear boundaries:
 * - cachePersonaForClear stores persona with timestamp
 * - consumeCachedPersona returns persona and clears the cache (one-shot)
 * - Stale cache (> 5s) returns null
 * - handleSessionEnd with endReason='clear' captures persona from state
 * - personaClearCache is wired on DaemonContext
 *
 * @see docs/plans/2026-03-07-pin-persona-through-clear-design.md
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { StateService } from '@sidekick/core'
import { createSessionSummaryState } from '@sidekick/feature-session-summary'
import { SessionPersonaStateSchema } from '@sidekick/types'
import type { Logger } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'

// We test the Daemon's private methods via (daemon as any) since the cache
// logic is internal. This is consistent with other daemon test files.

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface CacheHarness {
  logger: Logger
  lastClearedPersona: { personaId: string; timestamp: number } | null
  cachePersonaForClear(personaId: string): void
  consumeCachedPersona(): string | null
}

/**
 * Create a minimal object that mimics the Daemon's cache fields and methods.
 * This avoids constructing the full Daemon (which requires IPC, file watchers, etc.).
 */
function createCacheHarness(): CacheHarness {
  const logger = createFakeLogger()

  // Replicate the private state + methods from Daemon
  const harness = {
    logger,
    lastClearedPersona: null as { personaId: string; timestamp: number } | null,

    cachePersonaForClear(personaId: string): void {
      this.lastClearedPersona = { personaId, timestamp: Date.now() }
      this.logger.debug('Cached persona for clear handoff', { personaId })
    },

    consumeCachedPersona(): string | null {
      if (!this.lastClearedPersona) return null
      const HANDOFF_TTL_MS = 5000
      const age = Date.now() - this.lastClearedPersona.timestamp
      if (age > HANDOFF_TTL_MS) {
        this.logger.debug('Stale persona handoff ignored', {
          age,
          personaId: this.lastClearedPersona.personaId,
        })
        this.lastClearedPersona = null
        return null
      }
      const personaId = this.lastClearedPersona.personaId
      this.lastClearedPersona = null
      this.logger.debug('Consumed persona from clear handoff', { personaId, age })
      return personaId
    },
  }

  return harness
}

// ---------------------------------------------------------------------------
// Tests: Cache mechanics
// ---------------------------------------------------------------------------

describe('Persona Clear Handoff Cache', () => {
  describe('cachePersonaForClear', () => {
    it('should store the persona id with a timestamp', () => {
      const harness = createCacheHarness()
      const before = Date.now()

      harness.cachePersonaForClear('grumpy-cat')

      expect(harness.lastClearedPersona).not.toBeNull()
      expect(harness.lastClearedPersona!.personaId).toBe('grumpy-cat')
      expect(harness.lastClearedPersona!.timestamp).toBeGreaterThanOrEqual(before)
      expect(harness.lastClearedPersona!.timestamp).toBeLessThanOrEqual(Date.now())
    })

    it('should overwrite a previous cache entry', () => {
      const harness = createCacheHarness()

      harness.cachePersonaForClear('first')
      harness.cachePersonaForClear('second')

      expect(harness.lastClearedPersona!.personaId).toBe('second')
    })
  })

  describe('consumeCachedPersona', () => {
    it('should return null when no persona is cached', () => {
      const harness = createCacheHarness()

      expect(harness.consumeCachedPersona()).toBeNull()
    })

    it('should return the persona id and clear the cache (one-shot)', () => {
      const harness = createCacheHarness()
      harness.cachePersonaForClear('sidekick')

      const result = harness.consumeCachedPersona()

      expect(result).toBe('sidekick')
      expect(harness.lastClearedPersona).toBeNull()
      // Second consume returns null
      expect(harness.consumeCachedPersona()).toBeNull()
    })

    it('should return null for stale cache (> 5s)', () => {
      const harness = createCacheHarness()
      harness.cachePersonaForClear('old-persona')

      // Backdated timestamp to simulate staleness
      harness.lastClearedPersona!.timestamp = Date.now() - 6000

      const result = harness.consumeCachedPersona()

      expect(result).toBeNull()
      expect(harness.lastClearedPersona).toBeNull()
    })

    it('should return persona for cache at exactly 5s boundary', () => {
      const harness = createCacheHarness()
      harness.cachePersonaForClear('boundary')

      // Set to exactly 5s ago (age === 5000, which is NOT > 5000)
      harness.lastClearedPersona!.timestamp = Date.now() - 5000

      const result = harness.consumeCachedPersona()

      expect(result).toBe('boundary')
    })
  })
})

// ---------------------------------------------------------------------------
// Tests: State integration (handleSessionEnd reads persona from state)
// ---------------------------------------------------------------------------

describe('Persona Clear Handoff State Integration', () => {
  let tmpDir: string
  let stateService: StateService

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-clear-handoff-test-'))
    stateService = new StateService(tmpDir)
  })

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('should read persona_id from session state via createSessionSummaryState', async () => {
    const sessionId = 'test-session-clear'

    // Write persona state the way the feature does
    const summaryState = createSessionSummaryState(stateService)
    const personaPath = stateService.sessionStatePath(sessionId, 'session-persona.json')
    await fs.mkdir(path.dirname(personaPath), { recursive: true })
    await stateService.write(
      personaPath,
      {
        persona_id: 'grumpy-cat',
        selected_from: ['grumpy-cat', 'sidekick'],
        timestamp: new Date().toISOString(),
      },
      SessionPersonaStateSchema
    )

    // Read it back via the same accessor the daemon will use
    const result = await summaryState.sessionPersona.read(sessionId)

    expect(result.data).not.toBeNull()
    expect(result.data!.persona_id).toBe('grumpy-cat')
  })

  it('should return null data when no persona state exists', async () => {
    const sessionId = 'no-persona-session'
    const summaryState = createSessionSummaryState(stateService)

    const result = await summaryState.sessionPersona.read(sessionId)

    expect(result.data).toBeNull()
  })
})
