import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeLogger } from '@sidekick/testing-fixtures'
import { LLMProviderManager, type LLMManagerDeps } from '../daemon-llm-manager.js'

// ── Hoisted mock constructors ────────────────────────────────────────────

const {
  mockProfileProviderFactory,
  MockProfileProviderFactory,
  mockInstrumentedLLMProvider,
  MockInstrumentedLLMProvider,
  MockInstrumentedProfileProviderFactory,
} = vi.hoisted(() => {
  const mockBaseProvider = { id: 'mock-base', complete: vi.fn() }

  const mockProfileProviderFactory = {
    createDefault: vi.fn().mockReturnValue(mockBaseProvider),
    createForProfile: vi.fn().mockReturnValue(mockBaseProvider),
  }
  const MockProfileProviderFactory = vi.fn().mockImplementation(function () {
    return mockProfileProviderFactory
  })

  const mockInstrumentedLLMProvider = {
    id: 'mock-instrumented',
    complete: vi.fn(),
    initialize: vi.fn().mockResolvedValue(undefined),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }
  const MockInstrumentedLLMProvider = vi.fn().mockImplementation(function () {
    return mockInstrumentedLLMProvider
  })

  const MockInstrumentedProfileProviderFactory = vi.fn().mockImplementation(function () {
    return { createDefault: vi.fn(), createForProfile: vi.fn() }
  })

  return {
    mockProfileProviderFactory,
    MockProfileProviderFactory,
    mockInstrumentedLLMProvider,
    MockInstrumentedLLMProvider,
    MockInstrumentedProfileProviderFactory,
  }
})

vi.mock('@sidekick/shared-providers', () => ({
  ProfileProviderFactory: MockProfileProviderFactory,
}))

vi.mock('@sidekick/core', () => ({
  InstrumentedLLMProvider: MockInstrumentedLLMProvider,
  InstrumentedProfileProviderFactory: MockInstrumentedProfileProviderFactory,
}))

// ── Helpers ──────────────────────────────────────────────────────────────

function createMockConfigService(): LLMManagerDeps['configService'] {
  return {
    llm: {
      defaultProfile: 'default',
      defaultFallbackProfileId: undefined,
      profiles: {
        default: {
          provider: 'openrouter',
          model: 'test-model',
          temperature: 0.7,
          maxTokens: 1024,
          timeout: 30,
        },
      },
      fallbackProfiles: {},
      global: {
        debugDumpEnabled: false,
      },
    },
    core: {
      logging: { level: 'info', components: {} },
      development: { enabled: false },
    },
    getAll: vi.fn().mockReturnValue({}),
    getFeature: vi.fn().mockReturnValue({}),
  } as unknown as LLMManagerDeps['configService']
}

function createMockStateService(): LLMManagerDeps['stateService'] {
  return {
    sessionRootDir: vi.fn().mockReturnValue('/tmp/sessions/test-session'),
  } as unknown as LLMManagerDeps['stateService']
}

