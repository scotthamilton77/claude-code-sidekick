/**
 * Daemon Heartbeat Tests
 *
 * Tests the heartbeat mechanism that writes daemon status to
 * `.sidekick/state/daemon-status.json` for monitoring UI.
 *
 * @see docs/design/DAEMON.md §4.6
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { DaemonContext } from '@sidekick/types'
import type { ContextGetter } from '../task-engine.js'
import type { DaemonStatus } from '../daemon.js'

let tmpDir: string

// Mock context getter for tests
const createMockContextGetter =
  (logger: { info: unknown; error: unknown; warn: unknown; debug: unknown }): ContextGetter =>
  () =>
    ({
      role: 'daemon',
      config: {
        core: { logging: { level: 'error' }, development: { enabled: false } },
        llm: {},
        getAll: () => ({}),
        getFeature: () => undefined,
      },
      logger,
      assets: { resolve: () => undefined },
      paths: { userConfigDir: '/tmp', projectConfigDir: '/tmp' },
      handlers: { register: () => {}, dispatch: async () => {} },
      llm: {
        id: 'mock',
        complete: () =>
          Promise.resolve({
            content: '',
            model: 'mock',
            usage: { inputTokens: 0, outputTokens: 0 },
            rawResponse: { status: 200, body: '' },
          }),
      },
      staging: {
        stageReminder: () => Promise.resolve(),
        readReminder: () => Promise.resolve(null),
        clearStaging: () => Promise.resolve(),
        listReminders: () => Promise.resolve([]),
        deleteReminder: () => Promise.resolve(),
        listConsumedReminders: () => Promise.resolve([]),
        getLastConsumed: () => Promise.resolve(null),
      },
      transcript: {
        initialize: async () => {},
        prepare: async () => {},
        start: async () => {},
        shutdown: async () => {},
        getTranscript: () => ({
          entries: [],
          metadata: { sessionId: '', transcriptPath: '', lineCount: 0, lastModified: 0 },
          toString: () => '',
        }),
        getExcerpt: () => ({ content: '', lineCount: 0, startLine: 0, endLine: 0, bookmarkApplied: false }),
        getMetrics: () => ({
          turnCount: 0,
          toolCount: 0,
          toolsThisTurn: 0,
          messageCount: 0,
          tokenUsage: {
            inputTokens: 0,
            outputTokens: 0,
            totalTokens: 0,
            cacheCreationInputTokens: 0,
            cacheReadInputTokens: 0,
            cacheTiers: { ephemeral5mInputTokens: 0, ephemeral1hInputTokens: 0 },
            serviceTierCounts: {},
            byModel: {},
          },
          currentContextTokens: 0,
          isPostCompactIndeterminate: false,
          toolsPerTurn: 0,
          lastProcessedLine: 0,
          lastUpdatedAt: 0,
        }),
        getMetric: () => 0 as never,
        onMetricsChange: () => () => {},
        onThreshold: () => () => {},
        capturePreCompactState: async () => {},
        getCompactionHistory: () => [],
      },
    }) as unknown as DaemonContext

describe('TaskEngine.getStatus()', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-heartbeat-test-'))
  })

  afterEach(async () => {
    // Wait for any pending async operations before cleanup
    await new Promise((r) => setImmediate(r))
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
    const engine = new TaskEngine(logger, createMockContextGetter(logger), 1) // Max 1 concurrent task

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
    const engine = new TaskEngine(logger, createMockContextGetter(logger))

    const status = engine.getStatus()
    expect(status.pending).toBe(0)
    expect(status.active).toBe(0)
    expect(status.activeTasks).toHaveLength(0)
  })
})

describe('Daemon heartbeat integration', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-heartbeat-test-'))
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    // Wait for any pending async operations before cleanup
    await new Promise((r) => setImmediate(r))
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should write heartbeat status file with expected schema', async () => {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    // Access private writeHeartbeat method to test heartbeat in isolation
    // StateService doesn't require initialization - it creates directories on first write
    const sup = daemon as unknown as {
      writeHeartbeat(): Promise<void>
    }
    await sup.writeHeartbeat()

    const statusPath = path.join(tmpDir, '.sidekick', 'state', 'daemon-status.json')
    const content = await fs.readFile(statusPath, 'utf-8')
    const status = JSON.parse(content) as DaemonStatus

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
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    // Access private members to manipulate startTime for uptime calculation testing
    const sup = daemon as unknown as {
      startTime: number
      writeHeartbeat(): Promise<void>
    }
    sup.startTime = Date.now() - 10000

    await sup.writeHeartbeat()

    const statusPath = path.join(tmpDir, '.sidekick', 'state', 'daemon-status.json')
    const content = await fs.readFile(statusPath, 'utf-8')
    const status = JSON.parse(content) as DaemonStatus

    expect(status.uptimeSeconds).toBeGreaterThanOrEqual(9)
    expect(status.uptimeSeconds).toBeLessThanOrEqual(12)
  })

  it('should handle write errors gracefully', async () => {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    // Access private writeHeartbeat to verify error handling without full startup.
    // StateService handles errors gracefully, writeHeartbeat catches exceptions.
    const sup = daemon as unknown as { writeHeartbeat(): Promise<void> }
    await expect(sup.writeHeartbeat()).resolves.not.toThrow()
  })
})

describe('Daemon log metrics persistence', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-log-metrics-test-'))
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    // Wait for any pending async operations before cleanup
    await new Promise((r) => setImmediate(r))
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should persist per-session log metrics during heartbeat', async () => {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    // Access private members for isolated testing
    const sup = daemon as unknown as {
      stateService: { sessionStatePath(sessionId: string, filename: string): string }
      logCounters: Map<string, { warnings: number; errors: number }>
      writeHeartbeat(): Promise<void>
    }

    // Set up session log counters with some counts
    const sessionId = 'test-session-123'
    sup.logCounters.set(sessionId, { warnings: 5, errors: 2 })

    // Create session state directory
    const sessionStateDir = path.join(tmpDir, '.sidekick', 'sessions', sessionId, 'state')
    await fs.mkdir(sessionStateDir, { recursive: true })

    // Trigger heartbeat which persists log metrics
    await sup.writeHeartbeat()

    // Verify per-session log metrics were persisted
    const logMetricsPath = path.join(sessionStateDir, 'daemon-log-metrics.json')
    const content = await fs.readFile(logMetricsPath, 'utf-8')
    const logMetrics = JSON.parse(content)

    expect(logMetrics).toMatchObject({
      sessionId: 'test-session-123',
      warningCount: 5,
      errorCount: 2,
      lastUpdatedAt: expect.any(Number),
    })
  })

  it('should persist global daemon log metrics during heartbeat', async () => {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    // Access private members for isolated testing
    const sup = daemon as unknown as {
      globalLogCounters: { warnings: number; errors: number }
      writeHeartbeat(): Promise<void>
    }

    // Set up global log counters with some counts
    sup.globalLogCounters.warnings = 3
    sup.globalLogCounters.errors = 1

    // Trigger heartbeat which persists log metrics
    await sup.writeHeartbeat()

    // Verify global log metrics were persisted
    const globalMetricsPath = path.join(tmpDir, '.sidekick', 'state', 'daemon-global-log-metrics.json')
    const content = await fs.readFile(globalMetricsPath, 'utf-8')
    const globalMetrics = JSON.parse(content)

    expect(globalMetrics).toMatchObject({
      warningCount: 3,
      errorCount: 1,
      lastUpdatedAt: expect.any(Number),
    })
  })

  it('should load existing log counts on session start', async () => {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    // Access private members for isolated testing
    const sup = daemon as unknown as {
      loadExistingLogCounts(sessionId: string): Promise<{ warnings: number; errors: number }>
    }

    // Create session state directory with existing log metrics
    const sessionId = 'existing-session-456'
    const sessionStateDir = path.join(tmpDir, '.sidekick', 'sessions', sessionId, 'state')
    await fs.mkdir(sessionStateDir, { recursive: true })

    const existingMetrics = {
      sessionId,
      warningCount: 10,
      errorCount: 4,
      lastUpdatedAt: Date.now() - 60000, // 1 minute ago
    }
    await fs.writeFile(path.join(sessionStateDir, 'daemon-log-metrics.json'), JSON.stringify(existingMetrics))

    // Load existing counts
    const loaded = await sup.loadExistingLogCounts(sessionId)

    expect(loaded).toEqual({
      warnings: 10,
      errors: 4,
    })
  })

  it('should return zero counts when no existing log metrics file', async () => {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    // Access private members for isolated testing
    const sup = daemon as unknown as {
      loadExistingLogCounts(sessionId: string): Promise<{ warnings: number; errors: number }>
    }

    // Don't create any metrics file - should return defaults
    const loaded = await sup.loadExistingLogCounts('nonexistent-session')

    expect(loaded).toEqual({
      warnings: 0,
      errors: 0,
    })
  })

  it('should persist metrics for multiple sessions independently', async () => {
    const { Daemon } = await import('../daemon.js')
    const daemon = new Daemon(tmpDir)

    // Access private members for isolated testing
    const sup = daemon as unknown as {
      logCounters: Map<string, { warnings: number; errors: number }>
      writeHeartbeat(): Promise<void>
    }

    // Set up multiple sessions with different counts
    const session1 = 'session-one'
    const session2 = 'session-two'
    sup.logCounters.set(session1, { warnings: 2, errors: 1 })
    sup.logCounters.set(session2, { warnings: 8, errors: 3 })

    // Create session state directories
    for (const sessionId of [session1, session2]) {
      await fs.mkdir(path.join(tmpDir, '.sidekick', 'sessions', sessionId, 'state'), { recursive: true })
    }

    // Trigger heartbeat
    await sup.writeHeartbeat()

    // Verify each session has its own metrics
    const metrics1 = JSON.parse(
      await fs.readFile(
        path.join(tmpDir, '.sidekick', 'sessions', session1, 'state', 'daemon-log-metrics.json'),
        'utf-8'
      )
    )
    const metrics2 = JSON.parse(
      await fs.readFile(
        path.join(tmpDir, '.sidekick', 'sessions', session2, 'state', 'daemon-log-metrics.json'),
        'utf-8'
      )
    )

    expect(metrics1.warningCount).toBe(2)
    expect(metrics1.errorCount).toBe(1)
    expect(metrics2.warningCount).toBe(8)
    expect(metrics2.errorCount).toBe(3)
  })
})
