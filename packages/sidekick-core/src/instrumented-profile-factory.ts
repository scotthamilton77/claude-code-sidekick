/**
 * Instrumented Profile Provider Factory
 *
 * Wraps a ProfileProviderFactory to automatically instrument all providers
 * with session-specific metrics tracking and debug dump capabilities.
 */

import type { Logger, LLMProvider, ProfileProviderFactory, Telemetry } from '@sidekick/types'
import type { ConfigService } from './config'
import { InstrumentedLLMProvider, type LLMProfileParams } from './instrumented-llm-provider'

/**
 * Configuration for instrumenting providers created by the factory.
 */
export interface InstrumentationConfig {
  /** Session identifier */
  sessionId: string
  /** Path to session state directory */
  stateDir: string
  /** Logger instance */
  logger: Logger
  /** Telemetry instance for emitting metrics (optional) */
  telemetry?: Telemetry
  /** Enable debug dump of LLM requests/responses to session directory */
  debugDumpEnabled?: boolean
}

/**
 * Factory wrapper that instruments all providers with session tracking.
 *
 * Every provider created through this factory is automatically wrapped with
 * InstrumentedLLMProvider, which provides:
 * - Per-session metrics tracking (call counts, token usage, latency)
 * - Debug dump of LLM requests/responses (when enabled)
 * - Telemetry emission (when configured)
 *
 * @example
 * ```typescript
 * const baseFactory = new ProfileProviderFactory(configService, logger)
 * const instrumentedFactory = new InstrumentedProfileProviderFactory(
 *   baseFactory,
 *   configService,
 *   {
 *     sessionId: 'abc-123',
 *     stateDir: '.sidekick/sessions/abc-123/state',
 *     logger,
 *     debugDumpEnabled: true,
 *   }
 * )
 *
 * // All providers are now instrumented
 * const provider = instrumentedFactory.createForProfile('fast')
 * ```
 */
export class InstrumentedProfileProviderFactory implements ProfileProviderFactory {
  constructor(
    private readonly baseFactory: ProfileProviderFactory,
    private readonly configService: ConfigService,
    private readonly config: InstrumentationConfig
  ) {}

  /**
   * Creates an instrumented provider for a named profile.
   */
  createForProfile(profileId: string, fallbackProfileId?: string): LLMProvider {
    const baseProvider = this.baseFactory.createForProfile(profileId, fallbackProfileId)
    return this.wrapProvider(baseProvider, profileId)
  }

  /**
   * Creates an instrumented provider using the default profile.
   */
  createDefault(): LLMProvider {
    const { defaultProfile } = this.configService.llm
    const baseProvider = this.baseFactory.createDefault()
    return this.wrapProvider(baseProvider, defaultProfile)
  }

  /**
   * Wraps a provider with instrumentation.
   */
  private wrapProvider(provider: LLMProvider, profileId: string): LLMProvider {
    const profile = this.configService.llm.profiles[profileId]
    const profileParams: LLMProfileParams | undefined = profile
      ? {
          profileName: profileId,
          provider: profile.provider,
          model: profile.model,
          temperature: profile.temperature,
          maxTokens: profile.maxTokens,
          timeout: profile.timeout,
        }
      : undefined

    return new InstrumentedLLMProvider(provider, {
      sessionId: this.config.sessionId,
      stateDir: this.config.stateDir,
      logger: this.config.logger,
      telemetry: this.config.telemetry,
      debugDumpEnabled: this.config.debugDumpEnabled,
      profileParams,
    })
  }
}
