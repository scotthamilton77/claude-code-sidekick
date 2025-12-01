import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { ProviderFactory, ProviderError } from '../index'

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

describe('ProviderFactory', () => {
  it('creates OpenAI provider with valid config', () => {
    const factory = new ProviderFactory(
      {
        provider: 'openai',
        apiKey: 'sk-test-key',
        model: 'gpt-4',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('openai')
  })

  it('creates OpenRouter provider with valid config', () => {
    const factory = new ProviderFactory(
      {
        provider: 'openrouter',
        apiKey: 'sk-or-test-key',
        model: 'openai/gpt-4',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('openrouter')
  })

  it('creates Claude CLI provider with valid config', () => {
    const factory = new ProviderFactory(
      {
        provider: 'claude-cli',
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('claude-cli')
  })

  it('throws error for OpenAI without API key', () => {
    // Ensure env var is not set
    const originalKey = process.env.OPENAI_API_KEY
    delete process.env.OPENAI_API_KEY

    try {
      const factory = new ProviderFactory(
        {
          provider: 'openai',
          model: 'gpt-4',
        },
        logger
      )

      expect(() => factory.create()).toThrow(ProviderError)
    } finally {
      if (originalKey) process.env.OPENAI_API_KEY = originalKey
    }
  })

  it('throws error for OpenRouter without API key', () => {
    // Ensure env var is not set
    const originalKey = process.env.OPENROUTER_API_KEY
    delete process.env.OPENROUTER_API_KEY

    try {
      const factory = new ProviderFactory(
        {
          provider: 'openrouter',
          model: 'openai/gpt-4',
        },
        logger
      )

      expect(() => factory.create()).toThrow(ProviderError)
    } finally {
      if (originalKey) process.env.OPENROUTER_API_KEY = originalKey
    }
  })

  it('throws error for unknown provider type', () => {
    const factory = new ProviderFactory(
      {
        provider: 'unknown' as any,
        model: 'test-model',
      },
      logger
    )

    expect(() => factory.create()).toThrow('Unknown provider type')
  })
})

/**
 * Credential Precedence Tests
 *
 * Per docs/design/LLM-PROVIDERS.md §6.1:
 * 1. Environment Variables (highest priority)
 * 2. Configuration File (apiKey in config)
 */
describe('ProviderFactory - Credential Precedence', () => {
  const originalEnv = { ...process.env }

  beforeEach(() => {
    // Clean environment before each test
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY
  })

  afterEach(() => {
    // Restore original environment
    process.env = { ...originalEnv }
  })

  describe('OpenAI credential precedence', () => {
    it('uses OPENAI_API_KEY env var when present (highest priority)', () => {
      process.env.OPENAI_API_KEY = 'sk-env-key'

      const factory = new ProviderFactory(
        {
          provider: 'openai',
          apiKey: 'sk-config-key', // Should be ignored
          model: 'gpt-4',
        },
        logger
      )

      // Should succeed using env var key
      const provider = factory.create()
      expect(provider.id).toBe('openai')
    })

    it('uses OPENAI_API_KEY env var when no config apiKey provided', () => {
      process.env.OPENAI_API_KEY = 'sk-env-only-key'

      const factory = new ProviderFactory(
        {
          provider: 'openai',
          model: 'gpt-4',
          // No apiKey in config
        },
        logger
      )

      // Should succeed using env var key
      const provider = factory.create()
      expect(provider.id).toBe('openai')
    })

    it('falls back to config apiKey when env var not set', () => {
      // No env var set
      const factory = new ProviderFactory(
        {
          provider: 'openai',
          apiKey: 'sk-config-fallback-key',
          model: 'gpt-4',
        },
        logger
      )

      // Should succeed using config key
      const provider = factory.create()
      expect(provider.id).toBe('openai')
    })

    it('throws when neither env var nor config apiKey available', () => {
      // No env var, no config key
      const factory = new ProviderFactory(
        {
          provider: 'openai',
          model: 'gpt-4',
        },
        logger
      )

      expect(() => factory.create()).toThrow(ProviderError)
      expect(() => factory.create()).toThrow('OPENAI_API_KEY')
    })
  })

  describe('OpenRouter credential precedence', () => {
    it('uses OPENROUTER_API_KEY env var when present (highest priority)', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-key'

      const factory = new ProviderFactory(
        {
          provider: 'openrouter',
          apiKey: 'sk-or-config-key', // Should be ignored
          model: 'openai/gpt-4',
        },
        logger
      )

      // Should succeed using env var key
      const provider = factory.create()
      expect(provider.id).toBe('openrouter')
    })

    it('uses OPENROUTER_API_KEY env var when no config apiKey provided', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-only-key'

      const factory = new ProviderFactory(
        {
          provider: 'openrouter',
          model: 'openai/gpt-4',
          // No apiKey in config
        },
        logger
      )

      // Should succeed using env var key
      const provider = factory.create()
      expect(provider.id).toBe('openrouter')
    })

    it('falls back to config apiKey when env var not set', () => {
      // No env var set
      const factory = new ProviderFactory(
        {
          provider: 'openrouter',
          apiKey: 'sk-or-config-fallback-key',
          model: 'openai/gpt-4',
        },
        logger
      )

      // Should succeed using config key
      const provider = factory.create()
      expect(provider.id).toBe('openrouter')
    })

    it('throws when neither env var nor config apiKey available', () => {
      // No env var, no config key
      const factory = new ProviderFactory(
        {
          provider: 'openrouter',
          model: 'openai/gpt-4',
        },
        logger
      )

      expect(() => factory.create()).toThrow(ProviderError)
      expect(() => factory.create()).toThrow('OPENROUTER_API_KEY')
    })
  })

  describe('Claude CLI (no API key needed)', () => {
    it('creates provider without any API key configuration', () => {
      // Claude CLI uses local auth, doesn't need API keys
      const factory = new ProviderFactory(
        {
          provider: 'claude-cli',
          model: 'claude-3-5-sonnet-20241022',
        },
        logger
      )

      const provider = factory.create()
      expect(provider.id).toBe('claude-cli')
    })
  })
})
