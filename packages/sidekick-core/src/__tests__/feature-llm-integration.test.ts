/**
 * Feature → LLM Integration Test
 *
 * Phase 4 Final Task: Demonstrates end-to-end wiring of:
 * - FeatureRegistry for feature lifecycle management
 * - RuntimeContext for dependency injection
 * - LLMService with telemetry emission
 *
 * Validates:
 * - Sample feature registered via FeatureRegistry calls LLMService.complete()
 * - MockLLMService returns deterministic canned response
 * - Telemetry events emitted for LLM request (duration, success)
 * - Test runs without real API calls (fully mocked)
 * - Test demonstrates RuntimeContext wiring (config → provider → service → feature)
 *
 * @see docs/ROADMAP.md Phase 4 Final Integration Task
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { FeatureRegistry } from '../feature-registry'
import type { Feature, FeatureManifest } from '../feature-types'
import type { SupervisorContext, RuntimePaths } from '../runtime-context'
import { LLMService } from '@sidekick/shared-providers'
import { ProviderFactory } from '@sidekick/shared-providers'
import type { LLMResponse } from '@sidekick/shared-providers'
import {
  MockLogger,
  MockTelemetry,
  MockConfigService,
  MockAssetResolver,
  MockHandlerRegistry,
  MockStagingService,
  MockTranscriptService,
} from '@sidekick/testing-fixtures'

// Mock ProviderFactory.create() to return our mock provider
vi.spyOn(ProviderFactory.prototype, 'create')

describe('Feature → LLM Integration', () => {
  let mockLogger: MockLogger
  let mockTelemetry: MockTelemetry
  let mockConfig: MockConfigService
  let mockAssets: MockAssetResolver
  let mockProviderComplete: ReturnType<typeof vi.fn>
  let registry: FeatureRegistry

  const mockPaths: RuntimePaths = {
    userConfigDir: '/mock/home/.sidekick',
    projectConfigDir: '/mock/project/.sidekick',
    projectDir: '/mock/project',
  }

  beforeEach(() => {
    vi.clearAllMocks()

    mockLogger = new MockLogger()
    mockTelemetry = new MockTelemetry()
    mockConfig = new MockConfigService()
    mockAssets = new MockAssetResolver()
    registry = new FeatureRegistry()

    // Mock provider complete function - returns canned response
    mockProviderComplete = vi.fn()

    // Mock ProviderFactory to return our mock provider
    vi.mocked(ProviderFactory.prototype.create).mockReturnValue({
      id: 'mock-provider',
      complete: mockProviderComplete,
    })
  })

  /**
   * Create a test feature that calls LLMService during registration.
   * This simulates a real feature (e.g., session-summary) that needs to
   * interact with the LLM during its lifecycle.
   */
  function createLLMFeature(
    id: string,
    options: {
      prompt?: string
      needs?: string[]
      onResponse?: (response: LLMResponse) => void
    } = {}
  ): Feature {
    const manifest: FeatureManifest = {
      id,
      version: '1.0.0',
      description: `Test feature ${id}`,
      needs: options.needs,
    }

    return {
      manifest,
      async register(context) {
        // Features that need LLM access check the role
        if (context.role !== 'supervisor') {
          throw new Error('This feature requires SupervisorContext')
        }
        // Now TypeScript knows context is SupervisorContext
        const prompt = options.prompt ?? `Test prompt from ${id}`
        const response = await context.llm.complete({
          messages: [{ role: 'user', content: prompt }],
        })

        if (options.onResponse) {
          options.onResponse(response)
        }
      },
    }
  }

  describe('RuntimeContext wiring', () => {
    it('should wire config → provider → service → feature correctly', async () => {
      // Setup: Canned LLM response
      const cannedResponse: LLMResponse = {
        content: 'This is a canned LLM response for testing',
        model: 'mock-model',
        usage: { inputTokens: 10, outputTokens: 20 },
        rawResponse: { status: 200, body: '{}' },
      }
      mockProviderComplete.mockResolvedValue(cannedResponse)

      // Create real LLMService with mocked internals
      const llmService = new LLMService(
        {
          provider: 'openai', // Type doesn't matter, factory is mocked
          model: 'test-model',
          apiKey: 'test-key',
        },
        mockLogger,
        mockTelemetry
      )

      // Build SupervisorContext (the central wiring point for LLM access)
      const context: SupervisorContext = {
        role: 'supervisor',
        config: mockConfig,
        logger: mockLogger,
        assets: mockAssets,
        llm: llmService,
        handlers: new MockHandlerRegistry(),
        paths: mockPaths,
        staging: new MockStagingService(),
        transcript: new MockTranscriptService(),
      }

      // Track received response
      let receivedResponse: LLMResponse | undefined

      // Create feature that uses LLM
      const feature = createLLMFeature('test-feature', {
        prompt: 'Summarize this session',
        onResponse: (resp) => {
          receivedResponse = resp
        },
      })

      // Register and validate
      registry.register(feature)
      registry.validateDependencies()

      // Execute feature registration (where LLM call happens)
      await feature.register(context)

      // Verify: Feature received the canned response
      expect(receivedResponse).toBe(cannedResponse)
      expect(receivedResponse?.content).toBe('This is a canned LLM response for testing')

      // Verify: LLM provider was called with correct messages
      expect(mockProviderComplete).toHaveBeenCalledTimes(1)
      expect(mockProviderComplete).toHaveBeenCalledWith({
        messages: [{ role: 'user', content: 'Summarize this session' }],
      })
    })
  })

  describe('Telemetry emission', () => {
    it('should emit telemetry for successful LLM request', async () => {
      const cannedResponse: LLMResponse = {
        content: 'Success response',
        model: 'test-model',
        usage: { inputTokens: 50, outputTokens: 100 },
        rawResponse: { status: 200, body: '{}' },
      }
      mockProviderComplete.mockResolvedValue(cannedResponse)

      const llmService = new LLMService(
        { provider: 'openai', model: 'test-model', apiKey: 'key' },
        mockLogger,
        mockTelemetry
      )

      const context: SupervisorContext = {
        role: 'supervisor',
        config: mockConfig,
        logger: mockLogger,
        assets: mockAssets,
        llm: llmService,
        handlers: new MockHandlerRegistry(),
        paths: mockPaths,
        staging: new MockStagingService(),
        transcript: new MockTranscriptService(),
      }

      const feature = createLLMFeature('telemetry-test')
      registry.register(feature)
      registry.validateDependencies()
      await feature.register(context)

      // Verify: Duration histogram emitted with success=true
      expect(mockTelemetry.wasHistogramRecorded('llm_request_duration', { success: 'true' })).toBe(true)

      // Verify: Token histograms emitted
      expect(mockTelemetry.wasHistogramRecorded('llm_input_tokens')).toBe(true)
      expect(mockTelemetry.wasHistogramRecorded('llm_output_tokens')).toBe(true)

      // Verify: No error counter
      expect(mockTelemetry.wasCounterIncremented('llm_request_errors')).toBe(false)

      // Verify specific values
      const inputTokenMetric = mockTelemetry.getHistogramsByName('llm_input_tokens')[0]
      expect(inputTokenMetric.value).toBe(50)
      expect(inputTokenMetric.unit).toBe('tokens')

      const outputTokenMetric = mockTelemetry.getHistogramsByName('llm_output_tokens')[0]
      expect(outputTokenMetric.value).toBe(100)
    })

    it('should emit telemetry for failed LLM request', async () => {
      const error = new Error('Provider unavailable')
      mockProviderComplete.mockRejectedValue(error)

      const llmService = new LLMService(
        { provider: 'openai', model: 'test-model', apiKey: 'key' },
        mockLogger,
        mockTelemetry
      )

      const context: SupervisorContext = {
        role: 'supervisor',
        config: mockConfig,
        logger: mockLogger,
        assets: mockAssets,
        llm: llmService,
        handlers: new MockHandlerRegistry(),
        paths: mockPaths,
        staging: new MockStagingService(),
        transcript: new MockTranscriptService(),
      }

      const feature = createLLMFeature('error-test')
      registry.register(feature)
      registry.validateDependencies()

      // Feature.register should throw since LLM call fails
      await expect(feature.register(context)).rejects.toThrow('Provider unavailable')

      // Verify: Duration histogram emitted with success=false
      expect(mockTelemetry.wasHistogramRecorded('llm_request_duration', { success: 'false' })).toBe(true)

      // Verify: Error counter incremented
      expect(mockTelemetry.wasCounterIncremented('llm_request_errors', { error_type: 'Error' })).toBe(true)

      // Verify: Logger recorded error
      expect(mockLogger.wasLoggedAtLevel('LLM request failed', 'error')).toBe(true)
    })
  })

  describe('FeatureRegistry integration', () => {
    it('should execute features in dependency order with LLM access', async () => {
      const cannedResponse: LLMResponse = {
        content: 'Response',
        model: 'test-model',
        rawResponse: { status: 200, body: '{}' },
      }
      mockProviderComplete.mockResolvedValue(cannedResponse)

      const llmService = new LLMService(
        { provider: 'openai', model: 'test-model', apiKey: 'key' },
        mockLogger,
        mockTelemetry
      )

      const context: SupervisorContext = {
        role: 'supervisor',
        config: mockConfig,
        logger: mockLogger,
        assets: mockAssets,
        llm: llmService,
        handlers: new MockHandlerRegistry(),
        paths: mockPaths,
        staging: new MockStagingService(),
        transcript: new MockTranscriptService(),
      }

      // Track execution order
      const executionOrder: string[] = []

      // Create features with dependencies
      const baseFeature: Feature = {
        manifest: { id: 'base', version: '1.0.0' },
        register() {
          executionOrder.push('base')
          return Promise.resolve()
        },
      }

      const dependentFeature: Feature = {
        manifest: { id: 'dependent', version: '1.0.0', needs: ['base'] },
        async register(ctx) {
          // This feature uses LLM - narrow to SupervisorContext
          if (ctx.role !== 'supervisor') throw new Error('Requires supervisor')
          await ctx.llm.complete({
            messages: [{ role: 'user', content: 'Generate dependent content' }],
          })
          executionOrder.push('dependent')
        },
      }

      const finalFeature: Feature = {
        manifest: { id: 'final', version: '1.0.0', needs: ['dependent'] },
        register() {
          executionOrder.push('final')
          return Promise.resolve()
        },
      }

      // Register in reverse order to verify topological sort
      registry.register(finalFeature)
      registry.register(baseFeature)
      registry.register(dependentFeature)

      registry.validateDependencies()
      const loadOrder = registry.getLoadOrder()

      // Verify correct load order
      expect(loadOrder.map((f) => f.manifest.id)).toEqual(['base', 'dependent', 'final'])

      // Execute in load order
      for (const feature of loadOrder) {
        await feature.register(context)
      }

      // Verify execution order matches load order
      expect(executionOrder).toEqual(['base', 'dependent', 'final'])

      // Verify LLM was called by dependent feature
      expect(mockProviderComplete).toHaveBeenCalledTimes(1)
      expect(mockProviderComplete).toHaveBeenCalledWith({
        messages: [{ role: 'user', content: 'Generate dependent content' }],
      })
    })
  })

  describe('CLI invocation pattern', () => {
    it('should allow CLI commands to invoke LLM via registry without coupling to providers', async () => {
      /**
       * This test demonstrates the pattern for CLI commands:
       * 1. CLI creates/receives RuntimeContext (with LLMService already configured)
       * 2. CLI looks up feature by ID from registry
       * 3. CLI invokes feature.register() which uses context.llm
       * 4. CLI never needs to know about provider implementations
       */

      const cannedResponse: LLMResponse = {
        content: 'Session summary: User discussed code refactoring',
        model: 'test-model',
        usage: { inputTokens: 200, outputTokens: 50 },
        rawResponse: { status: 200, body: '{}' },
      }
      mockProviderComplete.mockResolvedValue(cannedResponse)

      // --- Bootstrap Phase (done once per CLI invocation) ---

      // LLMService is created from config during bootstrap
      const llmService = new LLMService(
        { provider: 'openai', model: 'gpt-4', apiKey: 'configured-key' },
        mockLogger,
        mockTelemetry
      )

      const context: SupervisorContext = {
        role: 'supervisor',
        config: mockConfig,
        logger: mockLogger,
        assets: mockAssets,
        llm: llmService,
        handlers: new MockHandlerRegistry(),
        paths: mockPaths,
        staging: new MockStagingService(),
        transcript: new MockTranscriptService(),
      }

      // Features are registered during bootstrap
      let summaryResult: string | undefined

      const sessionSummaryFeature: Feature = {
        manifest: {
          id: 'session-summary',
          version: '1.0.0',
          description: 'Generates session summaries via LLM',
        },
        async register(ctx) {
          // Narrow to SupervisorContext for LLM access
          if (ctx.role !== 'supervisor') throw new Error('Requires supervisor')
          const response = await ctx.llm.complete({
            messages: [
              { role: 'system', content: 'You are a session summarizer.' },
              { role: 'user', content: 'Summarize this coding session.' },
            ],
          })
          summaryResult = response.content
        },
      }

      registry.register(sessionSummaryFeature)
      registry.validateDependencies()

      // --- CLI Command Phase ---

      // CLI looks up feature by ID (no provider knowledge needed)
      const feature = registry.get('session-summary')
      expect(feature).toBeDefined()

      // CLI invokes feature with context (decoupled from provider)
      await feature!.register(context)

      // --- Verification ---

      // Feature executed and got LLM response
      expect(summaryResult).toBe('Session summary: User discussed code refactoring')

      // Telemetry was emitted (observable by CLI/supervisor)
      expect(mockTelemetry.histograms.length).toBeGreaterThan(0)

      // Provider was called correctly (but CLI doesn't care about this)
      expect(mockProviderComplete).toHaveBeenCalledWith({
        messages: [
          { role: 'system', content: 'You are a session summarizer.' },
          { role: 'user', content: 'Summarize this coding session.' },
        ],
      })
    })
  })
})
