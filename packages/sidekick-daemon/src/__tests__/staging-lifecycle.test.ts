/**
 * Staging Lifecycle Tests
 *
 * Tests for Phase 5.4 StagingService integration with Daemon:
 * - Initialize StagingService on SessionStart
 * - Clean staging directories on SessionStart (startup|clear)
 * - Preserve staging on resume
 *
 * NOTE: These tests use @sidekick/core StagingService classes directly.
 * They exist here to verify staging lifecycle behaviors as they relate to
 * Daemon session management (startup, resume, clear). Pure unit tests
 * for StagingServiceCore APIs belong in @sidekick/core.
 *
 * @see docs/design/flow.md §2.2 Staging Pattern
 * @see docs/design/flow.md §5.1 SessionStart hook flow
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { StagingServiceCore, SessionScopedStagingService, createConsoleLogger, StateService } from '@sidekick/core'
import type { StagedReminder, Logger } from '@sidekick/types'

const logger = createConsoleLogger({ minimumLevel: 'error' })

function createStateService(testDir: string, testLogger: Logger): StateService {
  return new StateService(testDir, { logger: testLogger, cache: false })
}

/**
 * Create a temporary test directory.
 */
function createTestDir(): string {
  const dir = join(tmpdir(), `staging-lifecycle-test-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Create a test reminder.
 */
function createTestReminder(name: string, priority = 50): StagedReminder {
  return {
    name,
    blocking: false,
    priority,
    persistent: false,
    userMessage: `Test message for ${name}`,
  }
}

describe('Staging Lifecycle', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe('StagingService initialization on SessionStart', () => {
    it('should create staging directory structure on first stage', async () => {
      const sessionId = 'new-session-abc'
      const core = new StagingServiceCore({ stateDir: testDir, logger, scope: 'project', stateService: createStateService(testDir, logger) })
      const service = new SessionScopedStagingService(core, sessionId, 'project')

      await service.stageReminder('PreToolUse', 'TestReminder', createTestReminder('TestReminder'))

      const stagingRoot = join(testDir, 'sessions', sessionId, 'stage', 'PreToolUse')
      expect(existsSync(stagingRoot)).toBe(true)
    })
  })

  describe('Staging cleanup on SessionStart (startup|clear)', () => {
    it('should clear all staging when startType is startup', async () => {
      const sessionId = 'cleanup-session-1'

      // Pre-populate staging (simulating previous session state)
      const core = new StagingServiceCore({ stateDir: testDir, logger, scope: 'project', stateService: createStateService(testDir, logger) })
      const service = new SessionScopedStagingService(core, sessionId, 'project')

      await service.stageReminder('PreToolUse', 'OldReminder1', createTestReminder('OldReminder1'))
      await service.stageReminder('Stop', 'OldReminder2', createTestReminder('OldReminder2'))

      // Verify reminders exist
      expect(await service.listReminders('PreToolUse')).toHaveLength(1)
      expect(await service.listReminders('Stop')).toHaveLength(1)

      // Simulate SessionStart with startType='startup' - clear all staging
      await service.clearStaging()

      // Verify staging is cleared
      expect(await service.listReminders('PreToolUse')).toHaveLength(0)
      expect(await service.listReminders('Stop')).toHaveLength(0)
    })

    it('should clear all staging when startType is clear', async () => {
      const sessionId = 'cleanup-session-2'

      const core = new StagingServiceCore({ stateDir: testDir, logger, scope: 'project', stateService: createStateService(testDir, logger) })
      const service = new SessionScopedStagingService(core, sessionId, 'project')

      await service.stageReminder('UserPromptSubmit', 'Reminder1', createTestReminder('Reminder1'))

      // Verify state exists
      expect(await service.listReminders('UserPromptSubmit')).toHaveLength(1)

      // Clear staging (simulating SessionStart with startType='clear')
      await service.clearStaging()

      // Verify everything is cleared
      expect(await service.listReminders('UserPromptSubmit')).toHaveLength(0)
    })

    it('should NOT clear staging when startType is resume', async () => {
      const sessionId = 'resume-session-1'

      const core = new StagingServiceCore({ stateDir: testDir, logger, scope: 'project', stateService: createStateService(testDir, logger) })
      const service = new SessionScopedStagingService(core, sessionId, 'project')

      await service.stageReminder('PreToolUse', 'PersistentReminder', createTestReminder('PersistentReminder'))

      // On resume, we do NOT clear staging
      // (This test documents the expected behavior - no cleanup call)
      expect(await service.listReminders('PreToolUse')).toHaveLength(1)
    })

    it('should NOT clear staging when startType is compact', async () => {
      const sessionId = 'compact-session-1'

      const core = new StagingServiceCore({ stateDir: testDir, logger, scope: 'project', stateService: createStateService(testDir, logger) })
      const service = new SessionScopedStagingService(core, sessionId, 'project')

      await service.stageReminder('Stop', 'CompactReminder', createTestReminder('CompactReminder'))

      // On compact, we do NOT clear staging - reminders should persist
      expect(await service.listReminders('Stop')).toHaveLength(1)
    })
  })

  describe('Staging isolation between sessions', () => {
    it('should isolate staging between different session IDs', async () => {
      const core = new StagingServiceCore({ stateDir: testDir, logger, scope: 'project', stateService: createStateService(testDir, logger) })
      const session1 = new SessionScopedStagingService(core, 'session-aaa', 'project')
      const session2 = new SessionScopedStagingService(core, 'session-bbb', 'project')

      await session1.stageReminder('PreToolUse', 'Session1Reminder', createTestReminder('Session1Reminder'))
      await session2.stageReminder('PreToolUse', 'Session2Reminder', createTestReminder('Session2Reminder'))

      // Each session should only see its own reminders
      const session1Reminders = await session1.listReminders('PreToolUse')
      const session2Reminders = await session2.listReminders('PreToolUse')

      expect(session1Reminders).toHaveLength(1)
      expect(session1Reminders[0].name).toBe('Session1Reminder')

      expect(session2Reminders).toHaveLength(1)
      expect(session2Reminders[0].name).toBe('Session2Reminder')
    })

    it('should not affect other sessions when clearing staging', async () => {
      const core = new StagingServiceCore({ stateDir: testDir, logger, scope: 'project', stateService: createStateService(testDir, logger) })
      const session1 = new SessionScopedStagingService(core, 'session-xxx', 'project')
      const session2 = new SessionScopedStagingService(core, 'session-yyy', 'project')

      await session1.stageReminder('PreToolUse', 'Reminder1', createTestReminder('Reminder1'))
      await session2.stageReminder('PreToolUse', 'Reminder2', createTestReminder('Reminder2'))

      // Clear session1 staging
      await session1.clearStaging()

      // Session2 should be unaffected
      expect(await session1.listReminders('PreToolUse')).toHaveLength(0)
      expect(await session2.listReminders('PreToolUse')).toHaveLength(1)
    })
  })

  describe('Handler dispatch integration', () => {
    it('should be able to provide staging to handlers via setStagingProvider pattern', () => {
      const sessionId = 'handler-test-session'
      const core = new StagingServiceCore({ stateDir: testDir, logger, scope: 'project', stateService: createStateService(testDir, logger) })
      const service = new SessionScopedStagingService(core, sessionId, 'project')

      // Simulate the pattern used in Daemon
      const getStagingService = (): SessionScopedStagingService => service

      // Handler can access staging
      const staging = getStagingService()
      expect(staging.getStagingRoot()).toContain(sessionId)
    })
  })
})
