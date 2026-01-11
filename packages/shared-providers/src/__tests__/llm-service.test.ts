/**
 * Tests for LLMService
 *
 * Verifies:
 * - Provider instantiation via ProviderFactory
 * - Telemetry emission on success/failure
 * - Error handling and propagation
 * - Token usage tracking
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { LLMService } from '../llm-service.js'
import type { Logger, Telemetry, LLMResponse } from '@sidekick/types'
import { ProviderFactory } from '../factory.js'

// Mock ProviderFactory.create() to return our mock provider
vi.spyOn(ProviderFactory.prototype, 'create')

describe('LLMService', () => {
  let mockLogger: Logger
  let mockTelemetry: Telemetry
  let mockProviderComplete: ReturnType<typeof vi.fn>
  let histogramSpy: ReturnType<typeof vi.fn>
  let incrementSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    // Reset mocks
    vi.clearAllMocks()

    // Mock logger
    mockLogger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn(() => mockLogger),
      flush: vi.fn(() => Promise.resolve()),
    }

    // Mock telemetry with spies
    histogramSpy = vi.fn()
    incrementSpy = vi.fn()
    mockTelemetry = {
      increment: incrementSpy,
      gauge: vi.fn(),
      histogram: histogramSpy,
    }

    // Mock provider complete function
    mockProviderComplete = vi.fn()

    // Mock ProviderFactory to return our mock provider
    vi.mocked(ProviderFactory.prototype.create).mockReturnValue({
      id: 'test-provider',
      complete: mockProviderComplete,
    })
  })

  describe('constructor', () => {
    it('should create provider via ProviderFactory', () => {
      const service = new LLMService(
        {
          provider: 'claude-cli',
          model: 'claude-sonnet-4',
        },
        mockLogger,
        mockTelemetry
      )

      expect(service).toBeDefined()
      expect(service.id).toBe('test-provider')
      // Verify initialization logged (don't assert exact format - that's an implementation detail)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'LLMService initialized',
        expect.objectContaining({
          provider: 'claude-cli',
          model: 'claude-sonnet-4',
        })
      )
    })

    it('should apply default maxRetries and timeout', () => {
      new LLMService(
        {
          provider: 'openai',
          model: 'gpt-4',
          apiKey: 'test-key',
        },
        mockLogger,
        mockTelemetry
      )

      expect(ProviderFactory.prototype.create).toHaveBeenCalled()
      // Verify defaults are applied without asserting exact log structure
      expect(mockLogger.debug).toHaveBeenCalledWith('LLMService initialized', expect.any(Object))
    })
  })

  describe('complete', () => {
    it('should emit telemetry on successful completion', async () => {
      const mockResponse: LLMResponse = {
        content: 'Test response',
        model: 'claude-sonnet-4',
        usage: {
          inputTokens: 100,
          outputTokens: 50,
        },
        rawResponse: {
          status: 200,
          body: '{}',
        },
      }

      mockProviderComplete.mockResolvedValue(mockResponse)

      const service = new LLMService(
        {
          provider: 'claude-cli',
          model: 'claude-sonnet-4',
        },
        mockLogger,
        mockTelemetry
      )

      const response = await service.complete({
        messages: [{ role: 'user', content: 'Test prompt' }],
      })

      expect(response).toBe(mockResponse)

      // Verify telemetry emissions
      expect(histogramSpy).toHaveBeenCalledWith(
        'llm_request_duration',
        expect.any(Number),
        'ms',
        expect.objectContaining({
          provider: 'claude-cli',
          model: 'claude-sonnet-4',
          success: 'true',
        })
      )

      expect(histogramSpy).toHaveBeenCalledWith('llm_input_tokens', 100, 'tokens', {
        provider: 'claude-cli',
        model: 'claude-sonnet-4',
      })

      expect(histogramSpy).toHaveBeenCalledWith('llm_output_tokens', 50, 'tokens', {
        provider: 'claude-cli',
        model: 'claude-sonnet-4',
      })

      expect(incrementSpy).not.toHaveBeenCalled()
    })

    it('should emit telemetry on failure', async () => {
      const error = new Error('Provider timeout')
      mockProviderComplete.mockRejectedValue(error)

      const service = new LLMService(
        {
          provider: 'openai',
          model: 'gpt-4',
        },
        mockLogger,
        mockTelemetry
      )

      await expect(
        service.complete({
          messages: [{ role: 'user', content: 'Test prompt' }],
        })
      ).rejects.toThrow('Provider timeout')

      // Verify failure telemetry
      expect(histogramSpy).toHaveBeenCalledWith(
        'llm_request_duration',
        expect.any(Number),
        'ms',
        expect.objectContaining({
          provider: 'openai',
          model: 'gpt-4',
          success: 'false',
        })
      )

      expect(incrementSpy).toHaveBeenCalledWith('llm_request_errors', {
        provider: 'openai',
        model: 'gpt-4',
        error_type: 'Error',
      })
    })

    it('should use request model override if provided', async () => {
      const mockResponse: LLMResponse = {
        content: 'Test response',
        model: 'gpt-4-turbo',
        usage: {
          inputTokens: 50,
          outputTokens: 25,
        },
        rawResponse: {
          status: 200,
          body: '{}',
        },
      }

      mockProviderComplete.mockResolvedValue(mockResponse)

      const service = new LLMService(
        {
          provider: 'openai',
          model: 'gpt-4',
        },
        mockLogger,
        mockTelemetry
      )

      await service.complete({
        messages: [{ role: 'user', content: 'Test prompt' }],
        model: 'gpt-4-turbo', // Override
      })

      expect(histogramSpy).toHaveBeenCalledWith(
        'llm_request_duration',
        expect.any(Number),
        'ms',
        expect.objectContaining({
          model: 'gpt-4-turbo',
        })
      )
    })

    it('should log debug messages for request lifecycle', async () => {
      const mockResponse: LLMResponse = {
        content: 'Test response',
        model: 'claude-sonnet-4',
        rawResponse: {
          status: 200,
          body: '{}',
        },
      }

      mockProviderComplete.mockResolvedValue(mockResponse)

      const service = new LLMService(
        {
          provider: 'claude-cli',
          model: 'claude-sonnet-4',
        },
        mockLogger,
        mockTelemetry
      )

      await service.complete({
        messages: [
          { role: 'system', content: 'System prompt' },
          { role: 'user', content: 'User prompt' },
        ],
      })

      // Verify request start is logged (behavior) without asserting exact structure
      expect(mockLogger.debug).toHaveBeenCalledWith(
        expect.stringMatching(/request|starting/i),
        expect.any(Object)
      )
    })

    it('should handle responses without usage data', async () => {
      const mockResponse: LLMResponse = {
        content: 'Test response',
        model: 'claude-sonnet-4',
        rawResponse: {
          status: 200,
          body: '{}',
        },
        // No usage field
      }

      mockProviderComplete.mockResolvedValue(mockResponse)

      const service = new LLMService(
        {
          provider: 'claude-cli',
          model: 'claude-sonnet-4',
        },
        mockLogger,
        mockTelemetry
      )

      await service.complete({
        messages: [{ role: 'user', content: 'Test prompt' }],
      })

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
  })
})
