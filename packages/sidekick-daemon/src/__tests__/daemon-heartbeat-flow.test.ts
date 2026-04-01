/**
 * Daemon Heartbeat Flow Safety Net Tests
 *
 * Tests that heartbeat writes produce correct observable state files.
 * writeHeartbeat() will MOVE to LogMetricsManager during extraction,
 * but the CONTRACT being tested (what gets written to disk) is what matters.
 * Updating the type-cast target after extraction is trivial.
 *
 * Strategy: Calls writeHeartbeat directly, verifies daemon-status.json on disk.
 * Skips per-session log metrics tests (logCounters field moves).
 *
 * @see docs/design/DAEMON.md §4.6
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import fs from 'node:fs/promises'
import os from 'node:os'
import type { DaemonStatus } from '@sidekick/types'

let tmpDir: string

describe('Daemon heartbeat flow', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(join(os.tmpdir(), 'heartbeat-flow-test-'))
    await fs.mkdir(join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await new Promise((r) => setImmediate(r))
    if (existsSync(tmpDir)) {
      rmSync(tmpDir, { recursive: true })
    }
  })

  /**
   * Helper to create a Daemon with heartbeat method access.
   */
  async function createTestDaemon(projectDir: string): Promise<{
    daemon: InstanceType<typeof import('../daemon.js').Daemon>
    sup: { writeHeartbeat(): Promise<void> }
  }> {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(projectDir)
    const sup = daemon as unknown as {
      writeHeartbeat(): Promise<void>
    }
    return { daemon, sup }
  }

  it('writeHeartbeat creates daemon-status.json with correct schema', async () => {
    const { sup } = await createTestDaemon(tmpDir)

    await sup.writeHeartbeat()

    const statusPath = join(tmpDir, '.sidekick', 'state', 'daemon-status.json')
    expect(existsSync(statusPath)).toBe(true)

    const content = await fs.readFile(statusPath, 'utf-8')
    const status = JSON.parse(content) as DaemonStatus

    // Verify all required fields exist with correct types
    expect(status).toMatchObject({
      timestamp: expect.any(Number),
      pid: expect.any(Number),
      version: expect.any(String),
      uptimeSeconds: expect.any(Number),
      memory: {
        heapUsed: expect.any(Number),
        heapTotal: expect.any(Number),
        rss: expect.any(Number),
      },
      queue: {
        pending: expect.any(Number),
        active: expect.any(Number),
      },
      activeTasks: expect.any(Array),
    })

    // Sanity checks on values
    expect(status.pid).toBe(process.pid)
    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(0)
    expect(status.memory.heapUsed).toBeGreaterThan(0)
    expect(status.memory.heapUsed).toBeLessThanOrEqual(status.memory.heapTotal)
    expect(status.memory.rss).toBeGreaterThan(0)
  })

  it('writeHeartbeat overwrites the file on subsequent calls', async () => {
    const { sup } = await createTestDaemon(tmpDir)
    const statusPath = join(tmpDir, '.sidekick', 'state', 'daemon-status.json')

    // First heartbeat
    await sup.writeHeartbeat()
    const firstContent = await fs.readFile(statusPath, 'utf-8')
    const firstStatus = JSON.parse(firstContent) as DaemonStatus

    // Small delay to ensure different timestamp
    await new Promise((r) => setTimeout(r, 5))

    // Second heartbeat
    await sup.writeHeartbeat()
    const secondContent = await fs.readFile(statusPath, 'utf-8')
    const secondStatus = JSON.parse(secondContent) as DaemonStatus

    // Timestamp should be updated (overwrite, not append)
    expect(secondStatus.timestamp).toBeGreaterThanOrEqual(firstStatus.timestamp)

    // File should still be valid JSON (not two objects concatenated)
    expect(() => JSON.parse(secondContent)).not.toThrow()
  })

  it('writeHeartbeat does not crash if state directory does not exist', async () => {
    const { sup } = await createTestDaemon(tmpDir)

    // StateService creates directories on first write, so this should succeed
    await expect(sup.writeHeartbeat()).resolves.not.toThrow()

    // Verify the file was created (directory was auto-created)
    const statusPath = join(tmpDir, '.sidekick', 'state', 'daemon-status.json')
    expect(existsSync(statusPath)).toBe(true)
  })
})
