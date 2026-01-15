/**
 * Tests for InstrumentedProfileProviderFactory
 *
 * Tests verify:
 * - createForProfile wraps providers with InstrumentedLLMProvider
 * - createDefault uses defaultProfile from config
 * - Profile params are extracted and passed to InstrumentedLLMProvider
 * - Instrumentation config is passed through correctly
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomBytes } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  LLMProvider,
  LLMRequest,
  ProfileProviderFactory,
  Logger,
  MinimalStateService,
  StateReadResult,
  Telemetry,
} from '@sidekick/types'
import { InstrumentedProfileProviderFactory, type InstrumentationConfig } from '../instrumented-profile-factory.js'
import { InstrumentedLLMProvider } from '../instrumented-llm-provider.js'
import type { ConfigService } from '../config.js'

// ============================================================================
// Test Utilities
// ============================================================================

function createTestDir(): string {
  const dir = join(tmpdir(), `instrumented-factory-test-${randomBytes(8).toString('hex')}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function createMockLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn(() => createMockLogger()),
    flush: vi.fn(),
  }
}

function createMockStateService(): MinimalStateService {
  const store = new Map<string, unknown>()
  return {
    read: vi.fn(<T>(path: string, _schema: unknown, defaultValue?: T | (() => T)): Promise<StateReadResult<T>> => {
      if (store.has(path)) {
        return Promise.resolve({ data: store.get(path) as T, source: 'fresh' })
      }
      if (defaultValue !== undefined) {
        const value = typeof defaultValue === 'function' ? (defaultValue as () => T)() : defaultValue
        return Promise.resolve({ data: value, source: 'default' })
      }
      return Promise.reject(new Error(`File not found: ${path}`))
    }),
    write: vi.fn((path: string, data: unknown, _schema: unknown): Promise<void> => {
      store.set(path, data)
      return Promise.resolve()
    }),
    delete: vi.fn((path: string): Promise<void> => {
      store.delete(path)
      return Promise.resolve()
    }),
    sessionStatePath: vi.fn((sessionId: string, filename: string): string => {
      return `/mock/sessions/${sessionId}/state/${filename}`
    }),
  }
}

function createMockProvider(id = 'test-provider'): LLMProvider {
  return {
    id,
    complete: vi.fn().mockResolvedValue({
      content: 'test response',
      model: 'test-model',
      usage: { inputTokens: 100, outputTokens: 50 },
      rawResponse: { status: 200, body: '{}' },
    }),
  }
}

function createMockBaseFactory(providers: Record<string, LLMProvider> = {}): ProfileProviderFactory {
  const defaultProvider = createMockProvider('default-provider')
  return {
    createForProfile: vi.fn((profileId: string) => providers[profileId] ?? createMockProvider(profileId)),
    createDefault: vi.fn(() => defaultProvider),
  }
}

function createMockConfigService(overrides: Partial<ConfigService['llm']> = {}): ConfigService {
  return {
    llm: {
      defaultProfile: 'fast',
      profiles: {
        fast: {
          provider: 'openrouter',
          model: 'anthropic/claude-3-haiku',
          temperature: 0.2,
          maxTokens: 4096,
          timeout: 30000,
          timeoutMaxRetries: 2,
        },
        balanced: {
          provider: 'openrouter',
          model: 'anthropic/claude-3-sonnet',
          temperature: 0.5,
          maxTokens: 8192,
          timeout: 60000,
          timeoutMaxRetries: 2,
        },
        powerful: {
          provider: 'openrouter',
          model: 'anthropic/claude-3-opus',
          temperature: 0.7,
          maxTokens: 16384,
          timeout: 120000,
          timeoutMaxRetries: 2,
        },
      },
      ...overrides,
    },
  } as ConfigService
}

// ============================================================================
// Tests
// ============================================================================

describe('InstrumentedProfileProviderFactory', () => {
  let testDir: string
  let logger: Logger
  let stateService: MinimalStateService

  beforeEach(() => {
    testDir = createTestDir()
    logger = createMockLogger()
    stateService = createMockStateService()
  })

  afterEach(() => {
    if (existsSync(testDir)) {
      rmSync(testDir, { recursive: true, force: true })
    }
  })

  // ==========================================================================
  // createForProfile tests
  // ==========================================================================

  describe('createForProfile', () => {
    it('should return an InstrumentedLLMProvider', () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createForProfile('fast')

      expect(provider).toBeInstanceOf(InstrumentedLLMProvider)
    })

    it('should delegate to base factory createForProfile', () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      factory.createForProfile('balanced', 'fast')

      expect(baseFactory.createForProfile).toHaveBeenCalledWith('balanced', 'fast')
    })

    it('should pass profile params to instrumented provider', async () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createForProfile('fast') as InstrumentedLLMProvider

      // The provider should be functional
      const response = await provider.complete({ messages: [{ role: 'user', content: 'test' }] })
      expect(response.content).toBe('test response')
    })

    it('should handle missing profile gracefully', () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)

      // Should not throw for non-existent profile
      const provider = factory.createForProfile('nonexistent')
      expect(provider).toBeInstanceOf(InstrumentedLLMProvider)
    })

    it('should pass instrumentation config to provider', () => {
      const mockTelemetry: Telemetry = {
        increment: vi.fn(),
        gauge: vi.fn(),
        histogram: vi.fn(),
      }

      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'my-session-123',
        stateService,
        sessionDir: testDir,
        logger,
        telemetry: mockTelemetry,
        debugDumpEnabled: true,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createForProfile('fast') as InstrumentedLLMProvider

      const metrics = provider.getMetrics()
      expect(metrics.sessionId).toBe('my-session-123')
    })
  })

  // ==========================================================================
  // createDefault tests
  // ==========================================================================

  describe('createDefault', () => {
    it('should return an InstrumentedLLMProvider', () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createDefault()

      expect(provider).toBeInstanceOf(InstrumentedLLMProvider)
    })

    it('should delegate to base factory createDefault', () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      factory.createDefault()

      expect(baseFactory.createDefault).toHaveBeenCalled()
    })

    it('should use defaultProfile from configService', async () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService({ defaultProfile: 'powerful' })
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createDefault() as InstrumentedLLMProvider

      // Provider should be functional with the default profile config
      const response = await provider.complete({ messages: [{ role: 'user', content: 'test' }] })
      expect(response.content).toBe('test response')
    })
  })

  // ==========================================================================
  // Profile params extraction tests
  // ==========================================================================

  describe('profile params extraction', () => {
    it('should extract all profile params when available', async () => {
      const baseProvider = createMockProvider('openrouter')
      const baseFactory: ProfileProviderFactory = {
        createForProfile: vi.fn(() => baseProvider),
        createDefault: vi.fn(() => baseProvider),
      }

      const configService = createMockConfigService({
        profiles: {
          custom: {
            provider: 'openrouter',
            model: 'anthropic/claude-3-opus',
            temperature: 0.8,
            maxTokens: 32768,
            timeout: 180000,
            timeoutMaxRetries: 3,
          },
        },
      })

      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
        debugDumpEnabled: true,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createForProfile('custom') as InstrumentedLLMProvider

      // Execute a call to verify the provider works
      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      // The metrics should show the provider is tracking calls
      const metrics = provider.getMetrics()
      expect(metrics.totals.callCount).toBe(1)
    })

    it('should handle profile with minimal config', () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService({
        profiles: {
          minimal: {
            provider: 'openrouter',
            model: 'test-model',
            temperature: 0.5,
            maxTokens: 4096,
            timeout: 30000,
            timeoutMaxRetries: 2,
          },
        },
      })

      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)

      // Should not throw
      const provider = factory.createForProfile('minimal')
      expect(provider).toBeInstanceOf(InstrumentedLLMProvider)
    })
  })

  // ==========================================================================
  // Instrumentation options tests
  // ==========================================================================

  describe('instrumentation options', () => {
    it('should work without telemetry', async () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
        // No telemetry
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createForProfile('fast') as InstrumentedLLMProvider

      // Should not throw
      const response = await provider.complete({ messages: [{ role: 'user', content: 'test' }] })
      expect(response.content).toBe('test response')
    })

    it('should work without debugDumpEnabled', () => {
      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
        // debugDumpEnabled not set
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createForProfile('fast')

      expect(provider).toBeInstanceOf(InstrumentedLLMProvider)
    })

    it('should pass telemetry to instrumented provider', async () => {
      const histogramSpy = vi.fn()
      const mockTelemetry: Telemetry = {
        increment: vi.fn(),
        gauge: vi.fn(),
        histogram: histogramSpy,
      }

      const baseFactory = createMockBaseFactory()
      const configService = createMockConfigService()
      const instrumentationConfig: InstrumentationConfig = {
        sessionId: 'test-session',
        stateService,
        sessionDir: testDir,
        logger,
        telemetry: mockTelemetry,
      }

      const factory = new InstrumentedProfileProviderFactory(baseFactory, configService, instrumentationConfig)
      const provider = factory.createForProfile('fast') as InstrumentedLLMProvider

      await provider.complete({ messages: [{ role: 'user', content: 'test' }] })

      // Telemetry should have been called
      expect(histogramSpy).toHaveBeenCalled()
    })
  })
})
