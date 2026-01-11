import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { ProviderFactory, ProviderError, OpenAINativeProvider } from '../index'

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

// Spy on OpenAINativeProvider to capture constructor args
vi.spyOn(OpenAINativeProvider.prototype, 'complete').mockResolvedValue({
  content: 'mock response',
  model: 'gpt-4',
  rawResponse: { status: 200, body: '{}' },
})

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
 *
 * These tests verify that the correct API key source is used by
 * checking the logger debug messages from resolveApiKey().
 */
describe('ProviderFactory - Credential Precedence', () => {
  const originalEnv = { ...process.env }
  let mockLogger: ReturnType<typeof createLogManager>['getLogger'] extends () => infer R ? R : never

  beforeEach(() => {
    // Clean environment before each test
    delete process.env.OPENAI_API_KEY
    delete process.env.OPENROUTER_API_KEY

    // Create mock logger to verify which key source was used
    mockLogger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: vi.fn().mockReturnThis(),
      flush: vi.fn().mockResolvedValue(undefined),
    } as any
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
        mockLogger
      )

      const provider = factory.create()
      expect(provider.id).toBe('openai')

      // Verify env var was used (not config)
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Using API key from environment variable',
        expect.objectContaining({
          provider: 'openai',
          envVar: 'OPENAI_API_KEY',
        })
      )
    })

    it('uses OPENAI_API_KEY env var when no config apiKey provided', () => {
      process.env.OPENAI_API_KEY = 'sk-env-only-key'

      const factory = new ProviderFactory(
        {
          provider: 'openai',
          model: 'gpt-4',
        },
        mockLogger
      )

      const provider = factory.create()
      expect(provider.id).toBe('openai')

      // Verify env var was used
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Using API key from environment variable',
        expect.objectContaining({
          provider: 'openai',
          envVar: 'OPENAI_API_KEY',
        })
      )
    })

    it('falls back to config apiKey when env var not set', () => {
      const factory = new ProviderFactory(
        {
          provider: 'openai',
          apiKey: 'sk-config-fallback-key',
          model: 'gpt-4',
        },
        mockLogger
      )

      const provider = factory.create()
      expect(provider.id).toBe('openai')

      // Verify env var log was NOT called (config fallback used)
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        'Using API key from environment variable',
        expect.objectContaining({ provider: 'openai' })
      )
    })

    it('throws when neither env var nor config apiKey available', () => {
      const factory = new ProviderFactory(
        {
          provider: 'openai',
          model: 'gpt-4',
        },
        mockLogger
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
        mockLogger
      )

      const provider = factory.create()
      expect(provider.id).toBe('openrouter')

      // Verify env var was used
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Using API key from environment variable',
        expect.objectContaining({
          provider: 'openrouter',
          envVar: 'OPENROUTER_API_KEY',
        })
      )
    })

    it('uses OPENROUTER_API_KEY env var when no config apiKey provided', () => {
      process.env.OPENROUTER_API_KEY = 'sk-or-env-only-key'

      const factory = new ProviderFactory(
        {
          provider: 'openrouter',
          model: 'openai/gpt-4',
        },
        mockLogger
      )

      const provider = factory.create()
      expect(provider.id).toBe('openrouter')

      // Verify env var was used
      expect(mockLogger.debug).toHaveBeenCalledWith(
        'Using API key from environment variable',
        expect.objectContaining({
          provider: 'openrouter',
          envVar: 'OPENROUTER_API_KEY',
        })
      )
    })

    it('falls back to config apiKey when env var not set', () => {
      const factory = new ProviderFactory(
        {
          provider: 'openrouter',
          apiKey: 'sk-or-config-fallback-key',
          model: 'openai/gpt-4',
        },
        mockLogger
      )

      const provider = factory.create()
      expect(provider.id).toBe('openrouter')

      // Verify env var log was NOT called (config fallback used)
      expect(mockLogger.debug).not.toHaveBeenCalledWith(
        'Using API key from environment variable',
        expect.objectContaining({ provider: 'openrouter' })
      )
    })

    it('throws when neither env var nor config apiKey available', () => {
      const factory = new ProviderFactory(
        {
          provider: 'openrouter',
          model: 'openai/gpt-4',
        },
        mockLogger
      )

      expect(() => factory.create()).toThrow(ProviderError)
      expect(() => factory.create()).toThrow('OPENROUTER_API_KEY')
    })
  })

  describe('Claude CLI (no API key needed)', () => {
    it('creates provider without any API key configuration', () => {
      const factory = new ProviderFactory(
        {
          provider: 'claude-cli',
          model: 'claude-3-5-sonnet-20241022',
        },
        mockLogger
      )

      const provider = factory.create()
      expect(provider.id).toBe('claude-cli')
    })
  })
})

/**
 * Emulator Branch Tests
 *
 * Tests for the `provider: 'emulator'` path which dispatches to
 * OpenAIEmulator, OpenRouterEmulator, or ClaudeCliEmulator.
 */
describe('ProviderFactory - Emulator', () => {
  it('creates OpenAI emulator by default', () => {
    const factory = new ProviderFactory(
      {
        provider: 'emulator',
        model: 'gpt-4',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('openai-emulator')
  })

  it('creates OpenAI emulator when explicitly specified', () => {
    const factory = new ProviderFactory(
      {
        provider: 'emulator',
        emulatedProvider: 'openai',
        model: 'gpt-4',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('openai-emulator')
  })

  it('creates OpenRouter emulator', () => {
    const factory = new ProviderFactory(
      {
        provider: 'emulator',
        emulatedProvider: 'openrouter',
        model: 'openai/gpt-4',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('openrouter-emulator')
  })

  it('creates Claude CLI emulator', () => {
    const factory = new ProviderFactory(
      {
        provider: 'emulator',
        emulatedProvider: 'claude-cli',
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const provider = factory.create()
    expect(provider.id).toBe('claude-cli-emulator')
  })

  it('throws for unknown emulated provider', () => {
    const factory = new ProviderFactory(
      {
        provider: 'emulator',
        emulatedProvider: 'unknown-provider' as any,
        model: 'test-model',
      },
      logger
    )

    expect(() => factory.create()).toThrow('Unknown emulated provider')
  })

  it('uses custom emulatorStatePath when provided', () => {
    const factory = new ProviderFactory(
      {
        provider: 'emulator',
        emulatedProvider: 'openai',
        emulatorStatePath: '/tmp/claude/custom-state.json',
        model: 'gpt-4',
      },
      logger
    )

    // Should not throw - successfully creates with custom path
    const provider = factory.create()
    expect(provider.id).toBe('openai-emulator')
  })
})
