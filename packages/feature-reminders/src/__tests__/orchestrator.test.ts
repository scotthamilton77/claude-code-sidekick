/**
 * Tests for ReminderOrchestrator
 *
 * @see docs/plans/2026-01-18-reminder-orchestrator-design.md
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ReminderOrchestrator } from '../orchestrator.js'
import { ReminderIds } from '../types.js'
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
      files.delete(path)
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

// ============================================================================
// Tests
// ============================================================================

describe('ReminderOrchestrator', () => {
  let staging: StagingService
  let getStagingService: (sessionId: string) => StagingService
  let stateService: MinimalStateService
  let logger: Logger
  let orchestrator: ReminderOrchestrator

  beforeEach(() => {
    staging = createMockStagingService()
    getStagingService = vi.fn().mockReturnValue(staging)
    stateService = createMockStateService()
    logger = createMockLogger()
    orchestrator = new ReminderOrchestrator({ getStagingService, stateService, logger })
  })

  describe('onReminderStaged', () => {
    it('Rule 1: unstages all VC reminders when P&R staged', async () => {
      await orchestrator.onReminderStaged({ name: ReminderIds.PAUSE_AND_REFLECT, hook: 'PreToolUse' }, 'session-123')

      expect(getStagingService).toHaveBeenCalledWith('session-123')
      // Should delete wrapper + all per-tool VC reminders
      expect(staging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VERIFY_COMPLETION)
      expect(staging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VC_BUILD)
      expect(staging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VC_TYPECHECK)
      expect(staging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VC_TEST)
      expect(staging.deleteReminder).toHaveBeenCalledWith('Stop', ReminderIds.VC_LINT)
      expect(logger.debug).toHaveBeenCalledWith(
        'VC unstage: P&R cascade complete',
        expect.objectContaining({ sessionId: 'session-123', deletedCount: 5, totalChecked: 5 })
      )
    })

    it('logs reminder:unstaged events via session-scoped child logger', async () => {
      const childLogger = createMockLogger()
      vi.mocked(logger.child).mockReturnValue(childLogger)

      await orchestrator.onReminderStaged({ name: ReminderIds.PAUSE_AND_REFLECT, hook: 'PreToolUse' }, 'session-456')

      expect(logger.child).toHaveBeenCalledWith({ context: { sessionId: 'session-456' } })
      expect(childLogger.info).toHaveBeenCalled()
      expect(logger.info).not.toHaveBeenCalled()
    })

    it('does not unstage VC for other reminders', async () => {
      await orchestrator.onReminderStaged({ name: 'some-other-reminder', hook: 'PreToolUse' }, 'session-123')

      expect(staging.deleteReminder).not.toHaveBeenCalled()
    })

    it('handles errors gracefully', async () => {
      const error = new Error('Delete failed')
      vi.mocked(staging.deleteReminder).mockRejectedValueOnce(error)

      // Should not throw
      await orchestrator.onReminderStaged({ name: ReminderIds.PAUSE_AND_REFLECT, hook: 'PreToolUse' }, 'session-123')

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to unstage VC reminders after P&R staged',
        expect.objectContaining({ error: 'Delete failed' })
      )
    })
  })

  describe('onReminderConsumed', () => {
    it('Rule 3: resets P&R baseline when VC consumed', async () => {
      const metrics = { turnCount: 5, toolsThisTurn: 10, toolCount: 25 }

      await orchestrator.onReminderConsumed(
        { name: ReminderIds.VERIFY_COMPLETION, hook: 'Stop' },
        'session-123',
        metrics
      )

      expect(stateService.write).toHaveBeenCalled()
      const [path, data] = vi.mocked(stateService.write).mock.calls[0]
      expect(path).toBe('/state/sessions/session-123/state/pr-baseline.json')
      expect(data).toMatchObject({
        turnCount: 5,
        toolsThisTurn: 10,
      })
      expect((data as { timestamp: number }).timestamp).toBeGreaterThan(0)
      expect(logger.debug).toHaveBeenCalledWith(
        'Reset P&R baseline after VC consumed',
        expect.objectContaining({ sessionId: 'session-123' })
      )
    })

    it('unstages P&R when VC consumed', async () => {
      const metrics = { turnCount: 5, toolsThisTurn: 10, toolCount: 25 }

      await orchestrator.onReminderConsumed(
        { name: ReminderIds.VERIFY_COMPLETION, hook: 'Stop' },
        'session-123',
        metrics
      )

      expect(getStagingService).toHaveBeenCalledWith('session-123')
      expect(staging.deleteReminder).toHaveBeenCalledWith('PreToolUse', ReminderIds.PAUSE_AND_REFLECT)
      expect(logger.debug).toHaveBeenCalledWith(
        'VC unstage: P&R cascade from VC consumed',
        expect.objectContaining({ sessionId: 'session-123', deleted: true })
      )
    })

    it('logs reminder:unstaged events via session-scoped child logger', async () => {
      const childLogger = createMockLogger()
      vi.mocked(logger.child).mockReturnValue(childLogger)
      const metrics = { turnCount: 5, toolsThisTurn: 10, toolCount: 25 }

      await orchestrator.onReminderConsumed(
        { name: ReminderIds.VERIFY_COMPLETION, hook: 'Stop' },
        'session-789',
        metrics
      )

      expect(logger.child).toHaveBeenCalledWith({ context: { sessionId: 'session-789' } })
      expect(childLogger.info).toHaveBeenCalled()
    })

    it('does not trigger rules for other reminders', async () => {
      const metrics = { turnCount: 5, toolsThisTurn: 10, toolCount: 25 }

      await orchestrator.onReminderConsumed({ name: 'some-other-reminder', hook: 'PreToolUse' }, 'session-123', metrics)

      expect(stateService.write).not.toHaveBeenCalled()
      expect(staging.deleteReminder).not.toHaveBeenCalled()
    })

    it('handles baseline write errors gracefully', async () => {
      const error = new Error('Write failed')
      vi.mocked(stateService.write).mockRejectedValueOnce(error)

      const metrics = { turnCount: 5, toolsThisTurn: 10, toolCount: 25 }

      // Should not throw, and P&R unstage should still execute
      await orchestrator.onReminderConsumed(
        { name: ReminderIds.VERIFY_COMPLETION, hook: 'Stop' },
        'session-123',
        metrics
      )

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to reset P&R baseline after VC consumed',
        expect.objectContaining({ error: 'Write failed' })
      )
      // P&R unstage should still execute
      expect(staging.deleteReminder).toHaveBeenCalled()
    })

    it('handles P&R unstage errors gracefully', async () => {
      const error = new Error('Delete failed')
      vi.mocked(staging.deleteReminder).mockRejectedValueOnce(error)

      const metrics = { turnCount: 5, toolsThisTurn: 10, toolCount: 25 }

      await orchestrator.onReminderConsumed(
        { name: ReminderIds.VERIFY_COMPLETION, hook: 'Stop' },
        'session-123',
        metrics
      )

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to unstage P&R after VC consumed',
        expect.objectContaining({ error: 'Delete failed' })
      )
    })
  })

  describe('onUserPromptSubmit', () => {
    it('clears P&R baseline', async () => {
      await orchestrator.onUserPromptSubmit('session-123')

      expect(stateService.delete).toHaveBeenCalledWith('/state/sessions/session-123/state/pr-baseline.json')
      expect(logger.debug).toHaveBeenCalledWith(
        'Cleared P&R baseline on UserPromptSubmit',
        expect.objectContaining({ sessionId: 'session-123' })
      )
    })

    it('handles errors gracefully', async () => {
      const error = new Error('Delete failed')
      vi.mocked(stateService.delete).mockRejectedValueOnce(error)

      // Should not throw
      await orchestrator.onUserPromptSubmit('session-123')

      expect(logger.warn).toHaveBeenCalledWith(
        'Failed to clear P&R baseline on UserPromptSubmit',
        expect.objectContaining({ error: 'Delete failed' })
      )
    })
  })

  describe('readPRBaseline', () => {
    it('returns baseline data when file exists', async () => {
      vi.mocked(stateService.read).mockResolvedValueOnce({
        data: { turnCount: 5, toolsThisTurn: 10, timestamp: 1234567890 },
        source: 'fresh',
        mtime: 1234567890,
      })

      const result = await orchestrator.readPRBaseline('session-123')

      expect(result).toEqual({
        turnCount: 5,
        toolsThisTurn: 10,
      })
    })

    it('returns null when no baseline exists (default)', async () => {
      vi.mocked(stateService.read).mockResolvedValueOnce({
        data: null,
        source: 'default',
        mtime: 0,
      })

      const result = await orchestrator.readPRBaseline('session-123')

      expect(result).toBeNull()
    })

    it('returns null when data is null even with file source', async () => {
      vi.mocked(stateService.read).mockResolvedValueOnce({
        data: null,
        source: 'fresh',
        mtime: 1234567890,
      })

      const result = await orchestrator.readPRBaseline('session-123')

      expect(result).toBeNull()
    })
  })
})
