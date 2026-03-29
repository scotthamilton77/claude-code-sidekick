import { mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LLMProvider, LLMRequest, LLMResponse, Logger, MinimalStateService, Telemetry } from '@sidekick/types'
import { LLMMetricsStateSchema, type LLMMetricsState, type StateReadResult } from '@sidekick/types'
import { InstrumentedLLMProvider } from '../instrumented-llm-provider.js'

// Mock logger
const createMockLogger = (): Logger => ({
  trace: vi.fn() as any,
  debug: vi.fn() as any,
  info: vi.fn() as any,
  warn: vi.fn() as any,
  error: vi.fn() as any,
  fatal: vi.fn() as any,
  child: vi.fn(() => createMockLogger()),
  flush: vi.fn() as any,
})

// Mock StateService that stores state in memory
const createMockStateService = (): MinimalStateService & { store: Map<string, unknown> } => {
  const store = new Map<string, unknown>()
  return {
    store,
    read: vi.fn(<T>(path: string, _schema: unknown, defaultValue?: T | (() => T)): Promise<StateReadResult<T>> => {
      if (store.has(path)) {
        return Promise.resolve({ data: store.get(path) as T, source: 'fresh' })
      }
      if (defaultValue !== undefined) {
        const value = typeof defaultValue === 'function' ? (defaultValue as () => T)() : defaultValue
        return Promise.resolve({ data: value, source: 'default' })
      }
      return Promise.reject(new Error(`File not found: ${path}`))
    }) as any,
    write: vi.fn((path: string, data: unknown, _schema: unknown): Promise<void> => {
      store.set(path, data)
      return Promise.resolve()
    }) as any,
    delete: vi.fn((path: string): Promise<void> => {
      store.delete(path)
      return Promise.resolve()
    }) as any,
    sessionStatePath: vi.fn((sessionId: string, filename: string): string => {
      return `/mock/sessions/${sessionId}/state/${filename}`
    }),
    globalStatePath: vi.fn((filename: string): string => {
      return `/mock/state/${filename}`
    }),
    rootDir: vi.fn((): string => '/mock'),
    sessionsDir: vi.fn((): string => '/mock/sessions'),
    sessionRootDir: vi.fn((sessionId: string): string => `/mock/sessions/${sessionId}`),
    logsDir: vi.fn((): string => '/mock/logs'),
  }
}

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
  let stateService: ReturnType<typeof createMockStateService>

  beforeEach(() => {
    tempDir = join(tmpdir(), `llm-metrics-test-${Date.now()}`)
    mkdirSync(tempDir, { recursive: true })
    logger = createMockLogger()
    stateService = createMockStateService()
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
        stateService,
        sessionDir: tempDir,
        logger,
      })

      const metrics = instrumented.getMetrics()
      expect(metrics.sessionId).toBe('test-session')
      expect(metrics.totals.callCount).toBe(0)
      expect(metrics.byProvider).toEqual({})
    })

    it('should load existing metrics on initialize', async () => {
      const existingMetrics: LLMMetricsState = {
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

      // Store in mock StateService
      const statePath = stateService.sessionStatePath('test-session', 'llm-metrics.json')
      stateService.store.set(statePath, existingMetrics)

      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
      })

      await instrumented.initialize()

      const metrics = instrumented.getMetrics()
      expect(metrics.totals.callCount).toBe(5)
      expect(metrics.totals.successCount).toBe(4)
    })

    it('should handle missing metrics file gracefully', async () => {
      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
      })

      // No data stored - should use default
      await instrumented.initialize()

      const metrics = instrumented.getMetrics()
      expect(metrics.totals.callCount).toBe(0)
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
        stateService,
        sessionDir: tempDir,
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
        stateService,
        sessionDir: tempDir,
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
        stateService,
        sessionDir: tempDir,
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
        stateService,
        sessionDir: tempDir,
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
    it('should persist metrics after debounce', async () => {
      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
        persistDebounceMs: 50,
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })

      // Wait for debounce
      await new Promise((resolve) => setTimeout(resolve, 100))

      // Check that StateService.write was called
      expect(stateService.write).toHaveBeenCalled()
      const statePath = stateService.sessionStatePath('test-session', 'llm-metrics.json')
      const saved = stateService.store.get(statePath) as LLMMetricsState
      expect(saved.totals.callCount).toBe(1)
    })

    it('should persist immediately on shutdown', async () => {
      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
        persistDebounceMs: 10000, // Long debounce
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })
      await instrumented.shutdown()

      // Check that StateService.write was called
      expect(stateService.write).toHaveBeenCalled()
      const statePath = stateService.sessionStatePath('test-session', 'llm-metrics.json')
      expect(stateService.store.has(statePath)).toBe(true)
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
        stateService,
        sessionDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      // Make multiple calls to have data for percentiles
      for (let i = 0; i < 10; i++) {
        await instrumented.complete({ messages: [{ role: 'user', content: `test${i}` }] })
      }

      await instrumented.shutdown()

      const statePath = stateService.sessionStatePath('test-session', 'llm-metrics.json')
      const saved = stateService.store.get(statePath) as LLMMetricsState

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
        stateService,
        sessionDir: tempDir,
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
        stateService,
        sessionDir: tempDir,
        logger,
      })

      expect(instrumented.id).toBe('my-custom-provider')
    })
  })

  describe('telemetry emission', () => {
    let mockTelemetry: Telemetry
    let histogramSpy: ReturnType<typeof vi.fn>
    let incrementSpy: ReturnType<typeof vi.fn>

    beforeEach(() => {
      histogramSpy = vi.fn() as any
      incrementSpy = vi.fn() as any
      mockTelemetry = {
        increment: incrementSpy as any,
        gauge: vi.fn() as any,
        histogram: histogramSpy as any,
      }
    })

    it('should emit telemetry on successful completion', async () => {
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
        stateService,
        sessionDir: tempDir,
        logger,
        telemetry: mockTelemetry,
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })

      // Verify duration histogram
      expect(histogramSpy).toHaveBeenCalledWith(
        'llm_request_duration',
        expect.any(Number),
        'ms',
        expect.objectContaining({
          provider: 'test-provider',
          model: 'gpt-4',
          success: 'true',
        })
      )

      // Verify token histograms
      expect(histogramSpy).toHaveBeenCalledWith('llm_input_tokens', 100, 'tokens', {
        provider: 'test-provider',
        model: 'gpt-4',
      })
      expect(histogramSpy).toHaveBeenCalledWith('llm_output_tokens', 50, 'tokens', {
        provider: 'test-provider',
        model: 'gpt-4',
      })

      // No error counter
      expect(incrementSpy).not.toHaveBeenCalled()
    })

    it('should emit telemetry on failure', async () => {
      const provider = createMockProvider({
        complete: () => Promise.reject(new Error('API error')),
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
        telemetry: mockTelemetry,
      })

      await expect(instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow(
        'API error'
      )

      // Verify failure duration histogram
      expect(histogramSpy).toHaveBeenCalledWith(
        'llm_request_duration',
        expect.any(Number),
        'ms',
        expect.objectContaining({
          provider: 'test-provider',
          success: 'false',
        })
      )

      // Verify error counter
      expect(incrementSpy).toHaveBeenCalledWith('llm_request_errors', {
        provider: 'test-provider',
        model: 'unknown',
        error_type: 'Error',
      })
    })

    it('should not emit token metrics when usage is missing', async () => {
      const provider = createMockProvider({
        complete: () =>
          Promise.resolve({
            content: 'response',
            model: 'gpt-4',
            // No usage field
            rawResponse: { status: 200, body: '{}' },
          }),
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
        telemetry: mockTelemetry,
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })

      // Duration should be emitted
      expect(histogramSpy).toHaveBeenCalledWith('llm_request_duration', expect.any(Number), 'ms', expect.any(Object))

      // Token metrics should NOT be emitted
      expect(histogramSpy).not.toHaveBeenCalledWith(
        'llm_input_tokens',
        expect.any(Number),
        'tokens',
        expect.any(Object)
      )
      expect(histogramSpy).not.toHaveBeenCalledWith(
        'llm_output_tokens',
        expect.any(Number),
        'tokens',
        expect.any(Object)
      )
    })

    it('should work without telemetry configured', async () => {
      const provider = createMockProvider()
      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
        // No telemetry
      })

      // Should not throw
      const response = await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })
      expect(response.content).toBe('test response')
    })
  })

  describe('model names with colons', () => {
    it('should correctly track metrics for model names containing colons', async () => {
      const provider = createMockProvider({
        id: 'openrouter',
        complete: () =>
          Promise.resolve({
            content: 'response',
            model: 'anthropic:claude-3:opus',
            usage: { inputTokens: 200, outputTokens: 100 },
            rawResponse: { status: 200, body: '{}' },
          }),
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })
      await instrumented.shutdown()

      const statePath = stateService.sessionStatePath('test-session', 'llm-metrics.json')
      const saved = stateService.store.get(statePath) as LLMMetricsState

      // The model name with colons must be preserved exactly
      expect(saved.byProvider['openrouter']).toBeDefined()
      expect(saved.byProvider['openrouter'].byModel['anthropic:claude-3:opus']).toBeDefined()
      expect(saved.byProvider['openrouter'].byModel['anthropic:claude-3:opus'].callCount).toBe(1)
      expect(saved.byProvider['openrouter'].byModel['anthropic:claude-3:opus'].inputTokens).toBe(200)
    })

    it('should compute correct percentiles for model names containing colons', async () => {
      const provider = createMockProvider({
        id: 'openrouter',
        complete: async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          return {
            content: 'response',
            model: 'anthropic:claude-3:opus',
            usage: { inputTokens: 10, outputTokens: 5 },
            rawResponse: { status: 200, body: '{}' },
          }
        },
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      // Make multiple calls to populate percentile data
      for (let i = 0; i < 5; i++) {
        await instrumented.complete({ messages: [{ role: 'user', content: `test${i}` }] })
      }

      await instrumented.shutdown()

      const statePath = stateService.sessionStatePath('test-session', 'llm-metrics.json')
      const saved = stateService.store.get(statePath) as LLMMetricsState

      // Percentiles must be computed for the colon-containing model
      const modelMetrics = saved.byProvider['openrouter'].byModel['anthropic:claude-3:opus']
      expect(modelMetrics).toBeDefined()
      expect(modelMetrics.latency.p50).toBeGreaterThan(0)
      expect(modelMetrics.latency.p90).toBeGreaterThan(0)
      expect(modelMetrics.latency.p95).toBeGreaterThan(0)

      // Provider-level percentiles must also be correct
      expect(saved.byProvider['openrouter'].latency.p50).toBeGreaterThan(0)
      expect(saved.byProvider['openrouter'].latency.p90).toBeGreaterThan(0)
      expect(saved.byProvider['openrouter'].latency.p95).toBeGreaterThan(0)
    })

    it('should handle normal model names alongside colon-containing names', async () => {
      let callIdx = 0
      const models = ['gpt-4', 'anthropic:claude-3:opus']

      const provider = createMockProvider({
        id: 'multi-provider',
        complete: async () => {
          await new Promise((resolve) => setTimeout(resolve, 5))
          const model = models[callIdx % models.length]
          callIdx++
          return {
            content: 'response',
            model,
            usage: { inputTokens: 10, outputTokens: 5 },
            rawResponse: { status: 200, body: '{}' },
          }
        },
      })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir: tempDir,
        logger,
        persistDebounceMs: 10,
      })

      // Alternate between normal and colon-containing model names
      for (let i = 0; i < 4; i++) {
        await instrumented.complete({ messages: [{ role: 'user', content: `test${i}` }] })
      }

      await instrumented.shutdown()

      const statePath = stateService.sessionStatePath('test-session', 'llm-metrics.json')
      const saved = stateService.store.get(statePath) as LLMMetricsState

      // Both models must be tracked separately and correctly
      const providerMetrics = saved.byProvider['multi-provider']
      expect(providerMetrics.byModel['gpt-4']).toBeDefined()
      expect(providerMetrics.byModel['gpt-4'].callCount).toBe(2)
      expect(providerMetrics.byModel['anthropic:claude-3:opus']).toBeDefined()
      expect(providerMetrics.byModel['anthropic:claude-3:opus'].callCount).toBe(2)

      // Both models should have percentiles computed
      expect(providerMetrics.byModel['gpt-4'].latency.p50).toBeGreaterThan(0)
      expect(providerMetrics.byModel['anthropic:claude-3:opus'].latency.p50).toBeGreaterThan(0)

      // Provider-level should aggregate both
      expect(providerMetrics.callCount).toBe(4)
      expect(providerMetrics.latency.p50).toBeGreaterThan(0)
    })
  })

  describe('debug dump', () => {
    it('writes request and response YAML files when debugDumpEnabled', async () => {
      const { readdirSync } = await import('node:fs')
      const provider = createMockProvider({
        complete: () =>
          Promise.resolve({
            content: 'debug response',
            model: 'test-model',
            usage: { inputTokens: 10, outputTokens: 5 },
            rawResponse: { status: 200, body: '{}' },
          }),
      })

      const sessionDir = join(tempDir, 'debug-session')
      mkdirSync(sessionDir, { recursive: true })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir,
        logger,
        debugDumpEnabled: true,
        profileParams: {
          profileName: 'fast-lite',
          provider: 'openrouter',
          model: 'gemini-flash',
          temperature: 0,
          maxTokens: 1000,
        },
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })

      const debugDir = join(sessionDir, 'llm-debug')
      const files = readdirSync(debugDir)
      expect(files.some((f: string) => f.endsWith('-request.yaml'))).toBe(true)
      expect(files.some((f: string) => f.endsWith('-response.yaml'))).toBe(true)
    })

    it('writes error dump when request fails with debugDumpEnabled', async () => {
      const { readdirSync, readFileSync } = await import('node:fs')
      const provider = createMockProvider({
        complete: () => Promise.reject(new Error('API timeout')),
      })

      const sessionDir = join(tempDir, 'debug-error-session')
      mkdirSync(sessionDir, { recursive: true })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir,
        logger,
        debugDumpEnabled: true,
      })

      await expect(instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })).rejects.toThrow(
        'API timeout'
      )

      const debugDir = join(sessionDir, 'llm-debug')
      const files = readdirSync(debugDir)
      const responseFile = files.find((f: string) => f.endsWith('-response.yaml'))
      expect(responseFile).toBeDefined()

      const content = readFileSync(join(debugDir, responseFile!), 'utf-8')
      expect(content).toContain('API timeout')
    })

    it('does not write debug dumps when debugDumpEnabled is false', async () => {
      const { existsSync } = await import('node:fs')
      const provider = createMockProvider()

      const sessionDir = join(tempDir, 'no-debug-session')
      mkdirSync(sessionDir, { recursive: true })

      const instrumented = new InstrumentedLLMProvider(provider, {
        sessionId: 'test-session',
        stateService,
        sessionDir,
        logger,
        debugDumpEnabled: false,
      })

      await instrumented.complete({ messages: [{ role: 'user', content: 'test' }] })

      expect(existsSync(join(sessionDir, 'llm-debug'))).toBe(false)
    })
  })
})
