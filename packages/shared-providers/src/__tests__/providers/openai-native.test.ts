import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { OpenAINativeProvider, AuthError, RateLimitError, TimeoutError, ProviderError } from '../../index'
import OpenAI from 'openai'

// Create a mock for the chat completions create method
const mockCreate = vi.fn()

// Mock the OpenAI module
vi.mock('openai', () => {
  const MockOpenAI = vi.fn().mockImplementation(() => ({
    chat: {
      completions: {
        create: mockCreate,
      },
    },
  }))
  return {
    default: Object.assign(MockOpenAI, {
      APIError: class APIError extends Error {
        status?: number
        headers?: Record<string, string>
        constructor(message: string, status?: number, headers?: Record<string, string>) {
          super(message)
          this.status = status
          this.headers = headers
        }
      },
    }),
  }
})

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

describe('OpenAINativeProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('creates provider with OpenAI configuration', () => {
    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    expect(provider.id).toBe('openai')
  })

  it('creates provider with OpenRouter configuration', () => {
    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-or-test-key',
        baseURL: 'https://openrouter.ai/api/v1',
        model: 'openai/gpt-4',
      },
      logger
    )

    expect(provider.id).toBe('openrouter')
  })

  it('completes request successfully', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Test response' } }],
      model: 'gpt-4',
      usage: {
        prompt_tokens: 10,
        completion_tokens: 20,
      },
    }

    mockCreate.mockResolvedValue(mockResponse)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    const response = await provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    expect(response.content).toBe('Test response')
    expect(response.model).toBe('gpt-4')
    expect(response.usage).toEqual({
      inputTokens: 10,
      outputTokens: 20,
    })
    expect(response.rawResponse.status).toBe(200)
  })

  it('includes system message when provided', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Response' } }],
      model: 'gpt-4',
      usage: { prompt_tokens: 5, completion_tokens: 5 },
    }

    mockCreate.mockResolvedValue(mockResponse)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    await provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'You are helpful',
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: [
          { role: 'system', content: 'You are helpful' },
          { role: 'user', content: 'Hello' },
        ],
      })
    )
  })

  it('maps 401 error to AuthError', async () => {
    const apiError = new (OpenAI as any).APIError('Unauthorized', 401)
    mockCreate.mockRejectedValue(apiError)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'invalid-key',
        model: 'gpt-4',
      },
      logger
    )

    await expect(
      provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    ).rejects.toThrow(AuthError)
  })

  it('maps 429 error to RateLimitError with retryAfter', async () => {
    const apiError = new (OpenAI as any).APIError('Rate limit', 429, { 'retry-after': '60' })
    mockCreate.mockRejectedValue(apiError)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    await expect(
      provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    ).rejects.toBeInstanceOf(RateLimitError)

    // Verify retryAfter is correctly parsed
    const error = await provider
      .complete({ messages: [{ role: 'user', content: 'Hello' }] })
      .catch((e) => e)
    expect(error).toBeInstanceOf(RateLimitError)
    expect(error.retryAfter).toBe(60)
  })

  it('maps timeout error to TimeoutError', async () => {
    const timeoutError = new Error('timeout')
    timeoutError.name = 'AbortError'
    mockCreate.mockRejectedValue(timeoutError)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    await expect(
      provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    ).rejects.toThrow(TimeoutError)
  })

  it('maps 403 error to AuthError', async () => {
    const apiError = new (OpenAI as any).APIError('Forbidden', 403)
    mockCreate.mockRejectedValue(apiError)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    await expect(
      provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    ).rejects.toThrow(AuthError)
  })

  it('maps 5xx errors to retryable ProviderError', async () => {
    const apiError = new (OpenAI as any).APIError('Internal Server Error', 500)
    mockCreate.mockRejectedValue(apiError)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    const error = await provider
      .complete({ messages: [{ role: 'user', content: 'Hello' }] })
      .catch((e) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect(error.retryable).toBe(true)
    expect(error.message).toContain('Server error')
  })

  it('maps non-APIError to ProviderError', async () => {
    const genericError = new Error('Network failure')
    mockCreate.mockRejectedValue(genericError)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    const error = await provider
      .complete({ messages: [{ role: 'user', content: 'Hello' }] })
      .catch((e) => e)

    expect(error).toBeInstanceOf(ProviderError)
    expect(error.message).toBe('Network failure')
    expect(error.retryable).toBe(false)
  })

  it('forwards jsonSchema to request with response_format', async () => {
    const mockResponse = {
      choices: [{ message: { content: '{"name": "Test"}' } }],
      model: 'gpt-4',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }

    mockCreate.mockResolvedValue(mockResponse)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    await provider.complete({
      messages: [{ role: 'user', content: 'Generate JSON' }],
      jsonSchema: {
        name: 'test_schema',
        schema: { type: 'object', properties: { name: { type: 'string' } } },
        strict: true,
      },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        response_format: {
          type: 'json_schema',
          json_schema: {
            name: 'test_schema',
            schema: { type: 'object', properties: { name: { type: 'string' } } },
            strict: true,
          },
        },
      })
    )
  })

  it('forwards additionalParams to request', async () => {
    const mockResponse = {
      choices: [{ message: { content: 'Response' } }],
      model: 'gpt-4',
      usage: { prompt_tokens: 10, completion_tokens: 5 },
    }

    mockCreate.mockResolvedValue(mockResponse)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    await provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
      additionalParams: {
        stream: true,
        presence_penalty: 0.5,
      },
    })

    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        stream: true,
        presence_penalty: 0.5,
      })
    )
  })
})
