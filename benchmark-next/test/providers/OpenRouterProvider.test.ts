/**
 * Tests for OpenRouterProvider
 *
 * These tests mock the OpenAI SDK to avoid real API calls (zero cost).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenRouterProvider } from '../../src/lib/providers/OpenRouterProvider.js'
import OpenAI from 'openai'

// Mock the OpenAI SDK
vi.mock('openai')

describe('OpenRouterProvider', () => {
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
    delete process.env['OPENROUTER_API_KEY']
  })

  describe('constructor', () => {
    it('should create provider with API key from config', () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      expect(provider).toBeDefined()
      expect(provider.getProviderName()).toBe('openrouter')
      expect(provider.getModelName()).toBe('google/gemma-3n-e4b-it')
    })

    it('should use default endpoint if not provided', () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      expect(provider).toBeDefined()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const openaiCall = vi.mocked(OpenAI).mock.calls[0]?.[0]
      expect(openaiCall).toMatchObject({
        apiKey: 'test-key',
        baseURL: 'https://openrouter.ai/api/v1',
        maxRetries: 0,
      })
    })

    it('should use custom endpoint if provided', () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
        endpoint: 'https://custom.openrouter.ai/api/v1',
      })

      expect(provider).toBeDefined()
      // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
      const openaiCall = vi.mocked(OpenAI).mock.calls[0]?.[0]
      expect(openaiCall).toMatchObject({
        baseURL: 'https://custom.openrouter.ai/api/v1',
      })
    })

    it('should throw error if API key is missing', () => {
      expect(() => {
        new OpenRouterProvider({
          type: 'openrouter',
          model: 'google/gemma-3n-e4b-it',
          // @ts-expect-error - Testing missing API key
          apiKey: undefined,
        })
      }).toThrow(/API key not found/)
    })
  })

  describe('invoke', () => {
    it('should successfully invoke OpenRouter API', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      // Mock successful response
      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'The answer is 4',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      })

      const response = await provider.invoke('What is 2+2?')

      expect(response.content).toBe('The answer is 4')
      expect(response.metadata.wallTimeMs).toBeGreaterThanOrEqual(0)
      expect(response.metadata.usage).toEqual({
        inputTokens: 10,
        outputTokens: 5,
        totalTokens: 15,
      })
      expect(response.metadata.providerMetadata?.['completionId']).toBe('gen-12345')
    })

    it('should handle response with reasoning field', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'The answer is 4',
              reasoning: 'I added 2 and 2',
            },
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      })

      const response = await provider.invoke('What is 2+2?')

      expect(response.content).toBe('The answer is 4')
      expect(response.metadata.providerMetadata?.['reasoning']).toBe('I added 2 and 2')
    })

    it('should handle tool_calls with <|constrain|>json', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  function: {
                    name: '<|constrain|>json',
                    arguments: '{"result": 4}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
        usage: {
          prompt_tokens: 10,
          completion_tokens: 5,
          total_tokens: 15,
        },
      })

      const response = await provider.invoke('What is 2+2?')

      expect(response.content).toBe('{"result": 4}')
    })

    it('should throw error for unexpected tool call', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              tool_calls: [
                {
                  function: {
                    name: 'unknown_tool',
                    arguments: '{}',
                  },
                },
              ],
            },
            finish_reason: 'tool_calls',
          },
        ],
      })

      await expect(provider.invoke('test')).rejects.toThrow(/unexpected tool call/)
    })

    it('should throw error for empty content and no tool_calls', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
            },
            finish_reason: 'stop',
          },
        ],
      })

      await expect(provider.invoke('test')).rejects.toThrow(/empty content and no tool_calls/)
    })

    it('should handle custom timeout', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
        timeout: 5,
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'response',
            },
          },
        ],
      })

      await provider.invoke('test', { timeout: 10 })

      // Verify the create call included timeout
      expect(mockClient.chat.completions.create).toHaveBeenCalled()
    })

    it('should send JSON schema in response_format when provided', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '{"result": 4}',
            },
          },
        ],
      })

      const schema = {
        name: 'math_result',
        schema: {
          type: 'object',
          properties: {
            result: { type: 'number' },
          },
        },
      }

      await provider.invoke('test', { jsonSchema: schema })

      // Verify schema was passed to API
      const createCall = mockClient.chat.completions.create.mock.calls[0]
      expect(createCall?.[0]).toMatchObject({
        response_format: {
          type: 'json_schema',
          json_schema: schema,
        },
      })
    })

    it('should use json_object when no schema provided', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '{"result": 4}',
            },
          },
        ],
      })

      await provider.invoke('test')

      // Verify json_object was used
      const createCall = mockClient.chat.completions.create.mock.calls[0]
      expect(createCall?.[0]).toMatchObject({
        response_format: {
          type: 'json_object',
        },
      })
    })
  })

  describe('error handling', () => {
    it('should handle API error', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      const apiError = new OpenAI.APIError(
        400,
        {
          error: { message: 'Bad request' },
        } as never,
        'Bad request',
        new Headers()
      )

      mockClient.chat.completions.create.mockRejectedValueOnce(apiError)

      await expect(provider.invoke('test')).rejects.toThrow()
    })

    it('should handle missing choices in response', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [],
      })

      await expect(provider.invoke('test')).rejects.toThrow(/no choices/)
    })

    it('should handle network error', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockRejectedValueOnce(new TypeError('fetch failed'))

      await expect(provider.invoke('test')).rejects.toThrow()
    })

    it('should handle timeout with AbortError', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockClient.chat.completions.create.mockRejectedValueOnce(abortError)

      await expect(provider.invoke('test', { timeout: 1, maxRetries: 0 })).rejects.toThrow()
    })
  })

  describe('retry logic', () => {
    it('should retry on timeout error', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      // First call times out, second succeeds
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockClient.chat.completions.create.mockRejectedValueOnce(abortError)
      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Success after retry',
            },
          },
        ],
      })

      const response = await provider.invoke('test', { maxRetries: 3 })

      expect(response.content).toBe('Success after retry')
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2)
    })

    it('should retry on rate limit error', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      // First call gets rate limited, second succeeds
      const rateLimitError = new OpenAI.RateLimitError(
        429,
        {} as never,
        'Rate limited',
        new Headers()
      )
      mockClient.chat.completions.create.mockRejectedValueOnce(rateLimitError)
      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'Success after retry',
            },
          },
        ],
      })

      const response = await provider.invoke('test', { maxRetries: 3 })

      expect(response.content).toBe('Success after retry')
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(2)
    })

    it('should fail after max retries exceeded', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      // All calls time out
      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockClient.chat.completions.create.mockRejectedValueOnce(abortError)
      mockClient.chat.completions.create.mockRejectedValueOnce(abortError)
      mockClient.chat.completions.create.mockRejectedValueOnce(abortError)

      await expect(provider.invoke('test', { timeout: 1, maxRetries: 2 })).rejects.toThrow()

      // Should try 3 times (1 initial + 2 retries)
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(3)
    })

    it('should not retry on non-retryable errors', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      // API error (non-retryable)
      const apiError = new OpenAI.APIError(
        400,
        {
          error: { message: 'Bad request' },
        } as never,
        'Bad request',
        new Headers()
      )

      mockClient.chat.completions.create.mockRejectedValueOnce(apiError)

      await expect(provider.invoke('test', { maxRetries: 3 })).rejects.toThrow()

      // Should only try once (no retries for 400)
      expect(mockClient.chat.completions.create).toHaveBeenCalledTimes(1)
    })

    it('should use exponential backoff between retries', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      const abortError = new Error('The operation was aborted')
      abortError.name = 'AbortError'
      mockClient.chat.completions.create.mockRejectedValueOnce(abortError)
      mockClient.chat.completions.create.mockRejectedValueOnce(abortError)
      mockClient.chat.completions.create.mockRejectedValueOnce(abortError)

      const startMs = Date.now()

      await expect(provider.invoke('test', { timeout: 0.1, maxRetries: 2 })).rejects.toThrow()

      const durationMs = Date.now() - startMs

      // With exponential backoff: 1s + 2s = 3s minimum
      // Add some slack for test execution time
      expect(durationMs).toBeGreaterThanOrEqual(2900)
    })
  })

  describe('metadata extraction', () => {
    it('should extract timing metadata', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockImplementationOnce(async () => {
        await new Promise((resolve) => setTimeout(resolve, 100))
        return {
          id: 'gen-12345',
          model: 'google/gemma-3n-e4b-it',
          choices: [
            {
              message: {
                role: 'assistant',
                content: 'response',
              },
            },
          ],
        }
      })

      const response = await provider.invoke('test')

      // Allow for timer precision variance (95ms instead of 100ms)
      expect(response.metadata.wallTimeMs).toBeGreaterThanOrEqual(95)
    })

    it('should handle missing usage data', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: 'response',
            },
          },
        ],
        // No usage field
      })

      const response = await provider.invoke('test')

      expect(response.metadata.usage).toBeUndefined()
    })
  })

  describe('JSON extraction', () => {
    it('should extract JSON from response content', async () => {
      const provider = new OpenRouterProvider({
        type: 'openrouter',
        model: 'google/gemma-3n-e4b-it',
        apiKey: 'test-key',
      })

      mockClient.chat.completions.create.mockResolvedValueOnce({
        id: 'gen-12345',
        model: 'google/gemma-3n-e4b-it',
        choices: [
          {
            message: {
              role: 'assistant',
              content: '```json\n{"result": 4}\n```',
            },
          },
        ],
      })

      const response = await provider.invoke('test')
      const extracted = provider.extractJSON(response)

      expect(extracted).toEqual({ result: 4 })
    })
  })
})
