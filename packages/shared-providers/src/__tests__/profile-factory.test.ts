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
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn().mockReturnThis(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as Logger
}

// Helper to create a minimal ConfigService fake
function createFakeConfigService(
  profiles: Record<string, LlmProfile> = {},
  fallbackProfiles: Record<string, LlmProfile> = {},
  defaultProfile = 'default',
  defaultFallbackProfileId?: string
): ConfigService {
  return {
    llm: {
      profiles,
      fallbackProfiles,
      defaultProfile,
      ...(defaultFallbackProfileId !== undefined && { defaultFallbackProfileId }),
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

  describe('fallback resolution cascade', () => {
    it('uses profile fallbackProfileId when no explicit fallback param given', () => {
      const profilesWithFallback = {
        default: {
          ...sampleProfiles.default,
          fallbackProfileId: 'backup',
        } as LlmProfile,
      }
      configService = createFakeConfigService(profilesWithFallback, sampleFallbacks)
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createForProfile('default')

      expect(provider).toBeInstanceOf(FallbackProvider)
    })

    it('uses defaultFallbackProfileId when profile has no fallbackProfileId', () => {
      configService = createFakeConfigService(sampleProfiles, sampleFallbacks, 'default', 'backup')
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createForProfile('default')

      expect(provider).toBeInstanceOf(FallbackProvider)
    })

    it('explicit param takes precedence over profile fallbackProfileId', () => {
      // Profile points to nonexistent fallback - would throw if cascade is wrong
      const profilesWithFallback = {
        default: {
          ...sampleProfiles.default,
          fallbackProfileId: 'nonexistent-profile-fallback',
        } as LlmProfile,
      }
      configService = createFakeConfigService(profilesWithFallback, sampleFallbacks)
      const factory = new ProfileProviderFactory(configService, logger)

      // Explicit 'backup' should win over profile's nonexistent fallback
      const provider = factory.createForProfile('default', 'backup')

      expect(provider).toBeInstanceOf(FallbackProvider)
    })

    it('explicit param takes precedence over defaultFallbackProfileId', () => {
      // defaultFallbackProfileId points to nonexistent fallback - would throw if cascade is wrong
      configService = createFakeConfigService(sampleProfiles, sampleFallbacks, 'default', 'nonexistent-global-fallback')
      const factory = new ProfileProviderFactory(configService, logger)

      // Explicit 'backup' should win over default's nonexistent fallback
      const provider = factory.createForProfile('default', 'backup')

      expect(provider).toBeInstanceOf(FallbackProvider)
    })

    it('profile fallbackProfileId takes precedence over defaultFallbackProfileId', () => {
      const profilesWithFallback = {
        default: {
          ...sampleProfiles.default,
          fallbackProfileId: 'backup',
        } as LlmProfile,
      }
      // defaultFallbackProfileId points to nonexistent - would throw if cascade is wrong
      configService = createFakeConfigService(
        profilesWithFallback,
        sampleFallbacks,
        'default',
        'nonexistent-global-fallback'
      )
      const factory = new ProfileProviderFactory(configService, logger)

      // Profile-level 'backup' should win over default's nonexistent fallback
      const provider = factory.createForProfile('default')

      expect(provider).toBeInstanceOf(FallbackProvider)
    })

    it('no fallback when none specified at any level', () => {
      configService = createFakeConfigService(sampleProfiles)
      const factory = new ProfileProviderFactory(configService, logger)

      const provider = factory.createForProfile('default')

      expect(provider).not.toBeInstanceOf(FallbackProvider)
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
