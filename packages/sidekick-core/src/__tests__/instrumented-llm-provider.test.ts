import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMProvider, LLMRequest, LLMResponse, Logger } from '@sidekick/types'
import { InstrumentedLLMProvider } from '../instrumented-llm-provider.js'

// Mock logger
const createMockLogger = (): Logger => ({
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => createMockLogger()),
  flush: vi.fn(),
})

// Mock LLM Provider
const createMockProvider = (
  overrides: Partial<{
    id: string
    complete: (req: LLMRequest) => Promise<LLMResponse>
  }> = {}
): LLMProvider => ({
  id: overrides.id ?? 'test-provider',
  complete:
    overrides.complete ??
    (() =>
      Promise.resolve({
        content: 'test response',
        model: 'test-model',
        usage: { inputTokens: 100, outputTokens: 50 },
        rawResponse: { status: 200, body: '{}' },
      })),
})

describe('InstrumentedLLMProvider', () => {
  let tempDir: string
  let logger: Logger

  beforeEach(() => {
    tempDir = join(tmpdir(), `llm-metrics-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    logger = createMockLogger()
  })

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  describe('initialization', () => {
    it('should create with default metrics', () => {
      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
      })

      const metrics = instrumented.getMetrics()
      expect(metrics.sessionId).toBe('test-session')
      expect(metrics.totals.callCount).toBe(0)
      expect(metrics.byProvider).toEqual({})
    })

    it('should load existing metrics on initialize', () => {
      const existingMetrics = {
        sessionId: 'test-session',
        lastUpdatedAt: Date.now(),
        byProvider: {
          'test-provider': {
            callCount: 5,
            successCount: 4,
            failedCount: 1,
            inputTokens: 500,
            outputTokens: 250,
            latency: { min: 100, max: 500, sum: 1500, count: 4, p50: 200, p90: 400, p95: 450 },
            byModel: {},
          },
        },
        totals: {
          callCount: 5,
          successCount: 4,
          failedCount: 1,
          inputTokens: 500,
          outputTokens: 250,
          totalLatencyMs: 1500,
          averageLatencyMs: 375,
        },
      }

      writeFileSync(join(tempDir, 'llm-metrics.json'), JSON.stringify(existingMetrics))

      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
      })

      instrumented.initialize()

      const metrics = instrumented.getMetrics()
      expect(metrics.totals.callCount).toBe(5)
      expect(metrics.totals.successCount).toBe(4)
    })

    it('should handle invalid metrics file gracefully', () => {
      writeFileSync(join(tempDir, 'llm-metrics.json'), 'invalid json')

      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
      })

      instrumented.initialize()

      const metrics = instrumented.getMetrics()
      expect(metrics.totals.callCount).toBe(0)
      expect(logger.warn).toHaveBeenCalled()
    })
  })

  describe('metrics tracking', () => {
    it('should track successful calls', async () => {
      const provider = createMockProvider({
        complete: () =>
          Promise.resolve({
            content: 'response',
            model: 'gpt-4',
            usage: { inputTokens: 100, outputTokens: 50 },
            rawResponse: { status: 200, body: '{}' },
          }),
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
        persistDebounceMs: 10, // Fast for testing
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })

      const metrics = instrumented.getMetrics()
      expect(metrics.totals.callCount).toBe(1)
      expect(metrics.totals.successCount).toBe(1)
      expect(metrics.totals.failedCount).toBe(0)
      expect(metrics.totals.inputTokens).toBe(100)
      expect(metrics.totals.outputTokens).toBe(50)
      expect(metrics.totals.totalLatencyMs).toBeGreaterThanOrEqual(0)
      expect(metrics.totals.averageLatencyMs).toBeGreaterThanOrEqual(0)
    })

    it('should track failed calls', async () => {
      const provider = createMockProvider({
        complete: () => Promise.reject(new Error('API error')),
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      await expect(instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow(
        'API error'
      )

      const metrics = instrumented.getMetrics()
      expect(metrics.totals.callCount).toBe(1)
      expect(metrics.totals.successCount).toBe(0)
      expect(metrics.totals.failedCount).toBe(1)
    })

    it('should track metrics by provider and model', async () => {
      const provider = createMockProvider({
        id: 'openrouter',
        complete: () =>
          Promise.resolve({
            content: 'response',
            model: 'anthropic/claude-3-opus',
            usage: { inputTokens: 200, outputTokens: 100 },
            rawResponse: { status: 200, body: '{}' },
          }),
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })

      const metrics = instrumented.getMetrics()
      expect(metrics.byProvider['openrouter']).toBeDefined()
      expect(metrics.byProvider['openrouter'].callCount).toBe(1)
      expect(metrics.byProvider['openrouter'].byModel['anthropic/claude-3-opus']).toBeDefined()
      expect(metrics.byProvider['openrouter'].byModel['anthropic/claude-3-opus'].inputTokens).toBe(200)
    })

    it('should track latency min/max/sum', async () => {
      let callCount = 0
      const latencies = [100, 200, 300]

      const provider = createMockProvider({
        complete: async () => {
          // Simulate varying latency
          await new Promise((resolve) => setTimeout(resolve, latencies[callCount++] ?? 100))
          return {
            content: 'response',
            model: 'test-model',
            usage: { inputTokens: 10, outputTokens: 5 },
            rawResponse: { status: 200, body: '{}' },
          }
        },
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test1' }] })
      await instrumented.complete({ messages: [{ role: 'user', content: 'test2' }] })
      await instrumented.complete({ messages: [{ role: 'user', content: 'test3' }] })

      const metrics = instrumented.getMetrics()
      const latencyStats = metrics.byProvider['test-provider'].latency

      expect(latencyStats.count).toBe(3)
      expect(latencyStats.min).toBeGreaterThan(0)
      expect(latencyStats.max).toBeGreaterThanOrEqual(latencyStats.min)
      expect(latencyStats.sum).toBeGreaterThan(0)
    })
  })

  describe('persistence', () => {
    it('should persist metrics to disk after debounce', async () => {
      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
        persistDebounceMs: 50,
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100))

      const filePath = join(tempDir, 'llm-metrics.json')
      expect(existsSync(filePath)).toBe(true)

      const saved = JSON.parse(readFileSync(filePath, 'utf-8'))
      expect(saved.totals.callCount).toBe(1)
    })

    it('should persist immediately on shutdown', async () => {
      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
        persistDebounceMs: 10000, // Long debounce
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })
      instrumented.shutdown()

      const filePath = join(tempDir, 'llm-metrics.json')
      expect(existsSync(filePath)).toBe(true)
    })

    it('should compute percentiles on persist', async () => {
      // Use a provider with artificial delay to ensure measurable latencies
      const provider = createMockProvider({
        complete: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return {
            content: 'response',
            model: 'test-model',
            usage: { inputTokens: 10, outputTokens: 5 },
            rawResponse: { status: 200, body: '{}' },
          }
        },
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      // Make multiple calls to have data for percentiles
      for (let i = 0; i < 10; i++) {
        await instrumented.complete({ messages: [{ role: 'user', content: `test${i}` }] })
      }

      instrumented.shutdown()

      const filePath = join(tempDir, 'llm-metrics.json')
      const saved = JSON.parse(readFileSync(filePath, 'utf-8'))

      const latency = saved.byProvider['test-provider'].latency
      expect(latency.p50).toBeGreaterThan(0)
      expect(latency.p90).toBeGreaterThan(0)
      expect(latency.p95).toBeGreaterThan(0)
    })
  })

  describe('concurrent calls', () => {
    it('should handle concurrent calls correctly', async () => {
      let concurrentCalls = 0
      let maxConcurrent = 0

      const provider = createMockProvider({
        complete: async () => {
          concurrentCalls++
          maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
          await new Promise((resolve) => setTimeout(resolve, 50))
          concurrentCalls--
          return {
            content: 'response',
            model: 'test-model',
            usage: { inputTokens: 10, outputTokens: 5 },
            rawResponse: { status: 200, body: '{}' },
          }
        },
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      // Fire 5 concurrent requests
      await Promise.all([
        instrumented.complete({ messages: [{ role: 'user', content: 'test1' }] }),
        instrumented.complete({ messages: [{ role: 'user', content: 'test2' }] }),
        instrumented.complete({ messages: [{ role: 'user', content: 'test3' }] }),
        instrumented.complete({ messages: [{ role: 'user', content: 'test4' }] }),
        instrumented.complete({ messages: [{ role: 'user', content: 'test5' }] }),
      ])

      const metrics = instrumented.getMetrics()
      expect(metrics.totals.callCount).toBe(5)
      expect(metrics.totals.successCount).toBe(5)
      expect(maxConcurrent).toBeGreaterThan(1) // Verify calls were actually concurrent
    })
  })

  describe('id delegation', () => {
    it('should delegate id to underlying provider', () => {
      const provider = createMockProvider({ id: 'my-custom-provider' })
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateDir: tempDir,
        logger,
      })

      expect(instrumented.id).toBe('my-custom-provider')
    })
  })
})
