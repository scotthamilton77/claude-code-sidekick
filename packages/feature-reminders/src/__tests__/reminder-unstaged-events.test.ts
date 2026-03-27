/**
 * Tests for reminder:unstaged event emission at deleteReminder() call sites.
 *
 * Verifies that logEvent(ctx.logger, ReminderEvents.reminderUnstaged(...))
 * is called after every deleteReminder() invocation.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReminderOrchestrator } from '../orchestrator.js'
import { ReminderIds, ALL_VC_REMINDER_IDS } from '../types.js'
import type { StagingService, MinimalStateService, Logger } from '@sidekick/types'

// ============================================================================
// Mocks
// ============================================================================

function createMockStagingService(): StagingService {
  return {
    stageReminder: vi.fn().mockResolvedValue(undefined),
    readReminder: vi.fn().mockResolvedValue(null),
    clearStaging: vi.fn().mockResolvedValue(undefined),
    listReminders: vi.fn().mockResolvedValue([]),
    deleteReminder: vi.fn().mockResolvedValue(true),
    listConsumedReminders: vi.fn().mockResolvedValue([]),
    getLastConsumed: vi.fn().mockResolvedValue(null),
  }
}

function createMockStateService(): MinimalStateService {
  const files = new Map<string, unknown>()

  return {
    read: vi.fn().mockImplementation((path: string) => {
      const data = files.get(path)
      return {
        data: data ?? null,
        source: data ? ('fresh' as const) : ('default' as const),
        mtime: Date.now(),
      }
    }),
    write: vi.fn().mockImplementation((path: string, data: unknown) => {
      files.set(path, data)
    }),
    delete: vi.fn().mockImplementation((path: string) => {
      const existed = files.has(path)
      files.delete(path)
      return existed
    }),
    sessionStatePath: vi.fn().mockImplementation((sessionId: string, filename: string) => {
      return `/state/sessions/${sessionId}/state/${filename}`
    }),
    globalStatePath: vi.fn().mockImplementation((filename: string) => `/state/${filename}`),
    rootDir: vi.fn().mockReturnValue('/state'),
    sessionsDir: vi.fn().mockReturnValue('/state/sessions'),
    sessionRootDir: vi.fn().mockImplementation((sessionId: string) => `/state/sessions/${sessionId}`),
    logsDir: vi.fn().mockReturnValue('/state/logs'),
  }
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

/** Extract all reminder:unstaged events from logger.info calls */
function getUnstagedEvents(logger: Logger): Array<{ reminderName: string; hookName: string; reason: string }> {
  const infoCalls = (logger.info as ReturnType<typeof vi.fn>).mock.calls as Array<[string, Record<string, unknown>?]>
  return infoCalls
    .filter((call) => call[1]?.type === 'reminder:unstaged')
    .map((call) => ({
      reminderName: call[1]!.reminderName as string,
      hookName: call[1]!.hookName as string,
      reason: call[1]!.reason as string,
    }))
}

// ============================================================================
// Tests: ReminderOrchestrator emits reminder:unstaged
// ============================================================================

describe('reminder:unstaged events', () => {
  describe('ReminderOrchestrator', () => {
    let staging: StagingService
    let getStagingService: (sessionId: string) => StagingService
    let stateService: MinimalStateService
    let logger: Logger
    let orchestrator: ReminderOrchestrator

    beforeEach(() => {
      staging = createMockStagingService()
      getStagingService = vi.fn().mockReturnValue(staging) as any
      stateService = createMockStateService()
      logger = createMockLogger()
      orchestrator = new ReminderOrchestrator({
        getStagingService,
        stateService,
        logger,
      })
    })

    it('emits reminder:unstaged for each VC reminder when P&R staged (cascade)', async () => {
      await orchestrator.onReminderStaged({ name: ReminderIds.PAUSE_AND_REFLECT, hook: 'PreToolUse' }, 'test-session')

      const events = getUnstagedEvents(logger)
      expect(events.length).toBe(ALL_VC_REMINDER_IDS.length)
      for (const vcId of ALL_VC_REMINDER_IDS) {
        expect(events).toContainEqual({
          reminderName: vcId,
          hookName: 'Stop',
          reason: 'pause_and_reflect_cascade',
        })
      }
    })

    it('emits reminder:unstaged for P&R when VC consumed (cascade)', async () => {
      await orchestrator.onReminderConsumed({ name: ReminderIds.VERIFY_COMPLETION, hook: 'Stop' }, 'test-session', {
        turnCount: 1,
        toolsThisTurn: 1,
        toolCount: 5,
      })

      const events = getUnstagedEvents(logger)
      expect(events).toContainEqual({
        reminderName: ReminderIds.PAUSE_AND_REFLECT,
        hookName: 'PreToolUse',
        reason: 'vc_consumed_cascade',
      })
    })

    it('does not emit reminder:unstaged for non-matching reminders', async () => {
      await orchestrator.onReminderStaged({ name: 'some-other-reminder', hook: 'Stop' }, 'test-session')

      const events = getUnstagedEvents(logger)
      expect(events).toHaveLength(0)
    })
  })

  describe('orchestrator P&R cascade: conditional event emission', () => {
    it('should NOT emit reminder:unstaged when deleteReminder returns false (no file existed)', async () => {
      const staging = createMockStagingService()
      // Mock deleteReminder to return false (file didn't exist)
      ;(staging.deleteReminder as ReturnType<typeof vi.fn>).mockResolvedValue(false)

      const stateService = createMockStateService()
      const logger = createMockLogger()
      const orchestrator = new ReminderOrchestrator({
        getStagingService: vi.fn().mockReturnValue(staging) as any,
        stateService,
        logger,
      })

      // P&R staged triggers cascade unstage of VC reminders
      await orchestrator.onReminderStaged({ name: ReminderIds.PAUSE_AND_REFLECT, hook: 'PreToolUse' }, 'test-session')

      const events = getUnstagedEvents(logger)
      // When deleteReminder returns false, no unstaged events should be emitted
      expect(events).toHaveLength(0)
    })

    it('should emit reminder:unstaged only for reminders that were actually deleted (true)', async () => {
      const staging = createMockStagingService()
      // First call returns true (file existed), rest return false
      const deleteMock = staging.deleteReminder as ReturnType<typeof vi.fn>
      deleteMock
        .mockResolvedValueOnce(true) // verify-completion existed
        .mockResolvedValue(false) // per-tool reminders didn't exist

      const stateService = createMockStateService()
      const logger = createMockLogger()
      const orchestrator = new ReminderOrchestrator({
        getStagingService: vi.fn().mockReturnValue(staging) as any,
        stateService,
        logger,
      })

      await orchestrator.onReminderStaged({ name: ReminderIds.PAUSE_AND_REFLECT, hook: 'PreToolUse' }, 'test-session')

      const events = getUnstagedEvents(logger)
      // Only the first reminder (verify-completion) should have an unstaged event
      expect(events).toHaveLength(1)
      expect(events[0].reminderName).toBe(ReminderIds.VERIFY_COMPLETION)
    })
  })
})
