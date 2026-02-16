/**
 * Tests for daemon health utility functions.
 *
 * Covers read/write/update with log-once transition semantics.
 *
 * @see daemon-health.ts
 * @see docs/plans/2026-02-16-daemon-health-state-design.md
 */

import * as fs from 'node:fs/promises'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '@sidekick/types'
import { readDaemonHealth, updateDaemonHealth } from '../daemon-health.js'

const TEST_DIR = `/tmp/test-daemon-health-${process.pid}`
const STATE_DIR = join(TEST_DIR, '.sidekick', 'state')
const HEALTH_FILE = join(STATE_DIR, 'daemon-health.json')

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn().mockReturnThis() as any,
    flush: vi.fn() as any,
  } as Logger
}

describe('daemon-health', () => {
  beforeEach(() => {
    mkdirSync(STATE_DIR, { recursive: true })
  })

  afterEach(() => {
    return fs.rm(TEST_DIR, { recursive: true, force: true })
  })

  // ==========================================================================
  // readDaemonHealth
  // ==========================================================================

  describe('readDaemonHealth', () => {
    it('returns unknown when file does not exist', async () => {
      // Remove the state dir so file definitely doesn't exist
      await fs.rm(STATE_DIR, { recursive: true, force: true })

      const health = await readDaemonHealth(TEST_DIR)

      expect(health).toEqual({
        status: 'unknown',
        lastCheckedAt: expect.any(String),
      })
    })

    it('reads existing health file', async () => {
      const healthData = {
        status: 'healthy',
        lastCheckedAt: '2026-02-16T00:00:00.000Z',
      }
      await fs.writeFile(HEALTH_FILE, JSON.stringify(healthData), 'utf-8')

      const health = await readDaemonHealth(TEST_DIR)

      expect(health).toEqual(healthData)
    })

    it('returns unknown on corrupt file', async () => {
      await fs.writeFile(HEALTH_FILE, 'not-valid-json{{{', 'utf-8')

      const health = await readDaemonHealth(TEST_DIR)

      expect(health).toEqual({
        status: 'unknown',
        lastCheckedAt: expect.any(String),
      })
    })
  })

  // ==========================================================================
  // updateDaemonHealth
  // ==========================================================================

  describe('updateDaemonHealth', () => {
    it('writes healthy and logs INFO on unknown->healthy', async () => {
      const logger = createMockLogger()

      const changed = await updateDaemonHealth(TEST_DIR, 'healthy', logger)

      expect(changed).toBe(true)
      expect(logger.info).toHaveBeenCalledWith(
        'Daemon health changed',
        expect.objectContaining({ from: 'unknown', to: 'healthy' })
      )

      // Verify file was written
      const health = await readDaemonHealth(TEST_DIR)
      expect(health.status).toBe('healthy')
    })

    it('writes failed with error and logs ERROR on unknown->failed', async () => {
      const logger = createMockLogger()

      const changed = await updateDaemonHealth(TEST_DIR, 'failed', logger, 'Connection refused')

      expect(changed).toBe(true)
      expect(logger.error).toHaveBeenCalledWith(
        'Daemon health changed: daemon failed to start',
        expect.objectContaining({ from: 'unknown', to: 'failed', error: 'Connection refused' })
      )

      // Verify file was written with error
      const health = await readDaemonHealth(TEST_DIR)
      expect(health.status).toBe('failed')
      expect(health.error).toBe('Connection refused')
    })

    it('does not write or log when healthy->healthy (no change)', async () => {
      const logger = createMockLogger()

      // First: establish healthy state
      await updateDaemonHealth(TEST_DIR, 'healthy', logger)
      vi.mocked(logger.info).mockClear()
      vi.mocked(logger.error).mockClear()

      // Get file mtime before second call
      const statBefore = await fs.stat(HEALTH_FILE)

      // Wait a small amount to ensure mtime would differ if written
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Second: healthy->healthy should be a no-op
      const changed = await updateDaemonHealth(TEST_DIR, 'healthy', logger)

      expect(changed).toBe(false)
      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()

      // Verify file was NOT rewritten (mtime unchanged)
      const statAfter = await fs.stat(HEALTH_FILE)
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs)
    })

    it('does not write or log when failed->failed (no change)', async () => {
      const logger = createMockLogger()

      // First: establish failed state
      await updateDaemonHealth(TEST_DIR, 'failed', logger, 'timeout')
      vi.mocked(logger.info).mockClear()
      vi.mocked(logger.error).mockClear()

      // Wait a small amount to ensure mtime would differ if written
      await new Promise((resolve) => setTimeout(resolve, 50))
      const statBefore = await fs.stat(HEALTH_FILE)

      // Second: failed->failed should be a no-op
      const changed = await updateDaemonHealth(TEST_DIR, 'failed', logger, 'timeout again')

      expect(changed).toBe(false)
      expect(logger.info).not.toHaveBeenCalled()
      expect(logger.error).not.toHaveBeenCalled()

      // Verify file was NOT rewritten (mtime unchanged)
      const statAfter = await fs.stat(HEALTH_FILE)
      expect(statAfter.mtimeMs).toBe(statBefore.mtimeMs)
    })

    it('logs INFO on failed->healthy recovery', async () => {
      const logger = createMockLogger()

      // Establish failed state
      await updateDaemonHealth(TEST_DIR, 'failed', logger, 'timeout')
      vi.mocked(logger.info).mockClear()
      vi.mocked(logger.error).mockClear()

      // Recover: failed->healthy
      const changed = await updateDaemonHealth(TEST_DIR, 'healthy', logger)

      expect(changed).toBe(true)
      expect(logger.info).toHaveBeenCalledWith(
        'Daemon health changed',
        expect.objectContaining({ from: 'failed', to: 'healthy' })
      )
      expect(logger.error).not.toHaveBeenCalled()

      const health = await readDaemonHealth(TEST_DIR)
      expect(health.status).toBe('healthy')
    })

    it('logs ERROR on healthy->failed transition', async () => {
      const logger = createMockLogger()

      // Establish healthy state
      await updateDaemonHealth(TEST_DIR, 'healthy', logger)
      vi.mocked(logger.info).mockClear()
      vi.mocked(logger.error).mockClear()

      // Degrade: healthy->failed
      const changed = await updateDaemonHealth(TEST_DIR, 'failed', logger, 'crashed')

      expect(changed).toBe(true)
      expect(logger.error).toHaveBeenCalledWith(
        'Daemon health changed: daemon failed to start',
        expect.objectContaining({ from: 'healthy', to: 'failed', error: 'crashed' })
      )

      const health = await readDaemonHealth(TEST_DIR)
      expect(health.status).toBe('failed')
      expect(health.error).toBe('crashed')
    })

    it('survives write failure without throwing', async () => {
      const logger = createMockLogger()

      // Make the state dir read-only to cause write failure
      await fs.chmod(STATE_DIR, 0o444)

      try {
        // Remove the health file first so we trigger a write (unknown -> healthy)
        // The write should fail due to read-only dir, but not throw
        const changed = await updateDaemonHealth(TEST_DIR, 'healthy', logger)

        expect(changed).toBe(false)
        expect(logger.warn).toHaveBeenCalledWith(
          expect.stringContaining('Failed to write daemon health'),
          expect.any(Object)
        )
      } finally {
        // Restore permissions so afterEach cleanup works
        await fs.chmod(STATE_DIR, 0o755)
      }
    })
  })
})
