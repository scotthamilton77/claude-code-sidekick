/**
 * Tests for StagingServiceImpl
 *
 * Verifies the atomic file staging for the reminder system per Phase 4.4.
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
import { StagingServiceImpl, type StagingServiceOptions } from '../staging-service'

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
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
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

function createService(testDir: string, overrides: Partial<StagingServiceOptions> = {}): StagingServiceImpl {
  return new StagingServiceImpl({
    sessionId: 'test-session-123',
    stateDir: testDir,
    logger: createMockLogger(),
    ...overrides,
  })
}

// ============================================================================
// Tests
// ============================================================================

describe('StagingServiceImpl', () => {
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
          type: 'ReminderStaged',
          source: 'supervisor',
          state: expect.objectContaining({
            reminderName: 'TestReminder',
            hookName: 'UserPromptSubmit',
            priority: 75,
          }),
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
        stopReason: 'Test stop reason',
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
  // Suppression tests
  // ==========================================================================

  describe('suppressHook', () => {
    it('should create .suppressed marker file', async () => {
      const service = createService(testDir)

      await service.suppressHook('Stop')

      const markerPath = join(testDir, 'sessions', 'test-session-123', 'stage', 'Stop', '.suppressed')
      expect(existsSync(markerPath)).toBe(true)
    })

    it('should create hook directory if it does not exist', async () => {
      const service = createService(testDir)

      await service.suppressHook('NewHook')

      const hookDir = join(testDir, 'sessions', 'test-session-123', 'stage', 'NewHook')
      expect(existsSync(hookDir)).toBe(true)
    })
  })

  describe('isHookSuppressed', () => {
    it('should return false for non-suppressed hook', async () => {
      const service = createService(testDir)

      const result = await service.isHookSuppressed('Stop')

      expect(result).toBe(false)
    })

    it('should return true for suppressed hook', async () => {
      const service = createService(testDir)

      await service.suppressHook('Stop')
      const result = await service.isHookSuppressed('Stop')

      expect(result).toBe(true)
    })
  })

  describe('clearSuppression', () => {
    it('should remove .suppressed marker', async () => {
      const service = createService(testDir)

      await service.suppressHook('Stop')
      expect(await service.isHookSuppressed('Stop')).toBe(true)

      await service.clearSuppression('Stop')
      expect(await service.isHookSuppressed('Stop')).toBe(false)
    })

    it('should handle clearing non-existent suppression gracefully', async () => {
      const service = createService(testDir)

      // Should not throw
      await expect(service.clearSuppression('NonSuppressed')).resolves.toBeUndefined()
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
  // Synchronous API tests
  // ==========================================================================

  describe('synchronous API', () => {
    it('stageReminderSync should work correctly', () => {
      const service = createService(testDir)
      const reminder = createTestReminder({ name: 'SyncReminder' })

      service.stageReminderSync('PreToolUse', 'SyncReminder', reminder)

      const reminderPath = join(testDir, 'sessions', 'test-session-123', 'stage', 'PreToolUse', 'SyncReminder.json')
      expect(existsSync(reminderPath)).toBe(true)
    })

    it('clearStagingSync should clear specific hook', () => {
      const service = createService(testDir)

      service.stageReminderSync('PreToolUse', 'Reminder1', createTestReminder())
      service.stageReminderSync('Stop', 'Reminder2', createTestReminder())

      service.clearStagingSync('PreToolUse')

      const preToolDir = join(testDir, 'sessions', 'test-session-123', 'stage', 'PreToolUse')
      const stopDir = join(testDir, 'sessions', 'test-session-123', 'stage', 'Stop')
      expect(existsSync(preToolDir)).toBe(false)
      expect(existsSync(stopDir)).toBe(true)
    })

    it('suppressHookSync should create marker', () => {
      const service = createService(testDir)

      service.suppressHookSync('Stop')

      expect(service.isHookSuppressedSync('Stop')).toBe(true)
    })

    it('clearSuppressionSync should remove marker', () => {
      const service = createService(testDir)

      service.suppressHookSync('Stop')
      service.clearSuppressionSync('Stop')

      expect(service.isHookSuppressedSync('Stop')).toBe(false)
    })

    it('deleteReminderSync should delete reminder', () => {
      const service = createService(testDir)

      service.stageReminderSync('PreToolUse', 'ToDelete', createTestReminder())
      service.deleteReminderSync('PreToolUse', 'ToDelete')

      const reminderPath = join(testDir, 'sessions', 'test-session-123', 'stage', 'PreToolUse', 'ToDelete.json')
      expect(existsSync(reminderPath)).toBe(false)
    })
  })

  // ==========================================================================
  // Edge cases
  // ==========================================================================

  // ==========================================================================
  // Security tests - path traversal prevention
  // ==========================================================================

  describe('path traversal prevention', () => {
    it('should reject hookName with path separators', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('Hook/Nested', 'Reminder', reminder)).rejects.toThrow(
        'Invalid hookName: path traversal characters not allowed'
      )
    })

    it('should reject hookName with parent directory reference', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('..', 'Reminder', reminder)).rejects.toThrow(
        'Invalid hookName: path traversal characters not allowed'
      )
    })

    it('should reject reminderName with path separators', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('PreToolUse', '../escaped', reminder)).rejects.toThrow(
        'Invalid reminderName: path traversal characters not allowed'
      )
    })

    it('should reject hookName starting with dot', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('.hidden', 'Reminder', reminder)).rejects.toThrow(
        "Invalid hookName: cannot start with '.'"
      )
    })

    it('should reject empty hookName', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('', 'Reminder', reminder)).rejects.toThrow('hookName cannot be empty')
    })

    it('should reject backslash in paths (Windows-style)', async () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      await expect(service.stageReminder('Hook\\Nested', 'Reminder', reminder)).rejects.toThrow(
        'Invalid hookName: path traversal characters not allowed'
      )
    })

    it('should reject path traversal in sync methods', () => {
      const service = createService(testDir)
      const reminder = createTestReminder()

      expect(() => service.stageReminderSync('../escape', 'Reminder', reminder)).toThrow(
        'Invalid hookName: path traversal characters not allowed'
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
        stopReason: 'Test stop reason',
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
