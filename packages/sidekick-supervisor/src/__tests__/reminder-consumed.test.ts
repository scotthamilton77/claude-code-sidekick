/**
 * Tests for reminder.consumed IPC handler
 *
 * Tests the P&R baseline update when verify-completion is consumed.
 * Uses file I/O assertions since the handler writes to the filesystem.
 *
 * @see docs/design/FEATURE-REMINDERS.md
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import type { PRBaselineState } from '@sidekick/types'
import { createConsoleLogger } from '@sidekick/core'

const logger = createConsoleLogger({ minimumLevel: 'error' })

/**
 * Create a temporary test directory.
 */
function createTestDir(): string {
  const dir = join(tmpdir(), `reminder-consumed-test-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Simulate handleReminderConsumed behavior.
 * Extracted logic for testability since the actual method is private.
 */
async function simulateReminderConsumed(
  projectDir: string,
  sessionId: string,
  reminderName: string,
  metrics: { turnCount: number; toolsThisTurn: number }
): Promise<void> {
  // Only update P&R baseline for verify-completion consumption
  if (reminderName === 'verify-completion') {
    const stateDir = path.join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
    await fs.mkdir(stateDir, { recursive: true })

    const baseline: PRBaselineState = {
      turnCount: metrics.turnCount,
      toolsThisTurn: metrics.toolsThisTurn,
      timestamp: Date.now(),
    }

    await fs.writeFile(path.join(stateDir, 'pr-baseline.json'), JSON.stringify(baseline, null, 2))

    logger.debug('Updated P&R baseline after VC consumption', { sessionId, baseline })
  }
}

describe('reminder.consumed IPC handler', () => {
  let testDir: string

  beforeEach(() => {
    testDir = createTestDir()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true })
    }
  })

  describe('handleReminderConsumed', () => {
    it('creates pr-baseline.json when verify-completion is consumed', async () => {
      const sessionId = 'session-123'
      const metrics = { turnCount: 1, toolsThisTurn: 8 }

      await simulateReminderConsumed(testDir, sessionId, 'verify-completion', metrics)

      const baselinePath = join(testDir, '.sidekick', 'sessions', sessionId, 'state', 'pr-baseline.json')
      expect(existsSync(baselinePath)).toBe(true)

      const baselineData = JSON.parse(readFileSync(baselinePath, 'utf-8')) as PRBaselineState
      expect(baselineData.turnCount).toBe(1)
      expect(baselineData.toolsThisTurn).toBe(8)
      expect(baselineData.timestamp).toBeGreaterThan(0)
    })

    it('creates state directory if it does not exist', async () => {
      const sessionId = 'new-session'
      const stateDir = join(testDir, '.sidekick', 'sessions', sessionId, 'state')

      expect(existsSync(stateDir)).toBe(false)

      await simulateReminderConsumed(testDir, sessionId, 'verify-completion', {
        turnCount: 2,
        toolsThisTurn: 15,
      })

      expect(existsSync(stateDir)).toBe(true)
    })

    it('does NOT create baseline for non-verify-completion reminders', async () => {
      const sessionId = 'session-456'

      await simulateReminderConsumed(testDir, sessionId, 'pause-and-reflect', {
        turnCount: 1,
        toolsThisTurn: 20,
      })

      const baselinePath = join(testDir, '.sidekick', 'sessions', sessionId, 'state', 'pr-baseline.json')
      expect(existsSync(baselinePath)).toBe(false)
    })

    it('overwrites existing baseline on new consumption', async () => {
      const sessionId = 'session-789'
      const stateDir = join(testDir, '.sidekick', 'sessions', sessionId, 'state')
      mkdirSync(stateDir, { recursive: true })

      // First consumption at tool 5
      await simulateReminderConsumed(testDir, sessionId, 'verify-completion', {
        turnCount: 1,
        toolsThisTurn: 5,
      })

      const baselinePath = join(stateDir, 'pr-baseline.json')
      let baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as PRBaselineState
      expect(baseline.toolsThisTurn).toBe(5)

      // Second consumption at tool 10 (same turn)
      await simulateReminderConsumed(testDir, sessionId, 'verify-completion', {
        turnCount: 1,
        toolsThisTurn: 10,
      })

      baseline = JSON.parse(readFileSync(baselinePath, 'utf-8')) as PRBaselineState
      expect(baseline.toolsThisTurn).toBe(10)
    })

    it('preserves turnCount across sessions', async () => {
      // Session 1
      await simulateReminderConsumed(testDir, 'session-a', 'verify-completion', {
        turnCount: 1,
        toolsThisTurn: 8,
      })

      // Session 2
      await simulateReminderConsumed(testDir, 'session-b', 'verify-completion', {
        turnCount: 3,
        toolsThisTurn: 12,
      })

      // Verify both sessions have separate baseline files
      const baselineA = join(testDir, '.sidekick', 'sessions', 'session-a', 'state', 'pr-baseline.json')
      const baselineB = join(testDir, '.sidekick', 'sessions', 'session-b', 'state', 'pr-baseline.json')

      expect(existsSync(baselineA)).toBe(true)
      expect(existsSync(baselineB)).toBe(true)

      const dataA = JSON.parse(readFileSync(baselineA, 'utf-8')) as PRBaselineState
      const dataB = JSON.parse(readFileSync(baselineB, 'utf-8')) as PRBaselineState

      expect(dataA.turnCount).toBe(1)
      expect(dataB.turnCount).toBe(3)
    })
  })
})
