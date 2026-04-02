/**
 * Log Metrics Manager Tests
 *
 * Tests the LogMetricsManager class extracted from Daemon (Step 4).
 * Verifies counting logger, session counters, heartbeat, and persistence.
 *
 * @see docs/design/DAEMON.md §4.6
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { LogMetricsManager, type LogMetricsDeps } from '../daemon-log-metrics.js'
import { StateService } from '@sidekick/core'

let tmpDir: string

function createMockLogManager(): LogMetricsDeps['logManager'] {
  const baseLogger = {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn().mockReturnThis() as any,
  }
  return {
    getLogger: () => baseLogger,
    setLevel: vi.fn(),
  } as unknown as LogMetricsDeps['logManager']
}

function createMockStateService(rootDir: string): StateService {
  return new StateService(rootDir, {
    cache: false,
    logger: {
      trace: () => {},
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      fatal: () => {},
      child: function () {
        return this
      },
    } as any,
    config: () => ({}) as any,
  })
}

function createMockTaskEngine(): LogMetricsDeps['getTaskEngine'] {
  return () => ({
    getStatus: () => ({
      pending: 0,
      active: 0,
      activeTasks: [],
    }),
  })
}

function createDeps(overrides?: Partial<LogMetricsDeps>): LogMetricsDeps {
  return {
    logManager: createMockLogManager(),
    getStateService: () => createMockStateService(tmpDir),
    getTaskEngine: createMockTaskEngine(),
    getStartTime: () => Date.now() - 5000,
    ...overrides,
  }
}

describe('LogMetricsManager', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-log-metrics-test-'))
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await new Promise((r) => setImmediate(r))
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  // ── createCountingLogger ─────────────────────────────────────────────

  describe('createCountingLogger', () => {
    it('should return a usable logger', () => {
      const lm = new LogMetricsManager(createDeps())
      const logger = lm.createCountingLogger()

      expect(logger).toBeDefined()
      expect(typeof logger.info).toBe('function')
      expect(typeof logger.warn).toBe('function')
      expect(typeof logger.error).toBe('function')
    })

    it('should increment session-specific counters on warn/error', () => {
      const lm = new LogMetricsManager(createDeps())
      const logger = lm.createCountingLogger()

      // Register a session
      lm.logCounters.set('sess-1', { warnings: 0, errors: 0 })

      // The hookable logger forwards calls to the base logger, but
      // the hook fires for warn/error/fatal. The hook extracts sessionId
      // from the metadata. Let's verify it through the counters.
      // Since the hook is attached internally, we need to trigger it
      // by calling warn/error with session context.
      logger.warn('test warning', { context: { sessionId: 'sess-1' } })
      logger.error('test error', { context: { sessionId: 'sess-1' } })
      logger.error('another error', { context: { sessionId: 'sess-1' } })

      const counters = lm.logCounters.get('sess-1')!
      expect(counters.warnings).toBe(1)
      expect(counters.errors).toBe(2)
    })

    it('should increment global counters when no sessionId in metadata', () => {
      const lm = new LogMetricsManager(createDeps())
      lm.createCountingLogger()

      // The hook checks metadata for sessionId; without it, increments global counters.
      // Since we're testing through the public interface, we can verify by checking
      // globalLogCounters after triggering the logger.
      // The hookable logger wraps the base logger — calling warn() on it triggers the hook.
      const logger = lm.createCountingLogger()
      logger.warn('daemon warning without session')
      logger.error('daemon error without session')

      expect(lm.globalLogCounters.warnings).toBe(1)
      expect(lm.globalLogCounters.errors).toBe(1)
    })
  })

  // ── Session counter management ─────────────────────────────────────────

  describe('initSessionCounters', () => {
    it('should reset counters to zero when reset=true', async () => {
      const lm = new LogMetricsManager(createDeps())
      lm.createCountingLogger()

      await lm.initSessionCounters('sess-1', true)

      const counters = lm.logCounters.get('sess-1')
      expect(counters).toEqual({ warnings: 0, errors: 0 })
    })

    it('should load from state file when reset=false and file exists', async () => {
      // Write existing metrics file
      const sessionId = 'existing-session'
      const sessionStateDir = path.join(tmpDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(sessionStateDir, { recursive: true })
      await fs.writeFile(
        path.join(sessionStateDir, 'daemon-log-metrics.json'),
        JSON.stringify({
          sessionId,
          warningCount: 7,
          errorCount: 3,
          lastUpdatedAt: Date.now(),
        })
      )

      const stateService = createMockStateService(tmpDir)
      const lm = new LogMetricsManager(createDeps({ getStateService: () => stateService }))
      lm.createCountingLogger()

      await lm.initSessionCounters(sessionId, false)

      const counters = lm.logCounters.get(sessionId)
      expect(counters).toEqual({ warnings: 7, errors: 3 })
    })

    it('should start at zero when reset=false and no file exists', async () => {
      const stateService = createMockStateService(tmpDir)
      const lm = new LogMetricsManager(createDeps({ getStateService: () => stateService }))
      lm.createCountingLogger()

      await lm.initSessionCounters('nonexistent-session', false)

      const counters = lm.logCounters.get('nonexistent-session')
      expect(counters).toEqual({ warnings: 0, errors: 0 })
    })
  })

  describe('deleteSessionCounters', () => {
    it('should remove the session entry', () => {
      const lm = new LogMetricsManager(createDeps())
      lm.logCounters.set('sess-1', { warnings: 5, errors: 2 })

      lm.deleteSessionCounters('sess-1')

      expect(lm.logCounters.has('sess-1')).toBe(false)
    })
  })

  describe('hasSession', () => {
    it('should return true for tracked sessions', () => {
      const lm = new LogMetricsManager(createDeps())
      lm.logCounters.set('sess-1', { warnings: 0, errors: 0 })

      expect(lm.hasSession('sess-1')).toBe(true)
      expect(lm.hasSession('unknown')).toBe(false)
    })
  })

  describe('getActiveSessionIds', () => {
    it('should return all session keys', () => {
      const lm = new LogMetricsManager(createDeps())
      lm.logCounters.set('a', { warnings: 0, errors: 0 })
      lm.logCounters.set('b', { warnings: 1, errors: 0 })

      const ids = lm.getActiveSessionIds()
      expect(ids).toEqual(expect.arrayContaining(['a', 'b']))
      expect(ids).toHaveLength(2)
    })
  })

  // ── Heartbeat & persistence ────────────────────────────────────────────

  describe('writeHeartbeat', () => {
    it('should write DaemonStatus shape to state file', async () => {
      const stateService = createMockStateService(tmpDir)
      const lm = new LogMetricsManager(
        createDeps({
          getStateService: () => stateService,
          getStartTime: () => Date.now() - 10000,
        })
      )
      lm.createCountingLogger()

      await lm.writeHeartbeat()

      const statusPath = path.join(tmpDir, '.sidekick', 'state', 'daemon-status.json')
      const content = await fs.readFile(statusPath, 'utf-8')
      const status = JSON.parse(content)

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
    })
  })

  describe('persistLogMetrics', () => {
    it('should write per-session metrics to state files', async () => {
      const stateService = createMockStateService(tmpDir)
      const lm = new LogMetricsManager(createDeps({ getStateService: () => stateService }))
      lm.createCountingLogger()

      // Set up session counters
      lm.logCounters.set('sess-1', { warnings: 4, errors: 2 })
      const sessionDir = path.join(tmpDir, '.sidekick', 'sessions', 'sess-1', 'state')
      await fs.mkdir(sessionDir, { recursive: true })

      await lm.persistLogMetrics()

      const metricsPath = path.join(sessionDir, 'daemon-log-metrics.json')
      const content = await fs.readFile(metricsPath, 'utf-8')
      const metrics = JSON.parse(content)

      expect(metrics).toMatchObject({
        sessionId: 'sess-1',
        warningCount: 4,
        errorCount: 2,
        lastUpdatedAt: expect.any(Number),
      })
    })

    it('should write global metrics to state file', async () => {
      const stateService = createMockStateService(tmpDir)
      const lm = new LogMetricsManager(createDeps({ getStateService: () => stateService }))
      lm.createCountingLogger()

      // Set up global counters
      lm.globalLogCounters.warnings = 3
      lm.globalLogCounters.errors = 1

      await lm.persistLogMetrics()

      const globalPath = path.join(tmpDir, '.sidekick', 'state', 'daemon-global-log-metrics.json')
      const content = await fs.readFile(globalPath, 'utf-8')
      const metrics = JSON.parse(content)

      expect(metrics).toMatchObject({
        warningCount: 3,
        errorCount: 1,
        lastUpdatedAt: expect.any(Number),
      })
    })
  })

  describe('loadExistingLogCounts', () => {
    it('should return zeros when no file exists', async () => {
      const stateService = createMockStateService(tmpDir)
      const lm = new LogMetricsManager(createDeps({ getStateService: () => stateService }))
      lm.createCountingLogger()

      const result = await lm.loadExistingLogCounts('missing-session')
      expect(result).toEqual({ warnings: 0, errors: 0 })
    })

    it('should return stored values when file exists', async () => {
      const sessionId = 'existing-session'
      const sessionDir = path.join(tmpDir, '.sidekick', 'sessions', sessionId, 'state')
      await fs.mkdir(sessionDir, { recursive: true })
      await fs.writeFile(
        path.join(sessionDir, 'daemon-log-metrics.json'),
        JSON.stringify({
          sessionId,
          warningCount: 10,
          errorCount: 5,
          lastUpdatedAt: Date.now() - 60000,
        })
      )

      const stateService = createMockStateService(tmpDir)
      const lm = new LogMetricsManager(createDeps({ getStateService: () => stateService }))
      lm.createCountingLogger()

      const result = await lm.loadExistingLogCounts(sessionId)
      expect(result).toEqual({ warnings: 10, errors: 5 })
    })
  })
})
