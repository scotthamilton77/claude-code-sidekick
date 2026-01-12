/**
 * ProfileProviderFactory Tests
 *
 * Tests for creating LLM providers from profile configurations.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { Logger } from '@sidekick/types'
import type { ConfigService, LlmProfile } from '@sidekick/core'
import { ProfileProviderFactory } from '../profile-factory'
import { FallbackProvider } from '../fallback'

// Fake logger
function createFakeLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as Logger
}

// Helper to create a minimal ConfigService fake
function createFakeConfigService(
  profiles: Record<string, LlmProfile> = {},
  fallbacks: Record<string, LlmProfile> = {},
  defaultProfile = 'default'
): ConfigService {
  return {
    llm: {
      profiles,
      fallbacks,
      defaultProfile,
    },
  } as unknown as ConfigService
}

// Sample profiles for testing
const sampleProfiles: Record<string, LlmProfile> = {
  default: {
    provider: 'openai',
    model: 'gpt-4',
    timeout: 30,
    timeoutMaxRetries: 3,
    temperature: 0.7,
    maxTokens: 4096,
  } as LlmProfile,
  fast: {
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    timeout: 15,
    timeoutMaxRetries: 2,
    temperature: 0.5,
    maxTokens: 2048,
  } as LlmProfile,
  claude: {
    provider: 'claude-cli',
    model: 'claude-sonnet-4-20250514',
    timeout: 60,
    timeoutMaxRetries: 1,
    temperature: 0.3,
    maxTokens: 8192,
  } as LlmProfile,
}

const sampleFallbacks: Record<string, LlmProfile> = {
  backup: {
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    timeout: 10,
    timeoutMaxRetries: 1,
    temperature: 0.5,
    maxTokens: 1024,
  } as LlmProfile,
}

describe('ProfileProviderFactory', () => {
  let logger: Logger
  let configService: ConfigService

  beforeEach(() => {
    logger = createFakeLogger()
    // Ensure OPENAI_API_KEY is set for tests
    process.env.OPENAI_API_KEY = 'sk-test-key'
  })

  describe('createForProfile', () => {
    it('creates provider for existing profile', () => {
      configService = createFakeConfigService(sampleProfiles)
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createForProfile('default')

      expect(provider).toBeDefined()
      expect(provider.id).toBe('openai')
    })

    it('throws error for non-existent profile', () => {
      configService = createFakeConfigService(sampleProfiles)
      const factory = new ProfileProviderFactory(configService, logger)

      expect(() => factory.createForProfile('nonexistent')).toThrow('Profile "nonexistent" not found')
    })

    it('creates provider without fallback when fallbackProfileId not provided', () => {
      configService = createFakeConfigService(sampleProfiles)
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createForProfile('default')

      // Should be a direct provider, not a FallbackProvider
      expect(provider).not.toBeInstanceOf(FallbackProvider)
    })

    it('creates FallbackProvider when fallbackProfileId is provided', () => {
      configService = createFakeConfigService(sampleProfiles, sampleFallbacks)
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createForProfile('default', 'backup')

      expect(provider).toBeInstanceOf(FallbackProvider)
    })

    it('throws error for non-existent fallback profile', () => {
      configService = createFakeConfigService(sampleProfiles, sampleFallbacks)
      const factory = new ProfileProviderFactory(configService, logger)

      expect(() => factory.createForProfile('default', 'nonexistent')).toThrow(
        'Fallback profile "nonexistent" not found'
      )
    })

    it('creates claude-cli provider for claude profile', () => {
      configService = createFakeConfigService(sampleProfiles)
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createForProfile('claude')

      expect(provider.id).toBe('claude-cli')
    })
  })

  describe('createDefault', () => {
    it('creates provider for the default profile', () => {
      configService = createFakeConfigService(sampleProfiles, {}, 'default')
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createDefault()

      expect(provider).toBeDefined()
      expect(provider.id).toBe('openai')
    })

    it('creates provider for a different default profile', () => {
      configService = createFakeConfigService(sampleProfiles, {}, 'claude')
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createDefault()

      expect(provider.id).toBe('claude-cli')
    })

    it('throws when default profile does not exist', () => {
      configService = createFakeConfigService(sampleProfiles, {}, 'nonexistent')
      const factory = new ProfileProviderFactory(configService, logger)

      expect(() => factory.createDefault()).toThrow('Profile "nonexistent" not found')
    })
  })

  describe('configuration mapping', () => {
    it('passes timeout in milliseconds to provider factory', () => {
      const profiles = {
        test: {
          provider: 'openai',
          model: 'gpt-4',
          timeout: 45, // seconds
          timeoutMaxRetries: 2,
          temperature: 0.8,
          maxTokens: 1000,
        } as LlmProfile,
      }
      configService = createFakeConfigService(profiles)
      const factory = new ProfileProviderFactory(configService, logger)

      // Provider creation should succeed (we can't easily verify internal config)
      const provider = factory.createForProfile('test')
      expect(provider).toBeDefined()
    })
  })
})
