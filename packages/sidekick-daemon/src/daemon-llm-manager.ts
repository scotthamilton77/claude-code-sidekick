/**
 * Manages LLM provider lifecycle: base provider lazy-init,
 * per-session instrumented providers, and profile factories.
 */
import type { ConfigService, Logger } from '@sidekick/core'
import { InstrumentedLLMProvider, InstrumentedProfileProviderFactory } from '@sidekick/core'
import type { StateService } from '@sidekick/core'
import { ProfileProviderFactory, type LLMProvider } from '@sidekick/shared-providers'

export interface LLMManagerDeps {
  configService: ConfigService
  stateService: StateService
  logger: Logger
}

export class LLMProviderManager {
  private llmProvider: LLMProvider | null = null
  private profileProviderFactory: ProfileProviderFactory
  private instrumentedProviders = new Map<string, InstrumentedLLMProvider>()

  private configService: ConfigService
  private stateService: StateService
  private logger: Logger

  constructor(deps: LLMManagerDeps) {
    this.configService = deps.configService
    this.stateService = deps.stateService
    this.logger = deps.logger
    this.profileProviderFactory = new ProfileProviderFactory(this.configService, this.logger)
  }

  /**
   * Lazy-init base LLM provider from the default profile.
   * Returns the cached instance on subsequent calls.
   */
  getBaseProvider(): LLMProvider {
    if (!this.llmProvider) {
      this.llmProvider = this.profileProviderFactory.createDefault()
    }
    return this.llmProvider
  }

  /**
   * Get or create an instrumented LLM provider for a session.
   * Creates on first call, returns cached instance on subsequent calls.
   *
   * @param sessionId - Session ID for metrics tracking
   * @param sessionDir - Path to session directory (parent of state dir)
   * @param logger - Optional request-scoped logger (falls back to daemon logger)
   */
  async getOrCreateInstrumentedProvider(
    sessionId: string,
    sessionDir: string,
    logger?: Logger
  ): Promise<InstrumentedLLMProvider> {
    const existing = this.instrumentedProviders.get(sessionId)
    if (existing) {
      return existing
    }

    const log = logger ?? this.logger
    const baseProvider = this.getBaseProvider()
    const defaultProfile = this.configService.llm.profiles[this.configService.llm.defaultProfile]

    const instrumented = new InstrumentedLLMProvider(baseProvider, {
      sessionId,
      stateService: this.stateService,
      sessionDir,
      logger: log,
      debugDumpEnabled: this.configService.llm.global.debugDumpEnabled,
      profileParams: defaultProfile
        ? {
            profileName: this.configService.llm.defaultProfile,
            temperature: defaultProfile.temperature,
            maxTokens: defaultProfile.maxTokens,
            timeout: defaultProfile.timeout,
          }
        : undefined,
    })

    await instrumented.initialize()
    this.instrumentedProviders.set(sessionId, instrumented)
    log.debug('Created instrumented LLM provider', { sessionId })

    return instrumented
  }

  /**
   * Create an instrumented profile factory for a session.
   * All providers created through this factory will be wrapped with instrumentation.
   *
   * @param sessionId - Session ID for metrics tracking
   * @param sessionDir - Path to session directory (parent of state dir)
   */
  createInstrumentedProfileFactory(sessionId: string, sessionDir: string): InstrumentedProfileProviderFactory {
    return new InstrumentedProfileProviderFactory(this.profileProviderFactory, this.configService, {
      sessionId,
      stateService: this.stateService,
      sessionDir,
      logger: this.logger,
      debugDumpEnabled: this.configService.llm.global.debugDumpEnabled,
    })
  }

  /**
   * Get the base profile provider factory.
   * Used by registration contexts that need a ProfileProviderFactory.
   */
  getProfileFactory(): ProfileProviderFactory {
    return this.profileProviderFactory
  }

  /**
   * Shutdown an instrumented provider for a session and remove from cache.
   * Called on SessionEnd to persist final metrics.
   */
  async shutdownSessionProvider(sessionId: string, logger?: Logger): Promise<void> {
    const log = logger ?? this.logger
    const provider = this.instrumentedProviders.get(sessionId)
    if (provider) {
      await provider.shutdown()
      this.instrumentedProviders.delete(sessionId)
      log.debug('Shutdown instrumented LLM provider', { sessionId })
    }
  }

  /**
   * Shutdown all instrumented providers and clear cache.
   * Called during daemon stop to persist final metrics.
   */
  async shutdownAll(): Promise<void> {
    for (const [sessionId, provider] of this.instrumentedProviders) {
      await provider.shutdown()
      this.logger.debug('Shutdown instrumented LLM provider', { sessionId })
    }
    this.instrumentedProviders.clear()
  }

  /**
   * Handle config change: recreate profile factory, clear caches.
   * The old factory held a reference to the old configService, so changes
   * (providerAllowlist, temperature, etc.) wouldn't be picked up.
   */
  onConfigChange(newConfigService: ConfigService): void {
    this.configService = newConfigService
    this.profileProviderFactory = new ProfileProviderFactory(this.configService, this.logger)
    this.llmProvider = null
    this.instrumentedProviders.clear()
  }
}
