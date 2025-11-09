/**
 * Tests for OpenAIProvider
 *
 * These tests mock the OpenAI SDK to avoid real API calls (zero cost).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAIProvider } from '../../src/lib/providers/OpenAIProvider.js'
import { LLMErrorType } from '../../src/lib/providers/types.js'
import OpenAI from 'openai'

// Mock the OpenAI SDK
vi.mock('openai')

describe('OpenAIProvider', () => {
  let mockClient: {
    chat: {
      completions: {
        create: ReturnType<typeof vi.fn>
      }
    }
  }

  beforeEach(() => {
    // Reset mocks before each test
    vi.clearAllMocks()

    // Create mock client
    mockClient = {
      chat: {
        completions: {
          create: vi.fn(),
        },
      },
    }

    // Mock the OpenAI constructor to return our mock client
    vi.mocked(OpenAI).mockImplementation(() => mockClient as unknown as OpenAI)
  })

  afterEach(() => {
    // Clean up environment variables
    delete process.env['OPENAI_API_KEY']
  })

  describe('constructor', () => {
    it('should create provider with API key from config', () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      expect(provider).toBeDefined()
      expect(provider.getProviderName()).toBe('openai-api')
      expect(provider.getModelName()).toBe('gpt-5-nano')
    })

    it('should create provider with API key from environment', () => {
      process.env['OPENAI_API_KEY'] = 'env-key'

      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-4o',
        apiKey: 'env-key',
      })

      expect(provider).toBeDefined()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const openaiCall = vi.mocked(OpenAI).mock.calls[0]?.[0]
      expect(openaiCall).toMatchObject({
        apiKey: 'env-key',
        maxRetries: 0,
      })
    })

    it('should use custom endpoint if provided', () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
        endpoint: 'https://custom.openai.com/v1/chat/completions',
      })

      expect(provider).toBeDefined()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const openaiCall = vi.mocked(OpenAI).mock.calls[0]?.[0]
      expect(openaiCall).toMatchObject({
        baseURL: 'https://custom.openai.com/v1',
      })
    })

    it('should throw error if API key is missing', () => {
      expect(() => {
        new OpenAIProvider({
          type: 'openai-api',
          model: 'gpt-5-nano',
          // @ts-expect-error - Testing missing API key
          apiKey: undefined,
        })
      }).toThrow(/API key not found/)
    })
  })

  describe('invoke', () => {
    it('should successfully invoke OpenAI and return response', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      // Mock successful response
      const mockCompletion = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Hello, world!',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      }

      mockClient.chat.completions.create.mockResolvedValue(mockCompletion)

      const response = await provider.invoke('Test prompt')

      // Verify API call
      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        {
          model: 'gpt-5-nano',
          messages: [
            {
              role: 'user',
              content: 'Test prompt',
            },
          ],
          response_format: { type: 'json_object' },
        },
        expect.objectContaining({
          timeout: 30000, // Default 30 seconds in ms
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
      // OpenAI doesn't provide cost - field should be omitted
      expect('costUsd' in response.metadata).toBe(false)
    })

    it('should handle custom timeout', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
        timeout: 60, // 60 seconds
      })

      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Response' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      await provider.invoke('Test', { timeout: 60 })

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          timeout: 60000, // 60 seconds in ms
        })
      )
    })

    it('should use JSON schema when provided', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"result": "success"}' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const schema = {
        name: 'test_schema',
        strict: true,
        schema: {
          type: 'object',
          properties: {
            result: { type: 'string' },
          },
          required: ['result'],
          additionalProperties: false,
        },
      }

      await provider.invoke('Test', { jsonSchema: schema })

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_schema', json_schema: schema },
        }),
        expect.anything()
      )
    })

    it('should use json_object format when no schema provided', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"result": "success"}' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      await provider.invoke('Test')

      expect(mockClient.chat.completions.create).toHaveBeenCalledWith(
        expect.objectContaining({
          response_format: { type: 'json_object' },
        }),
        expect.anything()
      )
    })

    it('should handle tool_calls with <|constrain|>json', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      // Mock response with tool_calls instead of content
      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: '<|constrain|>json',
                    arguments: '{"result": "from_tool"}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const response = await provider.invoke('Test')

      expect(response.content).toBe('{"result": "from_tool"}')
    })

    it('should handle reasoning field in response', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-oss-20b',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-oss-20b',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: 'Final answer',
              reasoning: 'Step by step reasoning here',
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const response = await provider.invoke('Test')

      expect(response.content).toBe('Final answer')
      expect(response.metadata.providerMetadata?.['reasoning']).toBe('Step by step reasoning here')
    })
  })

  describe('error handling', () => {
    it('should handle timeout errors', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      // Mock timeout error
      const timeoutError = new OpenAI.APIConnectionTimeoutError({
        message: 'Request timed out',
      })
      mockClient.chat.completions.create.mockRejectedValue(timeoutError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.TIMEOUT,
      })
    })

    it('should handle rate limit errors', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      // Mock rate limit error
      const rateLimitError = new OpenAI.RateLimitError(
        429,
        new Response('', { status: 429 }),
        'Rate limit exceeded',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        {} as any
      )
      mockClient.chat.completions.create.mockRejectedValue(rateLimitError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.API_ERROR,
      })
    })

    it('should handle API errors', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      // Mock API error
      const apiError = new OpenAI.APIError(
        500,
        undefined,
        'Internal server error',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {} as any
      )
      mockClient.chat.completions.create.mockRejectedValue(apiError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.API_ERROR,
      })
    })

    it('should handle network errors', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      // Mock network error
      const networkError = new TypeError('fetch failed')
      mockClient.chat.completions.create.mockRejectedValue(networkError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.NETWORK_ERROR,
      })
    })

    it('should handle unknown errors', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      // Mock unknown error
      const unknownError = new Error('Something went wrong')
      mockClient.chat.completions.create.mockRejectedValue(unknownError)

      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toThrow()
      await expect(provider.invoke('Test', { maxRetries: 0 })).rejects.toMatchObject({
        type: LLMErrorType.UNKNOWN,
      })
    })

    it('should throw error if response has no content and no tool_calls', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
            },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      await expect(provider.invoke('Test')).rejects.toThrow(/empty content/)
    })

    it('should throw error for unexpected tool_calls', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: {
              role: 'assistant',
              content: null,
              tool_calls: [
                {
                  id: 'call_123',
                  type: 'function',
                  function: {
                    name: 'unexpected_tool',
                    arguments: '{}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      await expect(provider.invoke('Test')).rejects.toThrow(/unexpected tool call/)
    })
  })

  describe('retry logic', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('should retry on timeout and succeed', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      const timeoutError = new OpenAI.APIConnectionTimeoutError({
        message: 'Request timed out',
      })

      const successResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Success after retry' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }

      // Fail first, succeed second
      mockClient.chat.completions.create
        .mockRejectedValueOnce(timeoutError)
        .mockResolvedValueOnce(successResponse)

      // Start the invoke (don't await yet)
      const invokePromise = provider.invoke('Test', { maxRetries: 3 })

      // Fast-forward through the retry delay
      await vi.runAllTimersAsync()

      const response = await invokePromise

      expect(response.content).toBe('Success after retry')
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2)
    })

    it('should retry on rate limit and succeed', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      const rateLimitError = new OpenAI.RateLimitError(
        429,
        new Response('', { status: 429 }),
        'Rate limit exceeded',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument
        {} as any
      )

      const successResponse = {
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'Success after retry' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      }

      mockClient.chat.completions.create
        .mockRejectedValueOnce(rateLimitError)
        .mockResolvedValueOnce(successResponse)

      const invokePromise = provider.invoke('Test', { maxRetries: 3 })
      await vi.runAllTimersAsync()
      const response = await invokePromise

      expect(response.content).toBe('Success after retry')
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2)
    })

    it('should exhaust retries and throw', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      const timeoutError = new OpenAI.APIConnectionTimeoutError({
        message: 'Request timed out',
      })

      mockClient.chat.completions.create.mockRejectedValue(timeoutError)

      const invokePromise = provider.invoke('Test', { maxRetries: 2 })

      // Add catch handler immediately to prevent unhandled rejection
      let caughtError: unknown
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

      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(3)
    })

    it('should not retry on non-retryable errors', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const apiError = new OpenAI.APIError(400, undefined, 'Bad request', {} as any)
      mockClient.chat.completions.create.mockRejectedValue(apiError)

      await expect(provider.invoke('Test', { maxRetries: 3 })).rejects.toThrow()

      // Should only try once (no retries for non-retryable errors)
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1)
    })

    it('should use exponential backoff for retries', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      const timeoutError = new OpenAI.APIConnectionTimeoutError({
        message: 'Request timed out',
      })

      mockClient.chat.completions.create.mockRejectedValue(timeoutError)

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
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2)

      await vi.advanceTimersByTimeAsync(2000) // Second retry
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(3)

      await vi.advanceTimersByTimeAsync(4000) // Third retry
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(4)

      await catchPromise

      // Verify the error
      expect(caughtError).toMatchObject({
        type: LLMErrorType.TIMEOUT,
      })
    })
  })

  describe('JSON extraction', () => {
    it('should extract JSON from response', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '{"result": "success", "value": 42}' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const response = await provider.invoke('Test')
      const json = provider.extractJSON<{ result: string; value: number }>(response)

      expect(json).toEqual({ result: 'success', value: 42 })
    })

    it('should extract JSON from markdown code block', async () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValue({
        id: 'chatcmpl-123',
        object: 'chat.completion',
        created: 1677652288,
        model: 'gpt-5-nano',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: '```json\n{"result": "success"}\n```' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      })

      const response = await provider.invoke('Test')
      const json = provider.extractJSON<{ result: string }>(response)

      expect(json).toEqual({ result: 'success' })
    })
  })

  describe('provider interface methods', () => {
    it('should return correct provider name', () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      expect(provider.getProviderName()).toBe('openai-api')
    })

    it('should return correct model name', () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-4o',
        apiKey: 'test-key',
      })

      expect(provider.getModelName()).toBe('gpt-4o')
    })

    it('should return correct identifier', () => {
      const provider = new OpenAIProvider({
        type: 'openai-api',
        model: 'gpt-5-nano',
        apiKey: 'test-key',
      })

      expect(provider.getIdentifier()).toBe('openai-api/gpt-5-nano')
    })
  })
})
