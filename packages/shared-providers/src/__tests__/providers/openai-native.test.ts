import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { OpenAINativeProvider, AuthError, RateLimitError, TimeoutError } from '../../index'
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

  it('maps 429 error to RateLimitError', async () => {
    const apiError = new (OpenAI as any).APIError('Rate limit', 429, { 'retry-after': '60' })
    mockCreate.mockRejectedValue(apiError)

    const provider = new OpenAINativeProvider(
      {
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    try {
      await provider.complete({
        messages: [{ role: 'user', content: 'Hello' }],
      })
    } catch (err) {
      expect(err).toBeInstanceOf(RateLimitError)
      expect((err as RateLimitError).retryAfter).toBe(60)
    }
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
})
