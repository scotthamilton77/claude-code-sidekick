/**
 * LLM Provider Manager Tests
 *
 * Tests the LLMProviderManager class extracted from Daemon (Step 5).
 * Verifies lazy-init base provider, per-session instrumented providers,
 * profile factory management, and lifecycle operations.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
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

function createMockLogger(): LLMManagerDeps['logger'] {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn().mockReturnThis() as any,
  } as unknown as LLMManagerDeps['logger']
}

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
    logger: createMockLogger(),
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
    mockInstrumentedLLMProvider.initialize.mockClear()
    mockInstrumentedLLMProvider.shutdown.mockClear()
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
      const requestLogger = createMockLogger()
      const manager = new LLMProviderManager(deps)

      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1', requestLogger)

      expect(MockInstrumentedLLMProvider).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ logger: requestLogger })
      )
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

      // Create a provider first
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      mockInstrumentedLLMProvider.shutdown.mockClear()

      // Shutdown it
      await manager.shutdownSessionProvider('session-1')

      expect(mockInstrumentedLLMProvider.shutdown).toHaveBeenCalledOnce()

      // Verify it was removed from cache: next call should create a new one
      MockInstrumentedLLMProvider.mockClear()
      mockInstrumentedLLMProvider.initialize.mockClear()
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
    })

    it('should be a no-op if session provider does not exist', async () => {
      const manager = new LLMProviderManager(createDeps())

      // Should not throw
      await manager.shutdownSessionProvider('nonexistent')

      expect(mockInstrumentedLLMProvider.shutdown).not.toHaveBeenCalled()
    })
  })

  // ── shutdownAll ──────────────────────────────────────────────────────

  describe('shutdownAll', () => {
    it('should shutdown all cached providers and clear map', async () => {
      const manager = new LLMProviderManager(createDeps())

      // Create two providers (note: same mock instance returned, but map tracks by key)
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      mockInstrumentedLLMProvider.shutdown.mockClear()

      await manager.shutdownAll()

      expect(mockInstrumentedLLMProvider.shutdown).toHaveBeenCalledOnce()

      // Verify cache was cleared: next call creates new
      MockInstrumentedLLMProvider.mockClear()
      mockInstrumentedLLMProvider.initialize.mockClear()
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
    })

    it('should be safe to call when no providers exist', async () => {
      const manager = new LLMProviderManager(createDeps())

      // Should not throw
      await manager.shutdownAll()
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

      // Populate the cache
      manager.getBaseProvider()
      mockProfileProviderFactory.createDefault.mockClear()

      // Config change should clear it
      manager.onConfigChange(createMockConfigService())

      // Next call should recreate
      manager.getBaseProvider()
      expect(mockProfileProviderFactory.createDefault).toHaveBeenCalledOnce()
    })

    it('should clear instrumented providers cache', async () => {
      const manager = new LLMProviderManager(createDeps())

      // Populate
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      MockInstrumentedLLMProvider.mockClear()
      mockInstrumentedLLMProvider.initialize.mockClear()

      // Config change
      manager.onConfigChange(createMockConfigService())

      // Next call should create new
      await manager.getOrCreateInstrumentedProvider('session-1', '/tmp/sessions/s1')
      expect(MockInstrumentedLLMProvider).toHaveBeenCalledOnce()
    })
  })
})
