/**
 * OpenAI Native Provider - Provider Routing Tests
 *
 * Tests for OpenRouter-specific provider allowlist/blocklist routing.
 * @see https://openrouter.ai/docs/guides/routing/provider-selection
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { OpenAINativeProvider } from '../providers/openai-native'

// Mock the OpenAI client
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        chat: {
          completions: {
            create: vi.fn().mockResolvedValue({
              choices: [{ message: { content: 'test response' } }],
              model: 'test-model',
              usage: { prompt_tokens: 10, completion_tokens: 20 },
            }),
          },
        },
      }
    }),
  }
})

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

describe('OpenAINativeProvider - Provider Routing', () => {
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    // Get a fresh reference to the mocked create function
    const OpenAI = (await import('openai')).default
    vi.mocked(OpenAI).mockClear()
    mockCreate = vi.fn().mockResolvedValue({
      choices: [{ message: { content: 'test response' } }],
      model: 'test-model',
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    })
    vi.mocked(OpenAI).mockImplementation(function () {
      return {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as any
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('OpenRouter provider routing', () => {
    it('includes provider.only when providerAllowlist is configured', async () => {
      const provider = new OpenAINativeProvider(
        {
          apiKey: 'test-key',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4',
          providerAllowlist: ['openai', 'anthropic'],
        },
        logger
      )

      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({
            only: ['openai', 'anthropic'],
          }),
        })
      )
    })

    it('includes provider.ignore when providerBlocklist is configured', async () => {
      const provider = new OpenAINativeProvider(
        {
          apiKey: 'test-key',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4',
          providerBlocklist: ['deepinfra', 'together'],
        },
        logger
      )

      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: expect.objectContaining({
            ignore: ['deepinfra', 'together'],
          }),
        })
      )
    })

    it('includes both only and ignore when both are configured', async () => {
      const provider = new OpenAINativeProvider(
        {
          apiKey: 'test-key',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4',
          providerAllowlist: ['openai'],
          providerBlocklist: ['azure'],
        },
        logger
      )

      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          provider: {
            only: ['openai'],
            ignore: ['azure'],
          },
        })
      )
    })

    it('does not include provider field when no routing configured', async () => {
      const provider = new OpenAINativeProvider(
        {
          apiKey: 'test-key',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4',
        },
        logger
      )

      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('provider')
    })

    it('does not include provider field when lists are empty', async () => {
      const provider = new OpenAINativeProvider(
        {
          apiKey: 'test-key',
          baseURL: 'https://openrouter.ai/api/v1',
          model: 'openai/gpt-4',
          providerAllowlist: [],
          providerBlocklist: [],
        },
        logger
      )

      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('provider')
    })
  })

  describe('Non-OpenRouter providers', () => {
    it('does not include provider routing for OpenAI (non-OpenRouter)', async () => {
      const provider = new OpenAINativeProvider(
        {
          apiKey: 'test-key',
          // No baseURL = defaults to OpenAI
          model: 'gpt-4',
          providerAllowlist: ['openai'], // Should be ignored
          providerBlocklist: ['anthropic'], // Should be ignored
        },
        logger
      )

      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('provider')
    })

    it('does not include provider routing for non-openrouter baseURL', async () => {
      const provider = new OpenAINativeProvider(
        {
          apiKey: 'test-key',
          baseURL: 'https://api.openai.com/v1',
          model: 'gpt-4',
          providerAllowlist: ['openai'],
        },
        logger
      )

      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      const callArgs = mockCreate.mock.calls[0][0]
      expect(callArgs).not.toHaveProperty('provider')
    })
  })
})
