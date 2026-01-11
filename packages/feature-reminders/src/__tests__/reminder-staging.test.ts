/**
 * Tests for reminder staging/consumption functions
 * @see docs/design/FEATURE-REMINDERS.md §3.2
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { stageReminder, consumeReminder } from '../reminder-utils'
import { createMockDaemonContext, MockStagingService, MockLogger } from '@sidekick/testing-fixtures'
import type { StagedReminder, DaemonContext } from '@sidekick/types'

describe('reminder staging/consumption', () => {
  let ctx: DaemonContext
  let staging: MockStagingService
  let logger: MockLogger

  beforeEach(() => {
    staging = new MockStagingService()
    logger = new MockLogger()
    ctx = createMockDaemonContext({ staging, logger })
  })

  describe('stageReminder', () => {
    it('delegates to StagingService.stageReminder', async () => {
      const reminder: StagedReminder = {
        name: 'test-reminder',
        blocking: true,
        priority: 80,
        persistent: false,
      }

      await stageReminder(ctx, 'PreToolUse', reminder)

      const staged = await staging.readReminder('PreToolUse', 'test-reminder')
      expect(staged).toEqual(reminder)
    })

    it('logs staging action', async () => {
      const reminder: StagedReminder = {
        name: 'logged-reminder',
        blocking: false,
        priority: 50,
        persistent: true,
      }

      await stageReminder(ctx, 'Stop', reminder)

      expect(logger.wasLoggedAtLevel('Staged reminder', 'debug')).toBe(true)
      const log = logger.recordedLogs.find((l) => l.msg === 'Staged reminder')
      expect(log?.meta).toMatchObject({
        hookName: 'Stop',
        reminderName: 'logged-reminder',
        priority: 50,
      })
    })
  })

  describe('consumeReminder', () => {
    it('returns null when no reminders staged', async () => {
      const result = await consumeReminder(ctx, 'PreToolUse')
      expect(result).toBeNull()
    })

    it('returns highest priority reminder', async () => {
      await staging.stageReminder('PreToolUse', 'low', {
        name: 'low',
        blocking: false,
        priority: 10,
        persistent: false,
      })
      await staging.stageReminder('PreToolUse', 'high', {
        name: 'high',
        blocking: true,
        priority: 80,
        persistent: false,
      })

      const result = await consumeReminder(ctx, 'PreToolUse')
      expect(result?.name).toBe('high')
    })

    it('deletes non-persistent reminder after consumption', async () => {
      await staging.stageReminder('PreToolUse', 'one-shot', {
        name: 'one-shot',
        blocking: false,
        priority: 50,
        persistent: false,
      })

      await consumeReminder(ctx, 'PreToolUse')

      const remaining = await staging.readReminder('PreToolUse', 'one-shot')
      expect(remaining).toBeNull()
    })

    it('preserves persistent reminder after consumption', async () => {
      await staging.stageReminder('UserPromptSubmit', 'persistent', {
        name: 'persistent',
        blocking: false,
        priority: 10,
        persistent: true,
      })

      await consumeReminder(ctx, 'UserPromptSubmit')

      const remaining = await staging.readReminder('UserPromptSubmit', 'persistent')
      expect(remaining).not.toBeNull()
    })

    it('logs consumption action', async () => {
      await staging.stageReminder('PreToolUse', 'test', {
        name: 'test',
        blocking: true,
        priority: 80,
        persistent: false,
      })

      await consumeReminder(ctx, 'PreToolUse')

      expect(logger.wasLoggedAtLevel('Consumed reminder', 'debug')).toBe(true)
      const log = logger.recordedLogs.find((l) => l.msg === 'Consumed reminder')
      expect(log?.meta).toMatchObject({
        hookName: 'PreToolUse',
        reminderName: 'test',
        persistent: false,
      })
    })
  })
})
