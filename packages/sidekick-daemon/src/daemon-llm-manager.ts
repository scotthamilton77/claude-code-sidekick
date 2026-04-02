/**
 * Manages LLM provider lifecycle: base provider lazy-init,
 * per-session instrumented providers, and profile factories.
 */
import type { ConfigService, Logger, StateService } from '@sidekick/core'
import { InstrumentedLLMProvider, InstrumentedProfileProviderFactory } from '@sidekick/core'
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
  /** In-flight init promises to coalesce concurrent getOrCreate calls for the same session. */
  private inflightInits = new Map<string, Promise<InstrumentedLLMProvider>>()
  /** Monotonic counter incremented on config change; lets in-flight inits detect staleness. */
  private configGeneration = 0

  private configService: ConfigService
  private readonly stateService: StateService
  private readonly logger: Logger

  constructor(deps: LLMManagerDeps) {
    this.configService = deps.configService
    this.stateService = deps.stateService
    this.logger = deps.logger
    this.profileProviderFactory = new ProfileProviderFactory(this.configService, this.logger)
  }

  getBaseProvider(): LLMProvider {
    this.llmProvider ??= this.profileProviderFactory.createDefault()
    return this.llmProvider
  }

  async getOrCreateInstrumentedProvider(
    sessionId: string,
    sessionDir: string,
    logger?: Logger
  ): Promise<InstrumentedLLMProvider> {
    const existing = this.instrumentedProviders.get(sessionId)
    if (existing) return existing

    const inflight = this.inflightInits.get(sessionId)
    if (inflight) return inflight

    const initPromise = this.initInstrumentedProvider(sessionId, sessionDir, logger)
    this.inflightInits.set(sessionId, initPromise)

    try {
      const provider = await initPromise
      return provider
    } finally {
      this.inflightInits.delete(sessionId)
    }
  }

  private async initInstrumentedProvider(
    sessionId: string,
    sessionDir: string,
    logger?: Logger
  ): Promise<InstrumentedLLMProvider> {
    const log = logger ?? this.logger
    const gen = this.configGeneration
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

    // Config changed while we were awaiting — discard the stale provider
    if (gen !== this.configGeneration) {
      void instrumented.shutdown().catch((err: unknown) => {
        log.error('Failed to shutdown stale in-flight provider', { sessionId, error: err })
      })
      throw new Error(`Config changed during provider init for session ${sessionId}`)
    }

    this.instrumentedProviders.set(sessionId, instrumented)
    log.debug('Created instrumented LLM provider', { sessionId })

    return instrumented
  }

  createInstrumentedProfileFactory(sessionId: string, sessionDir: string): InstrumentedProfileProviderFactory {
    return new InstrumentedProfileProviderFactory(this.profileProviderFactory, this.configService, {
      sessionId,
      stateService: this.stateService,
      sessionDir,
      logger: this.logger,
      debugDumpEnabled: this.configService.llm.global.debugDumpEnabled,
    })
  }

  getProfileFactory(): ProfileProviderFactory {
    return this.profileProviderFactory
  }

  /** Flushes pending metrics before removing the session's instrumented provider. */
  async shutdownSessionProvider(sessionId: string, logger?: Logger): Promise<void> {
    // Await any in-flight init before checking cache — otherwise the init
    // completes after we return and caches a provider that outlives the session.
    const inflight = this.inflightInits.get(sessionId)
    if (inflight) {
      try {
        await inflight
      } catch {
        /* init failed — nothing to shutdown */
      }
    }

    const provider = this.instrumentedProviders.get(sessionId)
    if (!provider) return

    await provider.shutdown()
    this.instrumentedProviders.delete(sessionId)
    ;(logger ?? this.logger).debug('Shutdown instrumented LLM provider', { sessionId })
  }

  /** Flushes pending metrics for all providers. Continues on per-provider failure. */
  async shutdownAll(): Promise<void> {
    let firstError: Error | undefined
    for (const [sessionId, provider] of this.instrumentedProviders) {
      try {
        await provider.shutdown()
        this.logger.debug('Shutdown instrumented LLM provider', { sessionId })
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err))
        firstError ??= error
        this.logger.error('Failed to shutdown instrumented LLM provider', { sessionId, error })
      }
    }
    this.instrumentedProviders.clear()
    if (firstError) throw firstError
  }

  /**
   * Recreate profile factory and clear caches on config change.
   * The old factory held stale configService references, so changes
   * (providerAllowlist, temperature, etc.) wouldn't be picked up.
   * Existing providers are shut down fire-and-forget to flush metrics.
   */
  onConfigChange(newConfigService: ConfigService): void {
    const staleProviders = Array.from(this.instrumentedProviders.entries())

    this.configGeneration++
    this.configService = newConfigService
    this.profileProviderFactory = new ProfileProviderFactory(this.configService, this.logger)
    this.llmProvider = null
    this.instrumentedProviders.clear()
    this.inflightInits.clear()

    for (const [sessionId, provider] of staleProviders) {
      void provider.shutdown().catch((err) => {
        this.logger.error('Failed to shutdown stale LLM provider during config change', { sessionId, error: err })
      })
    }
  }
}