function createDeps(overrides?: Partial<LLMManagerDeps>): LLMManagerDeps {
  return {
    configService: createMockConfigService(),
    stateService: createMockStateService(),
    logger: createFakeLogger(),
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('LLMProviderManager', () => {
  beforeEach(() => {
    MockProfileProviderFactory.mockClear()
    mockProfileProviderFactory.createDefault.mockClear()
    mockProfileProviderFactory.createForProfile.mockClear()
    MockInstrumentedLLMProvider.mockClear()
    mockInstrumentedLLMProvider.initialize.mockReset().mockResolvedValue(undefined)
    mockInstrumentedLLMProvider.shutdown.mockReset().mockResolvedValue(undefined)
    MockInstrumentedProfileProviderFactory.mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // ── getBaseProvider ──────────────────────────────────────────────────

  describe('getBaseProvider', () => {
    it('should lazy-init base provider on first call', () => {
      const manager = new LLMProviderManager(createDeps())

      const provider = manager.getBaseProvider()

      expect(mockProfileProviderFactory.createDefault).toHaveBeenCalledOnce()
      expect(provider).toBeDefined()
      expect(provider.id).toBe('mock-base')
    })

    it('should return cached provider on second call', () => {
      const manager = new LLMProviderManager(createDeps())

      const first = manager.getBaseProvider()
      const second = manager.getBaseProvider()

      expect(first).toBe(second)
      expect(mockProfileProviderFactory.createDefault).toHaveBeenCalledOnce()
    })
  })

  // ── getOrCreateInstrumentedProvider ──────────────────────────────────

  describe('getOrCreateInstrumentedProvider', () => {
    it('should create instrumented provider on first call', async () => {
      const manager = new LLMProviderManager(createDeps())

      const provider = await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')

      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
      expect(mockInstrumentedLLMProvider.initialize).toHaveBeenCalledOnce()
      expect(provider).toBe(mockInstrumentedLLMProvider)
    })

    it('should return cached provider on second call', async () => {
      const manager = new LLMProviderManager(createDeps())

      const first = await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      const second = await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')

      expect(first).toBe(second)
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
      expect(mockInstrumentedLLMProvider.initialize).toHaveBeenCalledOnce()
    })

    it('should pass correct config to InstrumentedLLMProvider constructor', async () => {
      const deps = createDeps()
      const manager = new LLMProviderManager(deps)

      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')

      expect(MockInstrumentedLLMProvider).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'mock-base' }),
        expect.objectContaining({
          sessionId: 'session-1',
          stateService: deps.stateService,
          sessionDir: '/tmp/sessions/s1',
          debugDumpEnabled: false,
          profileParams: expect.objectContaining({
            profileName: 'default',
            temperature: 0.7,
            maxTokens: 1024,
            timeout: 30,
          }),
        })
      )
    })

    it('should use request-scoped logger when provided', async () => {
      const deps = createDeps()
      const requestLogger = createFakeLogger()
      const manager = new LLMProviderManager(deps)

      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1', requestLogger)

      expect(MockInstrumentedLLMProvider).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ logger: requestLogger })
      )
    })

    it('should coalesce concurrent calls for the same sessionId', async () => {
      const manager = new LLMProviderManager(createDeps())

      // Launch two concurrent calls — only one provider should be created
      const [first, second] = await Promise.all([
        manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1'),
        manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1'),
      ])

      expect(first).toBe(second)
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
      expect(mockInstrumentedLLMProvider.initialize).toHaveBeenCalledOnce()
    })

    it('should omit profileParams when default profile not found', async () => {
      const configService = createMockConfigService()
      ;(configService as any).llm.profiles = {} // no default profile
      const manager = new LLMProviderManager(createDeps({ configService }))

      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')

      expect(MockInstrumentedLLMProvider).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ profileParams: undefined })
      )
    })
  })

  // ── createInstrumentedProfileFactory ─────────────────────────────────

  describe('createInstrumentedProfileFactory', () => {
    it('should create InstrumentedProfileProviderFactory with correct config', () => {
      const deps = createDeps()
      const manager = new LLMProviderManager(deps)

      const factory = manager.createInstrumentedProfileFactory('session-1', '/tmp/sessions/s1')

      expect(factory).toBeDefined()
      expect(MockInstrumentedProfileProviderFactory).toHaveBeenCalledWith(
        mockProfileProviderFactory,
        deps.configService,
        expect.objectContaining({
          sessionId: 'session-1',
          stateService: deps.stateService,
          sessionDir: '/tmp/sessions/s1',
          debugDumpEnabled: false,
        })
      )
    })
  })

  // ── getProfileFactory ────────────────────────────────────────────────

  describe('getProfileFactory', () => {
    it('should return the base ProfileProviderFactory', () => {
      const manager = new LLMProviderManager(createDeps())

      const factory = manager.getProfileFactory()

      expect(factory).toBe(mockProfileProviderFactory)
    })
  })

  // ── shutdownSessionProvider ──────────────────────────────────────────

  describe('shutdownSessionProvider', () => {
    it('should shutdown and remove a cached session provider', async () => {
      const manager = new LLMProviderManager(createDeps())
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      mockInstrumentedLLMProvider.shutdown.mockClear()

      await manager.shutdownSessionProvider('session-1')

      expect(mockInstrumentedLLMProvider.shutdown).toHaveBeenCalledOnce()

      // Next call should create a new provider (cache was cleared)
      MockInstrumentedLLMProvider.mockClear()
      mockInstrumentedLLMProvider.initialize.mockClear()
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
    })

    it('should be a no-op if session provider does not exist', async () => {
      const manager = new LLMProviderManager(createDeps())

      await manager.shutdownSessionProvider('nonexistent')

      expect(mockInstrumentedLLMProvider.shutdown).not.toHaveBeenCalled()
    })

    it('should await in-flight init and then shutdown the provider', async () => {
      const manager = new LLMProviderManager(createDeps())

      // Make initialize() hang until we release it
      let resolveInit!: () => void
      mockInstrumentedLLMProvider.initialize.mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveInit = r
          })
      )

      // Start init — it will be stuck in inflightInits
      const initPromise = manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')

      // Shutdown while init is in flight — should await the init, then shutdown
      const shutdownPromise = manager.shutdownSessionProvider('session-1')

      // Release the init
      resolveInit()

      // Both should complete — init succeeds, then shutdown cleans it up
      await initPromise
      await shutdownPromise

      expect(mockInstrumentedLLMProvider.shutdown).toHaveBeenCalledOnce()
    })

    it('should handle in-flight init failure gracefully during shutdown', async () => {
      const manager = new LLMProviderManager(createDeps())

      // Make initialize() fail
      mockInstrumentedLLMProvider.initialize.mockRejectedValue(new Error('init failed'))

      // Start init — it will be stuck in inflightInits until rejection
      const initPromise = manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')

      // Shutdown while init is in flight
      const shutdownPromise = manager.shutdownSessionProvider('session-1')

      // Init promise rejects, shutdown should handle it gracefully
      await expect(initPromise).rejects.toThrow('init failed')
      await shutdownPromise // should NOT throw

      // No provider was cached, so shutdown was never called on it
      expect(mockInstrumentedLLMProvider.shutdown).not.toHaveBeenCalled()
    })
  })

  // ── shutdownAll ──────────────────────────────────────────────────────

  describe('shutdownAll', () => {
    it('should shutdown all cached providers and clear map', async () => {
      const manager = new LLMProviderManager(createDeps())
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      mockInstrumentedLLMProvider.shutdown.mockClear()

      await manager.shutdownAll()

      expect(mockInstrumentedLLMProvider.shutdown).toHaveBeenCalledOnce()

      // Next call should create a new provider (cache was cleared)
      MockInstrumentedLLMProvider.mockClear()
      mockInstrumentedLLMProvider.initialize.mockClear()
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
    })

    it('should be safe to call when no providers exist', async () => {
      const manager = new LLMProviderManager(createDeps())
      await manager.shutdownAll()
    })

    it('should continue shutting down remaining providers when one fails', async () => {
      const deps = createDeps()
      const manager = new LLMProviderManager(deps)

      // Create distinct mock providers so two sessions get independent instances
      const provider1 = {
        initialize: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockRejectedValue(new Error('shutdown failed')),
      }
      const provider2 = {
        initialize: vi.fn().mockResolvedValue(undefined),
        shutdown: vi.fn().mockResolvedValue(undefined),
      }
      MockInstrumentedLLMProvider.mockImplementationOnce(function () {
        return provider1
      }).mockImplementationOnce(function () {
        return provider2
      })

      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/s1')
      await manager.getOrCreateInstrumentedProvider('session-2', '/tmp/s2')

      await expect(manager.shutdownAll()).rejects.toThrow('shutdown failed')
      expect(provider1.shutdown).toHaveBeenCalledOnce()
      expect(provider2.shutdown).toHaveBeenCalledOnce()
      expect(deps.logger.error as any).toHaveBeenCalledWith(
        'Failed to shutdown instrumented LLM provider',
        expect.objectContaining({ sessionId: 'session-1' })
      )
    })
  })

  // ── onConfigChange ───────────────────────────────────────────────────

  describe('onConfigChange', () => {
    it('should recreate profile factory with new config', () => {
      const manager = new LLMProviderManager(createDeps())
      MockProfileProviderFactory.mockClear()

      const newConfig = createMockConfigService()
      manager.onConfigChange(newConfig)

      expect(MockProfileProviderFactory).toHaveBeenCalledOnce()
      expect(MockProfileProviderFactory).toHaveBeenCalledWith(newConfig, expect.anything())
    })

    it('should clear base provider cache (next call recreates)', () => {
      const manager = new LLMProviderManager(createDeps())
      manager.getBaseProvider()
      mockProfileProviderFactory.createDefault.mockClear()

      manager.onConfigChange(createMockConfigService())

      manager.getBaseProvider()
      expect(mockProfileProviderFactory.createDefault).toHaveBeenCalledOnce()
    })

    it('should clear instrumented providers cache', async () => {
      const manager = new LLMProviderManager(createDeps())
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      MockInstrumentedLLMProvider.mockClear()
      mockInstrumentedLLMProvider.initialize.mockClear()

      manager.onConfigChange(createMockConfigService())

      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
    })

    it('should fire-and-forget shutdown stale providers', async () => {
      const manager = new LLMProviderManager(createDeps())
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      mockInstrumentedLLMProvider.shutdown.mockClear()

      manager.onConfigChange(createMockConfigService())

      // Give the fire-and-forget promise a tick to resolve
      await new Promise((r) => setImmediate(r))
      expect(mockInstrumentedLLMProvider.shutdown).toHaveBeenCalledOnce()
    })

    it('should discard provider initialized after config change', async () => {
      const manager = new LLMProviderManager(createDeps())

      // Make initialize() slow enough to interleave with config change
      let resolveInit!: () => void
      mockInstrumentedLLMProvider.initialize.mockImplementation(
        () =>
          new Promise<void>((r) => {
            resolveInit = r
          })
      )

      // Start init (will be awaiting initialize())
      const initPromise = manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')

      // Config change while init is in flight
      manager.onConfigChange(createMockConfigService())

      // Complete the init — provider should be discarded, not cached
      resolveInit()

      // The init should throw because configGeneration changed
      await expect(initPromise).rejects.toThrow('Config changed during provider init')

      // Next call should create a NEW provider (nothing cached from the stale init)
      MockInstrumentedLLMProvider.mockClear()
      mockInstrumentedLLMProvider.initialize.mockResolvedValue(undefined)
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
    })
  })
})
