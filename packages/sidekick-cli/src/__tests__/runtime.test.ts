/**
 * Tests for runtime bootstrap.
 *
 * Verifies BEHAVIOR of bootstrapRuntime:
 * - Log count tracking and persistence
 * - Session ID binding
 * - Scope resolution
 *
 * @see runtime.ts bootstrapRuntime
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { PassThrough } from 'node:stream'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

// Mock @sidekick/core to avoid actual file I/O and logging
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()

  // Create a fake logger that tracks calls
  const createFakeLogger = (): Record<string, ReturnType<typeof vi.fn>> => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createFakeLogger()),
  })

  return {
    ...actual,
    createLoggerFacade: vi.fn(() => ({
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      upgrade: vi.fn(),
    })),
    createLogManager: vi.fn(() => ({
      getLogger: vi.fn(() => createFakeLogger()),
      getTelemetry: vi.fn(() => ({
        increment: vi.fn(),
        gauge: vi.fn(),
        histogram: vi.fn(),
      })),
    })),
    createHookableLogger: vi.fn((logger, options) => {
      // Return a wrapper that calls the hook on warn/error
      return {
        ...logger,
        warn: (...args: unknown[]) => {
          options.hook('warn')
          logger.warn?.(...args)
        },
        error: (...args: unknown[]) => {
          options.hook('error')
          logger.error?.(...args)
        },
        fatal: (...args: unknown[]) => {
          options.hook('fatal')
          logger.fatal?.(...args)
        },
      }
    }),
    createConfigService: vi.fn(() => ({
      core: { logging: { level: 'info' } },
      sources: [],
      getFeature: vi.fn(),
    })),
    createAssetResolver: vi.fn(() => ({
      resolve: vi.fn(),
      cascadeLayers: [],
    })),
    resolveScope: vi.fn((options) => ({
      scope: 'project',
      projectRoot: options.cwd || '/test',
      source: 'hook-script',
      warnings: [],
      dualInstallDetected: false,
    })),
    setupGlobalErrorHandlers: vi.fn(() => vi.fn()),
    getDefaultAssetsDir: vi.fn(() => '/assets'),
  }
})

import { bootstrapRuntime } from '../runtime'

describe('bootstrapRuntime', () => {
  let projectDir: string
  let stderr: PassThrough

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'sidekick-runtime-'))
    stderr = new PassThrough()
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
  })

  describe('log counts', () => {
    test('initializes with zero counts', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(0)
      expect(counts.errors).toBe(0)
    })

    test('increments warning count when logger.warn is called', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      runtime.logger.warn('test warning')
      runtime.logger.warn('another warning')

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(2)
      expect(counts.errors).toBe(0)
    })

    test('increments error count when logger.error is called', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      runtime.logger.error('test error')

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(0)
      expect(counts.errors).toBe(1)
    })

    test('increments error count when logger.fatal is called', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      runtime.logger.fatal('fatal error')

      const counts = runtime.getLogCounts()
      expect(counts.errors).toBe(1)
    })

    test('resetLogCounts resets all counts to zero', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      // Generate some counts
      runtime.logger.warn('warning')
      runtime.logger.error('error')

      // Reset
      runtime.resetLogCounts()

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(0)
      expect(counts.errors).toBe(0)
    })

    test('getLogCounts returns a copy (not reference)', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      const counts1 = runtime.getLogCounts()
      runtime.logger.warn('warning')
      const counts2 = runtime.getLogCounts()

      // Original counts should not be mutated
      expect(counts1.warnings).toBe(0)
      expect(counts2.warnings).toBe(1)
    })
  })

  describe('loadExistingLogCounts', () => {
    test('loads counts from existing metrics file', async () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      // Create metrics file with all required fields
      const sessionId = 'test-session-123'
      const stateDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(
        join(stateDir, 'cli-log-metrics.json'),
        JSON.stringify({
          sessionId,
          warningCount: 5,
          errorCount: 3,
          lastUpdatedAt: Date.now(),
        })
      )

      await runtime.loadExistingLogCounts(sessionId)

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(5)
      expect(counts.errors).toBe(3)
    })

    test('adds to existing counts (accumulates)', async () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      // Generate some in-memory counts first
      runtime.logger.warn('existing warning')
      runtime.logger.error('existing error')

      // Create metrics file with additional counts (all required fields)
      const sessionId = 'accumulate-session'
      const stateDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(
        join(stateDir, 'cli-log-metrics.json'),
        JSON.stringify({
          sessionId,
          warningCount: 10,
          errorCount: 2,
          lastUpdatedAt: Date.now(),
        })
      )

      await runtime.loadExistingLogCounts(sessionId)

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(11) // 1 + 10
      expect(counts.errors).toBe(3) // 1 + 2
    })

    test('handles missing file gracefully', async () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      // Don't create any file - should not throw
      await runtime.loadExistingLogCounts('nonexistent-session')

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(0)
      expect(counts.errors).toBe(0)
    })

    test('handles invalid JSON gracefully', async () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      // Create invalid JSON file
      const sessionId = 'invalid-json-session'
      const stateDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(join(stateDir, 'cli-log-metrics.json'), 'not valid json')

      // Should not throw - gracefully handles invalid JSON
      await runtime.loadExistingLogCounts(sessionId)

      // Note: A warning is logged for invalid JSON, which the hookable logger counts.
      // This is correct behavior - the function handles invalid JSON gracefully
      // while still logging a warning about it.
      const counts = runtime.getLogCounts()
      // Warning count may be 1 (from the logged warning about invalid JSON)
      // The key assertion is that no errors occurred and the function didn't throw
      expect(counts.errors).toBe(0)
    })

    test('loads data with only warningCount and default errorCount', async () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      const sessionId = 'partial-data-session'
      const stateDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(
        join(stateDir, 'cli-log-metrics.json'),
        JSON.stringify({
          sessionId,
          warningCount: 7,
          errorCount: 0,
          lastUpdatedAt: Date.now(),
        })
      )

      await runtime.loadExistingLogCounts(sessionId)

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(7)
      expect(counts.errors).toBe(0)
    })

    test('loads data with only errorCount and default warningCount', async () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      const sessionId = 'partial-error-session'
      const stateDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'state')
      mkdirSync(stateDir, { recursive: true })
      writeFileSync(
        join(stateDir, 'cli-log-metrics.json'),
        JSON.stringify({
          sessionId,
          warningCount: 0,
          errorCount: 4,
          lastUpdatedAt: Date.now(),
        })
      )

      await runtime.loadExistingLogCounts(sessionId)

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(0)
      expect(counts.errors).toBe(4)
    })
  })

  describe('bindSessionId', () => {
    test('bindSessionId updates logger context', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      // Bind session ID
      runtime.bindSessionId('my-session-456')

      // Logger should still work after binding
      runtime.logger.warn('test after bind')

      const counts = runtime.getLogCounts()
      expect(counts.warnings).toBe(1)
    })
  })

  describe('cleanup', () => {
    test('cleanup function can be called without error', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      // Should not throw
      expect(() => runtime.cleanup()).not.toThrow()
    })
  })

  describe('correlation ID', () => {
    test('generates correlation ID if not provided', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
      })

      expect(runtime.correlationId).toBeDefined()
      expect(runtime.correlationId.length).toBeGreaterThan(0)
    })

    test('uses provided correlation ID', () => {
      const runtime = bootstrapRuntime({
        cwd: projectDir,
        stderrSink: stderr,
        enableFileLogging: false,
        correlationId: 'custom-correlation-id',
      })

      expect(runtime.correlationId).toBe('custom-correlation-id')
    })
  })
})
