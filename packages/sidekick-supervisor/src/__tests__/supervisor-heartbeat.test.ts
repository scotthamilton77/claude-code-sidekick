/**
 * Supervisor Heartbeat Tests
 *
 * Tests the heartbeat mechanism that writes supervisor status to
 * `.sidekick/state/supervisor-status.json` for monitoring UI.
 *
 * @see docs/design/SUPERVISOR.md §4.6
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SupervisorStatus } from '../supervisor.js'

let tmpDir: string

describe('TaskEngine.getStatus()', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-heartbeat-test-'))
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should return correct queue statistics with pending and active tasks', async () => {
    const { TaskEngine } = await import('../task-engine.js')
    const { createConsoleLogger } = await import('@sidekick/core')

    const logger = createConsoleLogger({ minimumLevel: 'error' })
    const engine = new TaskEngine(logger, 1) // Max 1 concurrent task

    // Track when handler is called
    let handlerCalled = false
    const handlerStarted = new Promise<void>((resolve) => {
      engine.registerHandler('slow', async () => {
        handlerCalled = true
        resolve()
        await new Promise((r) => setTimeout(r, 500))
      })
    })

    engine.enqueue('slow', {})
    engine.enqueue('slow', {})

    await handlerStarted
    expect(handlerCalled).toBe(true)

    const status = engine.getStatus()
    expect(status.active).toBe(1)
    expect(status.pending).toBe(1)
    expect(status.activeTasks).toHaveLength(1)
    expect(status.activeTasks[0].type).toBe('slow')

    await engine.shutdown(100)
  })

  it('should return empty stats when idle', async () => {
    const { TaskEngine } = await import('../task-engine.js')
    const { createConsoleLogger } = await import('@sidekick/core')

    const logger = createConsoleLogger({ minimumLevel: 'error' })
    const engine = new TaskEngine(logger)

    const status = engine.getStatus()
    expect(status.pending).toBe(0)
    expect(status.active).toBe(0)
    expect(status.activeTasks).toHaveLength(0)
  })
})

describe('Supervisor heartbeat integration', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-heartbeat-test-'))
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should write heartbeat status file with expected schema', async () => {
    const { Supervisor } = await import('../supervisor.js')
    const supervisor = new Supervisor(tmpDir)

    // Access private members to test heartbeat in isolation without full supervisor startup.
    // Alternative would be integration test that starts full supervisor (socket, signal handlers, etc).
    const sup = supervisor as unknown as {
      stateManager: { initialize(): Promise<void> }
      writeHeartbeat(): Promise<void>
    }
    await sup.stateManager.initialize()
    await sup.writeHeartbeat()

    const statusPath = path.join(tmpDir, '.sidekick', 'state', 'supervisor-status.json')
    const content = await fs.readFile(statusPath, 'utf-8')
    const status = JSON.parse(content) as SupervisorStatus

    expect(status).toMatchObject({
      timestamp: expect.any(Number),
      pid: process.pid,
      version: expect.any(String),
      uptimeSeconds: expect.any(Number),
      memory: {
        heapUsed: expect.any(Number),
        heapTotal: expect.any(Number),
        rss: expect.any(Number),
      },
      queue: { pending: 0, active: 0 },
      activeTasks: [],
    })

    expect(status.memory.heapUsed).toBeGreaterThan(0)
    expect(status.memory.heapUsed).toBeLessThanOrEqual(status.memory.heapTotal)
  })

  it('should calculate uptime from start time', async () => {
    const { Supervisor } = await import('../supervisor.js')
    const supervisor = new Supervisor(tmpDir)

    // Access private members to manipulate startTime for uptime calculation testing.
    const sup = supervisor as unknown as {
      startTime: number
      stateManager: { initialize(): Promise<void> }
      writeHeartbeat(): Promise<void>
    }
    sup.startTime = Date.now() - 10000

    await sup.stateManager.initialize()
    await sup.writeHeartbeat()

    const statusPath = path.join(tmpDir, '.sidekick', 'state', 'supervisor-status.json')
    const content = await fs.readFile(statusPath, 'utf-8')
    const status = JSON.parse(content) as SupervisorStatus

    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(9)
    expect(status.uptimeSeconds).toBeLessThanOrEqual(12)
  })

  it('should handle write errors gracefully', async () => {
    const { Supervisor } = await import('../supervisor.js')
    const supervisor = new Supervisor(tmpDir)

    // Access private writeHeartbeat to verify error handling without full startup.
    // Don't initialize stateManager - writeHeartbeat should catch the error and not throw.
    const sup = supervisor as unknown as { writeHeartbeat(): Promise<void> }
    await expect(sup.writeHeartbeat()).resolves.not.toThrow()
  })
})
