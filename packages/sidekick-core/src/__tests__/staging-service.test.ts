/**
 * Tests for StagingService implementations
 *
 * Tests cover:
 * - StagingServiceCore (stateless singleton with sessionId parameter)
 * - SessionScopedStagingService (per-session wrapper)
 *
 * @see docs/design/flow.md §2.2 Staging Pattern
 * @see docs/design/FEATURE-REMINDERS.md §3.3 Data Models
 */

import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import type { StagedReminder, Logger } from '@sidekick/types'
import { StagingServiceCore, SessionScopedStagingService, type StagingServiceCoreOptions } from '../staging-service'
import { StateService } from '../state/state-service'

// ============================================================================
// Test Utilities
// ============================================================================

function createTestDir(): string {
  const dir = join(tmpdir(), `staging-test-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn().mockReturnThis(),
    flush: vi.fn().mockResolvedValue(undefined),
  }
}

function createTestReminder(overrides: Partial<StagedReminder> = {}): StagedReminder {
  return {
    name: 'TestReminder',
    blocking: false,
    priority: 50,
    persistent: false,
    userMessage: 'Test message',
    additionalContext: 'Test context',
    ...overrides,
  }
}

function createStateService(testDir: string, logger: Logger): StateService {
  return new StateService(testDir, {
    logger,
    cache: false, // Tests don't need caching
  })
}

function createService(
  testDir: string,
  overrides: Partial<StagingServiceCoreOptions> = {}
): SessionScopedStagingService {
  const logger = overrides.logger ?? createMockLogger()
  const stateService = overrides.stateService ?? createStateService(testDir, logger)
  const core = new StagingServiceCore({
    stateDir: testDir,
    logger,
    stateService,
  })
  return new SessionScopedStagingService(core, 'test-session-123')
}

function createCore(testDir: string, overrides: Partial<StagingServiceCoreOptions> = {}): StagingServiceCore {
  const logger = overrides.logger ?? createMockLogger()
  const stateService = overrides.stateService ?? createStateService(testDir, logger)
  return new StagingServiceCore({
    stateDir: testDir,
    logger,
    stateService,
    ...overrides,
  })
}

function createSessionScoped(core: StagingServiceCore, sessionId: string): SessionScopedStagingService {
  return new SessionScopedStagingService(core, sessionId)
}

// ============================================================================
// Tests for SessionScopedStagingService (via createService helper)
// ============================================================================

describe('SessionScopedStagingService (via createService)', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  // ==========================================================================
  // stageReminder tests
  // ==========================================================================

  describe('stageReminder', () => {
    it('should create staging directory if it does not exist', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await service.stageReminder('PreToolUse', 'TestReminder', reminder)

      const hookDir = join(testDir, 'sessions', 'test-session-123', 'stage', 'PreToolUse')
      expect(existsSync(hookDir)).toBe(true)
    })

    it('should write reminder file with correct content', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder({
        name: 'AreYouStuckReminder',
        blocking: true,
        priority: 80,
        persistent: false,
        additionalContext: 'Agent may be stuck',
      })

      await service.stageReminder('PreToolUse', 'AreYouStuckReminder', reminder)

      const reminderPath = join(
        testDir,
        'sessions',
        'test-session-123',
        'stage',
        'PreToolUse',
        'AreYouStuckReminder.json'
      )
      expect(existsSync(reminderPath)).toBe(true)

      const content = JSON.parse(readFileSync(reminderPath, 'utf-8')) as StagedReminder
      expect(content.name).toBe('AreYouStuckReminder')
      expect(content.blocking).toBe(true)
      expect(content.priority).toBe(80)
      expect(content.persistent).toBe(false)
      expect(content.additionalContext).toBe('Agent may be stuck')
    })

    it('should use atomic writes (no partial files visible)', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await service.stageReminder('Stop', 'VerifyCompletion', reminder)

      // Check no .tmp files remain
      const hookDir = join(testDir, 'sessions', 'test-session-123', 'stage', 'Stop')
      const files = readdirSync(hookDir)
      expect(files.every((f) => !f.endsWith('.tmp'))).toBe(true)
    })

    it('should overwrite existing reminder file', async () => {
      const service = createService(testDir)

      await service.stageReminder(
        'PreToolUse',
        'TestReminder',
        createTestReminder({ priority: 50, additionalContext: 'First version' })
      )
      await service.stageReminder(
        'PreToolUse',
        'TestReminder',
        createTestReminder({ priority: 100, additionalContext: 'Updated version' })
      )

      const reminder = await service.readReminder('PreToolUse', 'TestReminder')
      expect(reminder?.priority).toBe(100)
      expect(reminder?.additionalContext).toBe('Updated version')
    })

    it('should log ReminderStaged event', async () => {
      const logger = createMockLogger()
      const service = createService(testDir, { logger })
      const reminder = createTestReminder({ name: 'TestReminder', priority: 75 })

      await service.stageReminder('UserPromptSubmit', 'TestReminder', reminder)

      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          type: 'reminder:staged',
          source: 'daemon',
          reminderName: 'TestReminder',
          hookName: 'UserPromptSubmit',
          priority: 75,
        })
      )
    })

    it('should pass enrichment fields through to the logged event', async () => {
      const logger = createMockLogger()
      const service = createService(testDir, { logger })
      const reminder = createTestReminder({ name: 'vc-build', priority: 80 })

      await service.stageReminder('Stop', 'vc-build', reminder, {
        reason: 'threshold_reached',
        triggeredBy: 'file_edit',
        thresholdState: { current: 3, threshold: 3 },
      })

      expect(logger.info).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          type: 'reminder:staged',
          reminderName: 'vc-build',
          reason: 'threshold_reached',
          triggeredBy: 'file_edit',
          thresholdState: { current: 3, threshold: 3 },
        })
      )
    })
  })

  // ==========================================================================
  // readReminder tests
  // ==========================================================================

  describe('readReminder', () => {
    it('should return null for non-existent reminder', async () => {
      const service = createService(testDir)

      const result = await service.readReminder('PreToolUse', 'NonExistent')

      expect(result).toBeNull()
    })

    it('should read staged reminder correctly', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder({
        name: 'ReadTest',
        blocking: true,
        priority: 90,
        reason: 'Test stop reason',
      })

      await service.stageReminder('Stop', 'ReadTest', reminder)
      const result = await service.readReminder('Stop', 'ReadTest')

      expect(result).toEqual(reminder)
    })

    it('should return null and log warning for malformed file', async () => {
      const logger = createMockLogger()
      const service = createService(testDir, { logger })

      // Create malformed file
      const hookDir = join(testDir, 'sessions', 'test-session-123', 'stage', 'PreToolUse')
      mkdirSync(hookDir, { recursive: true })
      writeFileSync(join(hookDir, 'Malformed.json'), 'not valid json{{{', 'utf-8')

      const result = await service.readReminder('PreToolUse', 'Malformed')

      expect(result).toBeNull()
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  // ==========================================================================
  // listReminders tests
  // ==========================================================================

  describe('listReminders', () => {
    it('should return empty array for non-existent hook directory', async () => {
      const service = createService(testDir)

      const result = await service.listReminders('NonExistentHook')

      expect(result).toEqual([])
    })

    it('should list all reminders sorted by priority (highest first)', async () => {
      const service = createService(testDir)

      await service.stageReminder(
        'PreToolUse',
        'LowPriority',
        createTestReminder({ name: 'LowPriority', priority: 20 })
      )
      await service.stageReminder(
        'PreToolUse',
        'HighPriority',
        createTestReminder({ name: 'HighPriority', priority: 80 })
      )
      await service.stageReminder(
        'PreToolUse',
        'MediumPriority',
        createTestReminder({ name: 'MediumPriority', priority: 50 })
      )

      const result = await service.listReminders('PreToolUse')

      expect(result).toHaveLength(3)
      expect(result[0].name).toBe('HighPriority')
      expect(result[1].name).toBe('MediumPriority')
      expect(result[2].name).toBe('LowPriority')
    })

    it('should skip malformed files', async () => {
      const service = createService(testDir)

      await service.stageReminder('PreToolUse', 'Valid', createTestReminder({ name: 'Valid' }))

      // Create malformed file
      const hookDir = join(testDir, 'sessions', 'test-session-123', 'stage', 'PreToolUse')
      writeFileSync(join(hookDir, 'Malformed.json'), '{invalid', 'utf-8')

      const result = await service.listReminders('PreToolUse')

      expect(result).toHaveLength(1)
      expect(result[0].name).toBe('Valid')
    })
  })

  // ==========================================================================
  // clearStaging tests
  // ==========================================================================

  describe('clearStaging', () => {
    it('should clear specific hook directory', async () => {
      const service = createService(testDir)

      await service.stageReminder('PreToolUse', 'Reminder1', createTestReminder())
      await service.stageReminder('Stop', 'Reminder2', createTestReminder())

      await service.clearStaging('PreToolUse')

      expect(await service.listReminders('PreToolUse')).toEqual([])
      expect(await service.listReminders('Stop')).toHaveLength(1)
    })

    it('should clear all hooks when no hookName provided', async () => {
      const service = createService(testDir)

      await service.stageReminder('PreToolUse', 'Reminder1', createTestReminder())
      await service.stageReminder('Stop', 'Reminder2', createTestReminder())
      await service.stageReminder('UserPromptSubmit', 'Reminder3', createTestReminder())

      await service.clearStaging()

      expect(await service.listReminders('PreToolUse')).toEqual([])
      expect(await service.listReminders('Stop')).toEqual([])
      expect(await service.listReminders('UserPromptSubmit')).toEqual([])
    })

    it('should handle clearing non-existent directory gracefully', async () => {
      const service = createService(testDir)

      // Should not throw
      await expect(service.clearStaging('NonExistent')).resolves.toBeUndefined()
    })
  })

  // ==========================================================================
  // deleteReminder tests
  // ==========================================================================

  describe('deleteReminder', () => {
    it('should delete existing reminder', async () => {
      const service = createService(testDir)

      await service.stageReminder('PreToolUse', 'ToDelete', createTestReminder())
      expect(await service.readReminder('PreToolUse', 'ToDelete')).not.toBeNull()

      await service.deleteReminder('PreToolUse', 'ToDelete')
      expect(await service.readReminder('PreToolUse', 'ToDelete')).toBeNull()
    })

    it('should handle deleting non-existent reminder gracefully', async () => {
      const service = createService(testDir)

      // Should not throw
      await expect(service.deleteReminder('PreToolUse', 'NonExistent')).resolves.toBeUndefined()
    })
  })

  // ==========================================================================
  // Security tests - path traversal prevention
  // ==========================================================================

  describe('path traversal prevention', () => {
    it('should reject hookName with path separators', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('Hook/Nested', 'Reminder', reminder)).rejects.toThrow(
        'Invalid hookName: must be a non-empty alphanumeric string without path separators'
      )
    })

    it('should reject hookName with parent directory reference', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('..', 'Reminder', reminder)).rejects.toThrow(
        'Invalid hookName: must be a non-empty alphanumeric string without path separators'
      )
    })

    it('should reject reminderName with path separators', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('PreToolUse', '../escaped', reminder)).rejects.toThrow(
        'Invalid reminderName: must be a non-empty alphanumeric string without path separators'
      )
    })

    it('should allow hookName starting with dot (isValidPathSegment permits it)', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('.hidden', 'Reminder', reminder)).resolves.not.toThrow()
    })

    it('should reject empty hookName', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('', 'Reminder', reminder)).rejects.toThrow(
        'Invalid hookName: must be a non-empty alphanumeric string without path separators'
      )
    })

    it('should reject backslash in paths (Windows-style)', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('Hook\\Nested', 'Reminder', reminder)).rejects.toThrow(
        'Invalid hookName: must be a non-empty alphanumeric string without path separators'
      )
    })
  })

  describe('edge cases', () => {
    it('should handle special characters in reminder names', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder({ name: 'Special-Reminder_v1.2' })

      await service.stageReminder('PreToolUse', 'Special-Reminder_v1.2', reminder)

      const result = await service.readReminder('PreToolUse', 'Special-Reminder_v1.2')
      expect(result?.name).toBe('Special-Reminder_v1.2')
    })

    it('should preserve all reminder fields through round-trip', async () => {
      const service = createService(testDir)
      const reminder: StagedReminder = {
        name: 'FullReminder',
        blocking: true,
        priority: 75,
        persistent: true,
        userMessage: 'User message with "quotes" and special chars: é, ñ',
        additionalContext: 'Multi\nline\ncontext',
        reason: 'Test stop reason',
      }

      await service.stageReminder('Stop', 'FullReminder', reminder)
      const result = await service.readReminder('Stop', 'FullReminder')

      expect(result).toEqual(reminder)
    })

    it('getStagingRoot should return correct path', () => {
      const service = createService(testDir)

      expect(service.getStagingRoot()).toBe(join(testDir, 'sessions', 'test-session-123', 'stage'))
    })
  })
})

// ============================================================================
// Tests for StagingServiceCore
// ============================================================================

describe('StagingServiceCore', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe('session isolation', () => {
    it('should stage reminders in separate directories per session', async () => {
      const core = createCore(testDir)

      await core.stageReminder('session-a', 'PreToolUse', 'Reminder', createTestReminder({ name: 'A' }))
      await core.stageReminder('session-b', 'PreToolUse', 'Reminder', createTestReminder({ name: 'B' }))

      const reminderA = await core.readReminder('session-a', 'PreToolUse', 'Reminder')
      const reminderB = await core.readReminder('session-b', 'PreToolUse', 'Reminder')

      expect(reminderA?.name).toBe('A')
      expect(reminderB?.name).toBe('B')
    })

    it('should list reminders only from the specified session', async () => {
      const core = createCore(testDir)

      await core.stageReminder('session-a', 'PreToolUse', 'R1', createTestReminder({ name: 'A1' }))
      await core.stageReminder('session-a', 'PreToolUse', 'R2', createTestReminder({ name: 'A2' }))
      await core.stageReminder('session-b', 'PreToolUse', 'R1', createTestReminder({ name: 'B1' }))

      const listA = await core.listReminders('session-a', 'PreToolUse')
      const listB = await core.listReminders('session-b', 'PreToolUse')

      expect(listA).toHaveLength(2)
      expect(listB).toHaveLength(1)
      expect(listA.map((r) => r.name).sort()).toEqual(['A1', 'A2'])
      expect(listB[0].name).toBe('B1')
    })

    it('should clear staging only for the specified session', async () => {
      const core = createCore(testDir)

      await core.stageReminder('session-a', 'PreToolUse', 'Reminder', createTestReminder())
      await core.stageReminder('session-b', 'PreToolUse', 'Reminder', createTestReminder())

      await core.clearStaging('session-a')

      expect(await core.listReminders('session-a', 'PreToolUse')).toEqual([])
      expect(await core.listReminders('session-b', 'PreToolUse')).toHaveLength(1)
    })
  })

  describe('getStagingRoot', () => {
    it('should return correct staging root for a session', () => {
      const core = createCore(testDir)

      expect(core.getStagingRoot('my-session')).toBe(join(testDir, 'sessions', 'my-session', 'stage'))
    })
  })

  describe('ENOENT resilience', () => {
    it('should retry on ENOENT from concurrent clearStaging race', async () => {
      const logger = createMockLogger()
      const realStateService = createStateService(testDir, logger)
      let writeCallCount = 0

      // Mock StateService that fails with ENOENT on first write (simulating
      // a concurrent clearStaging deleting the directory after ensureDir)
      const racingStateService = {
        write: async (...args: Parameters<typeof realStateService.write>) => {
          writeCallCount++
          if (writeCallCount === 1) {
            const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
            err.code = 'ENOENT'
            throw err
          }
          return realStateService.write(...args)
        },
        read: realStateService.read.bind(realStateService),
        delete: realStateService.delete.bind(realStateService),
      }

      const core = createCore(testDir, {
        logger,
        stateService: racingStateService as any,
      })

      const reminder = createTestReminder({ name: 'RetryTest' })
      await core.stageReminder('session-1', 'Stop', 'RetryTest', reminder)

      // Should have retried: first write ENOENT, second write success
      expect(writeCallCount).toBe(2)

      // Verify the reminder was actually staged
      // Use real state service to read the file
      const hookDir = join(testDir, 'sessions', 'session-1', 'stage', 'Stop')
      expect(existsSync(hookDir)).toBe(true)
    })

    it('should propagate non-ENOENT errors without retry', async () => {
      const logger = createMockLogger()
      const realStateService = createStateService(testDir, logger)

      const failingStateService = {
        write: () => {
          const err = new Error('EACCES: permission denied') as NodeJS.ErrnoException
          err.code = 'EACCES'
          return Promise.reject(err)
        },
        read: realStateService.read.bind(realStateService),
        delete: realStateService.delete.bind(realStateService),
      }

      const core = createCore(testDir, {
        logger,
        stateService: failingStateService as any,
      })

      const reminder = createTestReminder({ name: 'PermTest' })
      await expect(core.stageReminder('session-1', 'Stop', 'PermTest', reminder)).rejects.toThrow('EACCES')
    })

    it('should log debug message on ENOENT retry', async () => {
      const logger = createMockLogger()
      const realStateService = createStateService(testDir, logger)
      let writeCallCount = 0

      const racingStateService = {
        write: async (...args: Parameters<typeof realStateService.write>) => {
          writeCallCount++
          if (writeCallCount === 1) {
            const err = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException
            err.code = 'ENOENT'
            throw err
          }
          return realStateService.write(...args)
        },
        read: realStateService.read.bind(realStateService),
        delete: realStateService.delete.bind(realStateService),
      }

      const core = createCore(testDir, {
        logger,
        stateService: racingStateService as any,
      })

      await core.stageReminder('session-1', 'Stop', 'R1', createTestReminder())

      expect(logger.debug).toHaveBeenCalledWith(
        'ENOENT during staging write, retrying after mkdir',
        expect.objectContaining({ sessionId: 'session-1', hookName: 'Stop' })
      )
    })
  })

  describe('async API', () => {
    it('should stage and read reminders', async () => {
      const core = createCore(testDir)
      const reminder = createTestReminder({ name: 'CoreTest', priority: 60 })

      await core.stageReminder('session-1', 'PreToolUse', 'CoreTest', reminder)
      const result = await core.readReminder('session-1', 'PreToolUse', 'CoreTest')

      expect(result).toEqual(reminder)
    })

    it('should delete reminders', async () => {
      const core = createCore(testDir)

      await core.stageReminder('session-1', 'PreToolUse', 'ToDelete', createTestReminder())
      await core.deleteReminder('session-1', 'PreToolUse', 'ToDelete')

      const result = await core.readReminder('session-1', 'PreToolUse', 'ToDelete')
      expect(result).toBeNull()
    })
  })

  describe('path traversal prevention', () => {
    it('should reject sessionId with path traversal in getStagingRoot', () => {
      const core = createCore(testDir)

      // getStagingRoot doesn't validate - it's the caller's responsibility
      // But the methods that use it DO validate hookName and reminderName
      expect(core.getStagingRoot('../escape')).toBe(join(testDir, 'sessions', '../escape', 'stage'))
    })

    it('should reject hookName with path traversal', async () => {
      const core = createCore(testDir)

      await expect(core.stageReminder('session-1', '../escape', 'Reminder', createTestReminder())).rejects.toThrow(
        'Invalid hookName: must be a non-empty alphanumeric string without path separators'
      )
    })

    it('should reject reminderName with path traversal', async () => {
      const core = createCore(testDir)

      await expect(core.stageReminder('session-1', 'PreToolUse', '../escape', createTestReminder())).rejects.toThrow(
        'Invalid reminderName: must be a non-empty alphanumeric string without path separators'
      )
    })
  })

  describe('consumed reminders', () => {
    it('should list consumed reminders for a session', async () => {
      const core = createCore(testDir)

      // Create some consumed reminder files manually
      const hookDir = join(testDir, 'sessions', 'session-1', 'stage', 'PreToolUse')
      mkdirSync(hookDir, { recursive: true })

      const reminder1 = createTestReminder({ name: 'Test' })
      const reminder2 = createTestReminder({ name: 'Test' })

      writeFileSync(join(hookDir, 'Test.1000.json'), JSON.stringify(reminder1), 'utf-8')
      writeFileSync(join(hookDir, 'Test.2000.json'), JSON.stringify(reminder2), 'utf-8')

      const consumed = await core.listConsumedReminders('session-1', 'PreToolUse', 'Test')

      expect(consumed).toHaveLength(2)
      // Should be sorted newest first
      expect(consumed[0]).toEqual(reminder2) // timestamp 2000
      expect(consumed[1]).toEqual(reminder1) // timestamp 1000
    })

    it('should get last consumed reminder', async () => {
      const core = createCore(testDir)

      const hookDir = join(testDir, 'sessions', 'session-1', 'stage', 'PreToolUse')
      mkdirSync(hookDir, { recursive: true })

      const older = createTestReminder({ name: 'Test', priority: 10 })
      const newer = createTestReminder({ name: 'Test', priority: 99 })

      writeFileSync(join(hookDir, 'Test.1000.json'), JSON.stringify(older), 'utf-8')
      writeFileSync(join(hookDir, 'Test.2000.json'), JSON.stringify(newer), 'utf-8')

      const lastConsumed = await core.getLastConsumed('session-1', 'PreToolUse', 'Test')

      expect(lastConsumed?.priority).toBe(99)
    })

    it('should return null for no consumed reminders', async () => {
      const core = createCore(testDir)

      const lastConsumed = await core.getLastConsumed('session-1', 'PreToolUse', 'NonExistent')

      expect(lastConsumed).toBeNull()
    })
  })
})

// ============================================================================
// Tests for SessionScopedStagingService
// ============================================================================

describe('SessionScopedStagingService', () => {
  let testDir: string
  let core: StagingServiceCore

  beforeEach(() => {
    testDir = createTestDir()
    core = createCore(testDir)
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe('delegation to core', () => {
    it('should delegate stageReminder to core with injected sessionId', async () => {
      const wrapper = createSessionScoped(core, 'wrapped-session')
      const reminder = createTestReminder({ name: 'Wrapped' })

      await wrapper.stageReminder('PreToolUse', 'Wrapped', reminder)

      // Verify via core that it was stored in the correct session
      const result = await core.readReminder('wrapped-session', 'PreToolUse', 'Wrapped')
      expect(result?.name).toBe('Wrapped')
    })

    it('should delegate readReminder to core', async () => {
      const wrapper = createSessionScoped(core, 'wrapped-session')
      const reminder = createTestReminder({ name: 'ReadTest' })

      // Stage via core
      await core.stageReminder('wrapped-session', 'PreToolUse', 'ReadTest', reminder)

      // Read via wrapper
      const result = await wrapper.readReminder('PreToolUse', 'ReadTest')
      expect(result?.name).toBe('ReadTest')
    })

    it('should delegate listReminders to core', async () => {
      const wrapper = createSessionScoped(core, 'wrapped-session')

      await core.stageReminder('wrapped-session', 'PreToolUse', 'R1', createTestReminder({ name: 'R1', priority: 80 }))
      await core.stageReminder('wrapped-session', 'PreToolUse', 'R2', createTestReminder({ name: 'R2', priority: 20 }))
      // Different session - should not appear
      await core.stageReminder('other-session', 'PreToolUse', 'R3', createTestReminder({ name: 'R3' }))

      const list = await wrapper.listReminders('PreToolUse')

      expect(list).toHaveLength(2)
      expect(list[0].name).toBe('R1') // higher priority first
      expect(list[1].name).toBe('R2')
    })

    it('should delegate clearStaging to core', async () => {
      const wrapper = createSessionScoped(core, 'wrapped-session')

      await core.stageReminder('wrapped-session', 'PreToolUse', 'Reminder', createTestReminder())
      await core.stageReminder('other-session', 'PreToolUse', 'Reminder', createTestReminder())

      await wrapper.clearStaging('PreToolUse')

      expect(await core.listReminders('wrapped-session', 'PreToolUse')).toEqual([])
      expect(await core.listReminders('other-session', 'PreToolUse')).toHaveLength(1)
    })

    it('should delegate deleteReminder to core', async () => {
      const wrapper = createSessionScoped(core, 'wrapped-session')

      await core.stageReminder('wrapped-session', 'PreToolUse', 'ToDelete', createTestReminder())
      await wrapper.deleteReminder('PreToolUse', 'ToDelete')

      expect(await core.readReminder('wrapped-session', 'PreToolUse', 'ToDelete')).toBeNull()
    })

    it('should delegate listConsumedReminders to core', async () => {
      const wrapper = createSessionScoped(core, 'wrapped-session')

      // Create consumed reminder files
      const hookDir = join(testDir, 'sessions', 'wrapped-session', 'stage', 'PreToolUse')
      mkdirSync(hookDir, { recursive: true })
      writeFileSync(join(hookDir, 'Test.1000.json'), JSON.stringify(createTestReminder({ name: 'Test' })), 'utf-8')

      const consumed = await wrapper.listConsumedReminders('PreToolUse', 'Test')

      expect(consumed).toHaveLength(1)
    })

    it('should delegate getLastConsumed to core', async () => {
      const wrapper = createSessionScoped(core, 'wrapped-session')

      const hookDir = join(testDir, 'sessions', 'wrapped-session', 'stage', 'PreToolUse')
      mkdirSync(hookDir, { recursive: true })
      writeFileSync(
        join(hookDir, 'Test.2000.json'),
        JSON.stringify(createTestReminder({ name: 'Test', priority: 99 })),
        'utf-8'
      )

      const last = await wrapper.getLastConsumed('PreToolUse', 'Test')

      expect(last?.priority).toBe(99)
    })
  })

  describe('getters', () => {
    it('getStagingRoot should return correct path for session', () => {
      const wrapper = createSessionScoped(core, 'wrapped-session')

      expect(wrapper.getStagingRoot()).toBe(join(testDir, 'sessions', 'wrapped-session', 'stage'))
    })

    it('getSessionId should return the session ID', () => {
      const wrapper = createSessionScoped(core, 'my-session-id')

      expect(wrapper.getSessionId()).toBe('my-session-id')
    })
  })

  describe('multiple wrappers share core', () => {
    it('should allow multiple wrappers to use the same core', async () => {
      const wrapper1 = createSessionScoped(core, 'session-1')
      const wrapper2 = createSessionScoped(core, 'session-2')

      await wrapper1.stageReminder('PreToolUse', 'R1', createTestReminder({ name: 'From1' }))
      await wrapper2.stageReminder('PreToolUse', 'R2', createTestReminder({ name: 'From2' }))

      // Each wrapper should only see its own session's data
      const list1 = await wrapper1.listReminders('PreToolUse')
      const list2 = await wrapper2.listReminders('PreToolUse')

      expect(list1).toHaveLength(1)
      expect(list1[0].name).toBe('From1')
      expect(list2).toHaveLength(1)
      expect(list2[0].name).toBe('From2')
    })
  })
})
