/**
 * Tests for ClaudeProvider
 *
 * These tests mock the Anthropic SDK to avoid real API calls (zero cost).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ClaudeProvider } from '../../src/providers/ClaudeProvider.js'
import { LLMErrorType } from '../../src/providers/types.js'
import Anthropic from '@anthropic-ai/sdk'

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk')

describe('ClaudeProvider', () => {
  let mockClient: {
    messages: {
      create: ReturnType<typeof vi.fn>
    }
  }

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()

    // Create mock client
    mockClient = {
      messages: {
        create: vi.fn(),
      },
    }

    // Mock the Anthropic constructor to return our mock client
    vi.mocked(Anthropic).mockImplementation(() => mockClient as unknown as Anthropic)
  })

  afterEach(() => {
    // Clean up environment variables
    delete process.env['ANTHROPIC_API_KEY']
  })

  describe('constructor', () => {
    it('should create provider with API key from environment', () => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key'

      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      expect(provider).toBeDefined()
      expect(provider.getProviderName()).toBe('claude-cli')
      expect(provider.getModelName()).toBe('claude-sonnet-4-20250514')
    })

    it('should create provider with API key from config', () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-3-5-haiku-20241022',
        options: {
          apiKey: 'config-key',
        },
      })

      expect(provider).toBeDefined()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const anthropicCall = vi.mocked(Anthropic).mock.calls[0]?.[0]
      expect(anthropicCall).toMatchObject({
        apiKey: 'config-key',
        maxRetries: 0,
      })
    })

    it('should throw error if API key is missing', () => {
      expect(() => {
        new ClaudeProvider({
          type: 'claude-cli',
          model: 'claude-sonnet-4-20250514',
        })
      }).toThrow(/API key not found/)
    })
  })

  describe('invoke', () => {
    beforeEach(() => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key'
    })

    it('should successfully invoke Claude and return response', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      // Mock successful response
      const mockMessage = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: 'Hello, world!',
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 5,
        },
      }

      mockClient.messages.create.mockResolvedValue(mockMessage)

      const response = await provider.invoke('Test prompt')

      // Verify API call
      expect(mockClient.messages.create).toHaveBeenCalledWith(
        {
          model: 'claude-sonnet-4-20250514',
          max_tokens: 4096,
          messages: [
            {
              role: 'user',
              content: 'Test prompt',
            },
          ],
        },
        expect.objectContaining({
          timeout: 30000, // Default 30 seconds
          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          signal: expect.any(AbortSignal),
        })
      )

      // Verify response structure
      expect(response.content).toBe('Hello, world!')
      expect(response.metadata.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
      expect(response.metadata.wallTimeMs).toBeGreaterThanOrEqual(0)
      expect(response.metadata.costUsd).toBeGreaterThan(0)
      expect(response.metadata.providerMetadata?.['messageId']).toBe('msg_123')
    })

    it('should handle custom timeout', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
        timeout: 60, // 60 seconds
      })

      mockClient.messages.create.mockResolvedValue({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      })

      await provider.invoke('Test', { timeout: 60 })

      expect(mockClient.messages.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          timeout: 60000, // 60 seconds in ms
        })
      )
    })

    it('should handle multiple text blocks in response', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      mockClient.messages.create.mockResolvedValue({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          { type: 'text', text: 'Part 1' },
          { type: 'text', text: 'Part 2' },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      })

      const response = await provider.invoke('Test')

      expect(response.content).toBe('Part 1\nPart 2')
    })

    it('should calculate cost correctly for Sonnet 4', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      mockClient.messages.create.mockResolvedValue({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 500 },
      })

      const response = await provider.invoke('Test')

      // Sonnet 4: $3/M input, $15/M output
      // (1000/1M * 3) + (500/1M * 15) = 0.003 + 0.0075 = 0.0105
      expect(response.metadata.costUsd).toBeCloseTo(0.0105, 4)
    })

    it('should calculate cost correctly for Haiku', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-3-5-haiku-20241022',
      })

      mockClient.messages.create.mockResolvedValue({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Response' }],
        model: 'claude-3-5-haiku-20241022',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 1000, output_tokens: 500 },
      })

      const response = await provider.invoke('Test')

      // Haiku 3.5: $0.8/M input, $4/M output
      // (1000/1M * 0.8) + (500/1M * 4) = 0.0008 + 0.002 = 0.0028
      expect(response.metadata.costUsd).toBeCloseTo(0.0028, 4)
    })
  })

  describe('error handling', () => {
    beforeEach(() => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key'
    })

    it('should handle timeout errors', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      // Mock timeout error
      const timeoutError = new Anthropic.APIConnectionTimeoutError({
        message: 'Request timed out',
      })
      mockClient.messages.create.mockRejectedValue(timeoutError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.TIMEOUT,
      })
    })

    it('should handle rate limit errors', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      // Mock rate limit error
      const rateLimitError = new Anthropic.RateLimitError(
        429,
        new Headers(),
        'Rate limit exceeded',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        {} as any
      )
      mockClient.messages.create.mockRejectedValue(rateLimitError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.API_ERROR,
      })
    })

    it('should handle API errors', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      // Mock API error
      const apiError = new Anthropic.APIError(
        500,
        new Headers(),
        'Internal server error',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any
      )
      mockClient.messages.create.mockRejectedValue(apiError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.API_ERROR,
      })
    })

    it('should handle network errors', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      // Mock network error
      const networkError = new TypeError('fetch failed')
      mockClient.messages.create.mockRejectedValue(networkError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.NETWORK_ERROR,
      })
    })

    it('should handle unknown errors', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      // Mock unknown error
      const unknownError = new Error('Something went wrong')
      mockClient.messages.create.mockRejectedValue(unknownError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.UNKNOWN,
      })
    })
  })

  describe('retry logic', () => {
    beforeEach(() => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key'
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should retry on timeout and succeed', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      const timeoutError = new Anthropic.APIConnectionTimeoutError({
        message: 'Request timed out',
      })

      const successResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Success after retry' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }

      // Fail first, succeed second
      mockClient.messages.create
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(successResponse)

      // Start the invoke (don't await yet)
      const invokePromise = provider.invoke('Test', { maxRetries: 3 })

      // Fast-forward through the retry delay
      await vi.runAllTimersAsync()

      const response = await invokePromise

      expect(response.content).toBe('Success after retry')
      expect(mockClient.messages.create).toHaveBeenCalledTimes(2)
    })

    it('should retry on rate limit and succeed', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      const rateLimitError = new Anthropic.RateLimitError(
        429,
        new Headers(),
        'Rate limit exceeded',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        {} as any
      )

      const successResponse = {
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'Success after retry' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      }

      mockClient.messages.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse)

      const invokePromise = provider.invoke('Test', { maxRetries: 3 })
      await vi.runAllTimersAsync()
      const response = await invokePromise

      expect(response.content).toBe('Success after retry')
      expect(mockClient.messages.create).toHaveBeenCalledTimes(2)
    })

    it('should exhaust retries and throw', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      const timeoutError = new Anthropic.APIConnectionTimeoutError({
        message: 'Request timed out',
      })

      mockClient.messages.create.mockRejectedValue(timeoutError)

      const invokePromise = provider.invoke('Test', { maxRetries: 2 })

      // Add catch handler immediately to prevent unhandled rejection
      let caughtError: unknown
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const catchPromise = invokePromise.catch((error) => {
        caughtError = error
      })

      // Fast-forward through all retry delays
      await vi.runAllTimersAsync()
      await catchPromise

      // Verify the error
      expect(caughtError).toMatchObject({
        type: LLMErrorType.TIMEOUT,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        metadata: expect.objectContaining({
          attempts: 3, // 1 initial + 2 retries
          maxRetries: 2,
        }),
      })

      expect(mockClient.messages.create).toHaveBeenCalledTimes(3)
    })

    it('should not retry on non-retryable errors', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiError = new Anthropic.APIError(400, new Headers(), 'Bad request', {} as any)
      mockClient.messages.create.mockRejectedValue(apiError)

      await expect(provider.invoke('Test', { maxRetries: 3 })).rejects.toThrow()

      // Should only try once (no retries for non-retryable errors)
      expect(mockClient.messages.create).toHaveBeenCalledTimes(1)
    })

    it('should use exponential backoff for retries', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      const timeoutError = new Anthropic.APIConnectionTimeoutError({
        message: 'Request timed out',
      })

      mockClient.messages.create.mockRejectedValue(timeoutError)

      const invokePromise = provider.invoke('Test', { maxRetries: 3 })

      // Add catch handler immediately to prevent unhandled rejection
      let caughtError: unknown
      const catchPromise = invokePromise.catch((error) => {
        caughtError = error
      })

      // Verify exponential backoff delays
      // Attempt 1: immediate
      // Attempt 2: 1000ms delay (2^0 * 1000)
      // Attempt 3: 2000ms delay (2^1 * 1000)
      // Attempt 4: 4000ms delay (2^2 * 1000)

      await vi.advanceTimersByTimeAsync(1000) // First retry
      expect(mockClient.messages.create).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(2000) // Second retry
      expect(mockClient.messages.create).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(4000) // Third retry
      expect(mockClient.messages.create).toHaveBeenCalledTimes(4)

      await catchPromise

      // Verify the error
      expect(caughtError).toMatchObject({
        type: LLMErrorType.TIMEOUT,
      })
    })
  })

  describe('JSON extraction', () => {
    beforeEach(() => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key'
    })

    it('should extract JSON from response', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      mockClient.messages.create.mockResolvedValue({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: '{"result": "success", "value": 42}' }],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      })

      const response = await provider.invoke('Test')
      const json = provider.extractJSON<{ result: string; value: number }>(response)

      expect(json).toEqual({ result: 'success', value: 42 })
    })

    it('should extract JSON from markdown code block', async () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      mockClient.messages.create.mockResolvedValue({
        id: 'msg_123',
        type: 'message',
        role: 'assistant',
        content: [
          {
            type: 'text',
            text: '```json\n{"result": "success"}\n```',
          },
        ],
        model: 'claude-sonnet-4-20250514',
        stop_reason: 'end_turn',
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 5 },
      })

      const response = await provider.invoke('Test')
      const json = provider.extractJSON<{ result: string }>(response)

      expect(json).toEqual({ result: 'success' })
    })
  })

  describe('provider interface methods', () => {
    beforeEach(() => {
      process.env['ANTHROPIC_API_KEY'] = 'test-key'
    })

    it('should return correct provider name', () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      expect(provider.getProviderName()).toBe('claude-cli')
    })

    it('should return correct model name', () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-3-5-haiku-20241022',
      })

      expect(provider.getModelName()).toBe('claude-3-5-haiku-20241022')
    })

    it('should return correct identifier', () => {
      const provider = new ClaudeProvider({
        type: 'claude-cli',
        model: 'claude-sonnet-4-20250514',
      })

      expect(provider.getIdentifier()).toBe('claude-cli/claude-sonnet-4-20250514')
    })
  })
})
