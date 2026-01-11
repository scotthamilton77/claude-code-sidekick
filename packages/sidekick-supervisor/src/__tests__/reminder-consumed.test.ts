/**
 * Tests for reminder.consumed IPC handler
 *
 * Tests the P&R baseline update when verify-completion is consumed.
 * Uses file I/O assertions since the handler writes to the filesystem.
 *
 * IMPORTANT: Tests PRODUCTION handleReminderConsumed via handleIpcRequest,
 * not a re-implemented simulation.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { PRBaselineState } from '@sidekick/types'

let tmpDir: string

describe('reminder.consumed IPC handler', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'reminder-consumed-test-'))
    await fs.mkdir(join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.restoreAllMocks()
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true })
    }
  })

  /**
   * Helper to create a Supervisor and call handleIpcRequest directly.
   * This tests the PRODUCTION code path.
   */
  async function callReminderConsumed(
    projectDir: string,
    params: { sessionId: string; reminderName: string; metrics: { turnCount: number; toolsThisTurn: number } }
  ): Promise<void> {
    const { Supervisor } = await import('../supervisor.js')
    const supervisor = new Supervisor(projectDir)

    // Access private handleIpcRequest to test production code path
    const sup = supervisor as unknown as {
      token: string
      handleIpcRequest(method: string, params: unknown): Promise<unknown>
    }

    // Set token to allow IPC request
    sup.token = 'test-token'

    await sup.handleIpcRequest('reminder.consumed', {
      token: 'test-token',
      ...params,
    })
  }

  describe('handleReminderConsumed', () => {
    it('creates pr-baseline.json when verify-completion is consumed', async () => {
      const sessionId = 'session-123'
      const metrics = { turnCount: 1, toolsThisTurn: 8 }

      await callReminderConsumed(tmpDir, {
        sessionId,
        reminderName: 'verify-completion',
        metrics,
      })

      const baselinePath = join(tmpDir, '.sidekick', 'sessions', sessionId, 'state', 'pr-baseline.json')
      expect(existsSync(baselinePath)).toBe(true)

      const baselineData = JSON.parse(readFileSync(baselinePath, 'utf-8')) as PRBaselineState
      expect(baselineData.turnCount).toBe(1)
      expect(baselineData.toolsThisTurn).toBe(8)
      expect(baselineData.timestamp).toBeGreaterThan(0)
    })

    it('creates state directory if it does not exist', async () => {
      const sessionId = 'new-session'
      const stateDir = join(tmpDir, '.sidekick', 'sessions', sessionId, 'state')

      expect(existsSync(stateDir)).toBe(false)

      await callReminderConsumed(tmpDir, {
        sessionId,
        reminderName: 'verify-completion',
        metrics: { turnCount: 2, toolsThisTurn: 15 },
      })

      expect(existsSync(stateDir)).toBe(true)
    })

    it('does NOT create baseline for non-verify-completion reminders', async () => {
      const sessionId = 'session-456'

      await callReminderConsumed(tmpDir, {
        sessionId,
        reminderName: 'pause-and-reflect',
        metrics: { turnCount: 1, toolsThisTurn: 20 },
      })

      const baselinePath = join(tmpDir, '.sidekick', 'sessions', sessionId, 'state', 'pr-baseline.json')
      expect(existsSync(baselinePath)).toBe(false)
    })

    it('overwrites existing baseline on new consumption', async () => {
      const sessionId = 'session-789'

      // First consumption at tool 5
      await callReminderConsumed(tmpDir, {
        sessionId,
        reminderName: 'verify-completion',
        metrics: { turnCount: 1, toolsThisTurn: 5 },
      })

      const baselinePath = join(tmpDir, '.sidekick', 'sessions', sessionId, 'state', 'pr-baseline.json')
      let baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as PRBaselineState
      expect(baseline.toolsThisTurn).toBe(5)

      // Second consumption at tool 10 (same turn)
      await callReminderConsumed(tmpDir, {
        sessionId,
        reminderName: 'verify-completion',
        metrics: { turnCount: 1, toolsThisTurn: 10 },
      })

      baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as PRBaselineState
      expect(baseline.toolsThisTurn).toBe(10)
    })

    it('preserves turnCount across sessions', async () => {
      // Session 1
      await callReminderConsumed(tmpDir, {
        sessionId: 'session-a',
        reminderName: 'verify-completion',
        metrics: { turnCount: 1, toolsThisTurn: 8 },
      })

      // Session 2
      await callReminderConsumed(tmpDir, {
        sessionId: 'session-b',
        reminderName: 'verify-completion',
        metrics: { turnCount: 3, toolsThisTurn: 12 },
      })

      // Verify both sessions have separate baseline files
      const baselineA = join(tmpDir, '.sidekick', 'sessions', 'session-a', 'state', 'pr-baseline.json')
      const baselineB = join(tmpDir, '.sidekick', 'sessions', 'session-b', 'state', 'pr-baseline.json')

      expect(existsSync(baselineA)).toBe(true)
      expect(existsSync(baselineB)).toBe(true)

      const dataA = JSON.parse(readFileSync(baselineA, 'utf-8')) as PRBaselineState
      const dataB = JSON.parse(readFileSync(baselineB, 'utf-8')) as PRBaselineState

      expect(dataA.turnCount).toBe(1)
      expect(dataB.turnCount).toBe(3)
    })

    it('throws when required parameters are missing', async () => {
      const { Supervisor } = await import('../supervisor.js')
      const supervisor = new Supervisor(tmpDir)

      const sup = supervisor as unknown as {
        token: string
        handleIpcRequest(method: string, params: unknown): Promise<unknown>
      }
      sup.token = 'test-token'

      // Missing sessionId
      await expect(
        sup.handleIpcRequest('reminder.consumed', {
          token: 'test-token',
          reminderName: 'verify-completion',
          metrics: { turnCount: 1, toolsThisTurn: 5 },
        })
      ).rejects.toThrow('reminder.consumed requires sessionId, reminderName, and metrics')

      // Missing reminderName
      await expect(
        sup.handleIpcRequest('reminder.consumed', {
          token: 'test-token',
          sessionId: 'session-123',
          metrics: { turnCount: 1, toolsThisTurn: 5 },
        })
      ).rejects.toThrow('reminder.consumed requires sessionId, reminderName, and metrics')

      // Missing metrics
      await expect(
        sup.handleIpcRequest('reminder.consumed', {
          token: 'test-token',
          sessionId: 'session-123',
          reminderName: 'verify-completion',
        })
      ).rejects.toThrow('reminder.consumed requires sessionId, reminderName, and metrics')
    })
  })
})
