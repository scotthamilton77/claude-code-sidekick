/**
 * Daemon Session Flow Safety Net Tests
 *
 * Tests the session lifecycle through handleSessionStart and handleSessionEnd.
 * These methods STAY on Daemon after extraction and represent the session
 * orchestration contract.
 *
 * Strategy: Calls private methods directly via type-cast. Verifies OBSERVABLE
 * outcomes (filesystem state, serviceFactory calls, persona cache) without
 * accessing fields that will MOVE during extraction.
 *
 * Fields accessed (all STAY on Daemon):
 * - handleSessionStart, handleSessionEnd, consumeCachedPersona (methods)
 * - serviceFactory (field)
 *
 * Fields NOT accessed (MOVE during extraction):
 * - logCounters, globalLogCounters -> LogMetricsManager
 * - instrumentedProviders -> LLMProviderManager
 *
 * @see docs/design/DAEMON.md §4.7
 * @see docs/design/FEATURE-REMINDERS.md §4.1
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { ServiceFactory, SessionStartHookEvent, SessionEndHookEvent } from '@sidekick/types'

let tmpDir: string

// -------------------------------------------------------------------------
// HookEvent factories
// -------------------------------------------------------------------------

function makeSessionStartEvent(
  sessionId: string,
  startType: 'startup' | 'resume' | 'clear' | 'compact'
): SessionStartHookEvent {
  return {
    kind: 'hook',
    hook: 'SessionStart',
    context: { sessionId, timestamp: Date.now() },
    payload: { startType, transcriptPath: '/tmp/fake-transcript' },
  }
}

function makeSessionEndEvent(
  sessionId: string,
  endReason: 'clear' | 'logout' | 'prompt_input_exit' | 'other'
): SessionEndHookEvent {
  return {
    kind: 'hook',
    hook: 'SessionEnd',
    context: { sessionId, timestamp: Date.now() },
    payload: { endReason },
  }
}

describe('Daemon session flow', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'session-flow-test-'))
    await fs.mkdir(join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await new Promise((r) => setImmediate(r))
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true })
    }
  })

  /**
   * Helper to create a Daemon with session-flow method access.
   * Only accesses fields/methods that STAY on Daemon after extraction.
   */
  async function createTestDaemon(projectDir: string): Promise<{
    daemon: InstanceType<typeof import('../daemon.js').Daemon>
    sup: {
      token: string
      handleSessionStart(event: SessionStartHookEvent, options?: { logger?: unknown }): Promise<void>
      handleSessionEnd(event: SessionEndHookEvent, options?: { logger?: unknown }): Promise<void>
      consumeCachedPersona(): string | null
      serviceFactory: ServiceFactory
    }
  }> {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(projectDir)
    const sup = daemon as unknown as {
      token: string
      handleSessionStart(event: SessionStartHookEvent, options?: { logger?: unknown }): Promise<void>
      handleSessionEnd(event: SessionEndHookEvent, options?: { logger?: unknown }): Promise<void>
      consumeCachedPersona(): string | null
      serviceFactory: ServiceFactory
    }
    sup.token = 'test-token'
    return { daemon, sup }
  }

  // -------------------------------------------------------------------------
  // SessionStart: staging cleanup
  // -------------------------------------------------------------------------

  describe('SessionStart', () => {
    it('startup clears staging directory', async () => {
      const { sup } = await createTestDaemon(tmpDir)
      const sessionId = 'test-session-startup'

      // Pre-populate staging files via the serviceFactory (stays on Daemon)
      const staging = sup.serviceFactory.getStagingService(sessionId)
      await staging.stageReminder('PreToolUse', 'test-reminder', {
        name: 'test-reminder',
        blocking: false,
        priority: 50,
        persistent: false,
        userMessage: 'test message',
      })

      // Verify staging was created
      const before = await staging.listReminders('PreToolUse')
      expect(before).toHaveLength(1)

      // Act: SessionStart with startup should clear staging
      await sup.handleSessionStart(makeSessionStartEvent(sessionId, 'startup'))

      // Assert: staging is cleared
      const after = await staging.listReminders('PreToolUse')
      expect(after).toHaveLength(0)
    })

    it('clear clears staging directory', async () => {
      const { sup } = await createTestDaemon(tmpDir)
      const sessionId = 'test-session-clear'

      // Pre-populate staging
      const staging = sup.serviceFactory.getStagingService(sessionId)
      await staging.stageReminder('Stop', 'another-reminder', {
        name: 'another-reminder',
        blocking: false,
        priority: 30,
        persistent: false,
        userMessage: 'another message',
      })

      // Verify staging was created
      expect(await staging.listReminders('Stop')).toHaveLength(1)

      // Act: SessionStart with clear should clear staging
      await sup.handleSessionStart(makeSessionStartEvent(sessionId, 'clear'))

      // Assert: staging is cleared
      expect(await staging.listReminders('Stop')).toHaveLength(0)
    })

    it('resume preserves staging directory', async () => {
      const { sup } = await createTestDaemon(tmpDir)
      const sessionId = 'test-session-resume'

      // Pre-populate staging
      const staging = sup.serviceFactory.getStagingService(sessionId)
      await staging.stageReminder('PreToolUse', 'persistent-reminder', {
        name: 'persistent-reminder',
        blocking: false,
        priority: 50,
        persistent: true,
        userMessage: 'should survive resume',
      })

      // Verify staging was created
      expect(await staging.listReminders('PreToolUse')).toHaveLength(1)

      // Act: SessionStart with resume should NOT clear staging
      await sup.handleSessionStart(makeSessionStartEvent(sessionId, 'resume'))

      // Assert: staging is preserved
      const after = await staging.listReminders('PreToolUse')
      expect(after).toHaveLength(1)
      expect(after[0].name).toBe('persistent-reminder')
    })
  })

  // -------------------------------------------------------------------------
  // SessionEnd: persona handoff and service shutdown
  // -------------------------------------------------------------------------

  describe('SessionEnd', () => {
    it('clear caches persona for handoff', async () => {
      const { sup } = await createTestDaemon(tmpDir)
      const sessionId = 'test-session-persona'

      // Write session-persona.json to disk (what the CLI would write)
      const sessionStateDir = join(tmpDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(sessionStateDir, { recursive: true })
      await fs.writeFile(
        join(sessionStateDir, 'session-persona.json'),
        JSON.stringify({
          persona_id: 'grumpy-cat',
          selected_from: ['grumpy-cat', 'sidekick'],
          timestamp: new Date().toISOString(),
        })
      )

      // Act: SessionEnd with clear should cache persona
      await sup.handleSessionEnd(makeSessionEndEvent(sessionId, 'clear'))

      // Assert: consumeCachedPersona returns the persona from the file
      const cached = sup.consumeCachedPersona()
      expect(cached).toBe('grumpy-cat')
    })

    it('non-clear end does NOT cache persona', async () => {
      const { sup } = await createTestDaemon(tmpDir)
      const sessionId = 'test-session-no-cache'

      // Write session-persona.json (persona exists but end reason is not clear)
      const sessionStateDir = join(tmpDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(sessionStateDir, { recursive: true })
      await fs.writeFile(
        join(sessionStateDir, 'session-persona.json'),
        JSON.stringify({
          persona_id: 'sidekick',
          selected_from: ['sidekick'],
          timestamp: new Date().toISOString(),
        })
      )

      // Act: SessionEnd with 'other' should NOT cache persona
      await sup.handleSessionEnd(makeSessionEndEvent(sessionId, 'other'))

      // Assert: no cached persona
      expect(sup.consumeCachedPersona()).toBeNull()
    })

    it('shuts down session services via serviceFactory', async () => {
      const { sup } = await createTestDaemon(tmpDir)
      const sessionId = 'test-session-shutdown'

      // Spy on serviceFactory.shutdownSession (stays on Daemon)
      const shutdownSpy = vi.spyOn(sup.serviceFactory, 'shutdownSession').mockResolvedValue(undefined)

      // Act
      await sup.handleSessionEnd(makeSessionEndEvent(sessionId, 'other'))

      // Assert: shutdownSession called with the session ID
      expect(shutdownSpy).toHaveBeenCalledWith(sessionId)
    })
  })
})
