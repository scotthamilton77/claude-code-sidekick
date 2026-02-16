/**
 * Tests for IPC handlers in feature-reminders
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  handleReminderConsumed,
  handleVCUnverifiedSet,
  handleVCUnverifiedClear,
  type IPCHandlerContext,
} from '../index.js'
import type { MinimalStateService, StateReadResult, VCUnverifiedState } from '@sidekick/types'

interface MockStateService extends MinimalStateService {
  writtenData: Map<string, unknown>
  deletedPaths: string[]
  readResults: Map<string, StateReadResult<unknown>>
}

function createMockStateService(): MockStateService {
  const writtenData = new Map<string, unknown>()
  const deletedPaths: string[] = []
  const readResults = new Map<string, StateReadResult<unknown>>()

  const mockRead = vi.fn((path: string) => {
    const result = readResults.get(path)
    if (result) return Promise.resolve(result)
    return Promise.resolve({ data: null, source: 'default' as const })
  })

  return {
    writtenData,
    deletedPaths,
    readResults,
    sessionStatePath: (sessionId: string, filename: string) =>
      `/mock/.sidekick/sessions/${sessionId}/state/${filename}`,
    globalStatePath: (filename: string) => `/mock/.sidekick/state/${filename}`,
    rootDir: () => '/mock/.sidekick',
    sessionsDir: () => '/mock/.sidekick/sessions',
    sessionRootDir: (sessionId: string) => `/mock/.sidekick/sessions/${sessionId}`,
    logsDir: () => '/mock/.sidekick/logs',
    write: vi.fn((path: string, data: unknown) => {
      writtenData.set(path, data)
      return Promise.resolve()
    }),
    read: mockRead as unknown as MinimalStateService['read'],
    delete: vi.fn((path: string) => {
      deletedPaths.push(path)
      return Promise.resolve()
    }),
  }
}

function createMockLogger(): IPCHandlerContext['logger'] {
  return {
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
  }
}

describe('IPC Handlers', () => {
  let stateService: ReturnType<typeof createMockStateService>
  let logger: ReturnType<typeof createMockLogger>
  let ctx: IPCHandlerContext

  beforeEach(() => {
    stateService = createMockStateService()
    logger = createMockLogger()
    ctx = { stateService, logger }
  })

  describe('handleReminderConsumed', () => {
    it('writes P&R baseline when verify-completion is consumed', async () => {
      await handleReminderConsumed(
        {
          sessionId: 'session-123',
          reminderName: 'verify-completion',
          metrics: { turnCount: 5, toolsThisTurn: 10 },
        },
        ctx
      )

      const expectedPath = '/mock/.sidekick/sessions/session-123/state/pr-baseline.json'
      expect(stateService.writtenData.has(expectedPath)).toBe(true)

      const written = stateService.writtenData.get(expectedPath) as { turnCount: number; toolsThisTurn: number }
      expect(written.turnCount).toBe(5)
      expect(written.toolsThisTurn).toBe(10)
    })

    it('does not write baseline for other reminders', async () => {
      await handleReminderConsumed(
        {
          sessionId: 'session-123',
          reminderName: 'pause-and-reflect',
          metrics: { turnCount: 5, toolsThisTurn: 10 },
        },
        ctx
      )

      expect(stateService.writtenData.size).toBe(0)
    })

    it('logs debug message on baseline update', async () => {
      await handleReminderConsumed(
        {
          sessionId: 'session-123',
          reminderName: 'verify-completion',
          metrics: { turnCount: 5, toolsThisTurn: 10 },
        },
        ctx
      )

      expect(logger.debug).toHaveBeenCalledWith(
        'Updated P&R baseline after VC consumption',
        expect.objectContaining({ sessionId: 'session-123' })
      )
    })
  })

  describe('handleVCUnverifiedSet', () => {
    it('creates unverified state with cycleCount 1 when no existing state', async () => {
      await handleVCUnverifiedSet(
        {
          sessionId: 'session-456',
          classification: { category: 'needs_verification', confidence: 0.9 },
          metrics: { turnCount: 3, toolsThisTurn: 7, toolCount: 15 },
        },
        ctx
      )

      const expectedPath = '/mock/.sidekick/sessions/session-456/state/vc-unverified.json'
      expect(stateService.writtenData.has(expectedPath)).toBe(true)

      const written = stateService.writtenData.get(expectedPath) as VCUnverifiedState
      expect(written.hasUnverifiedChanges).toBe(true)
      expect(written.cycleCount).toBe(1)
      expect(written.lastClassification.category).toBe('needs_verification')
      expect(written.setAt.turnCount).toBe(3)
      expect(written.setAt.toolCount).toBe(15)
    })

    it('increments cycleCount when existing state exists', async () => {
      const existingPath = '/mock/.sidekick/sessions/session-456/state/vc-unverified.json'
      const existingState: VCUnverifiedState = {
        hasUnverifiedChanges: true,
        cycleCount: 2,
        setAt: { timestamp: 1000, turnCount: 1, toolsThisTurn: 5, toolCount: 0 },
        lastClassification: { category: 'old', confidence: 0.5 },
      }
      stateService.readResults.set(existingPath, { data: existingState, source: 'fresh' })

      await handleVCUnverifiedSet(
        {
          sessionId: 'session-456',
          classification: { category: 'needs_verification', confidence: 0.9 },
          metrics: { turnCount: 5, toolsThisTurn: 12, toolCount: 25 },
        },
        ctx
      )

      const written = stateService.writtenData.get(existingPath) as VCUnverifiedState
      expect(written.cycleCount).toBe(3) // incremented from 2
      expect(written.setAt.turnCount).toBe(5)
    })

    it('logs info message with classification details', async () => {
      await handleVCUnverifiedSet(
        {
          sessionId: 'session-456',
          classification: { category: 'test', confidence: 0.8 },
          metrics: { turnCount: 1, toolsThisTurn: 1, toolCount: 5 },
        },
        ctx
      )

      expect(logger.info).toHaveBeenCalledWith(
        'VC unverified state set',
        expect.objectContaining({
          sessionId: 'session-456',
          category: 'test',
          confidence: 0.8,
          cycleCount: 1,
          turnCount: 1,
          toolCount: 5,
        })
      )
    })
  })

  describe('handleVCUnverifiedClear', () => {
    it('deletes the unverified state file', async () => {
      await handleVCUnverifiedClear({ sessionId: 'session-789' }, ctx)

      const expectedPath = '/mock/.sidekick/sessions/session-789/state/vc-unverified.json'
      expect(stateService.deletedPaths).toContain(expectedPath)
    })

    it('logs info message', async () => {
      await handleVCUnverifiedClear({ sessionId: 'session-789' }, ctx)

      expect(logger.info).toHaveBeenCalledWith(
        'VC unverified state cleared',
        expect.objectContaining({ sessionId: 'session-789' })
      )
    })
  })
})
