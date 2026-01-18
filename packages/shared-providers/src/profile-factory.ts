/**
 * Profile Provider Factory
 *
 * Creates LLM providers from profile configurations.
 * Reads config at call time to enable runtime tunability.
 */

import type { Logger, LLMProvider } from '@sidekick/types'
import type { ConfigService, LlmProfile } from '@sidekick/core'
import { ProviderFactory, type ProviderType } from './factory'
import { FallbackProvider } from './fallback'

export class ProfileProviderFactory {
  constructor(
    private readonly configService: ConfigService,
    private readonly logger: Logger
  ) {}

  /**
   * Creates a provider for a profile, reading config at call time.
   * Wraps with FallbackProvider if fallbackProfile specified.
   */
  createForProfile(profileId: string, fallbackProfileId?: string): LLMProvider {
    const profile = this.configService.llm.profiles[profileId]
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found`)
    }

    const primary = this.createProvider(profile, profileId)

    if (!fallbackProfileId) return primary

    const fallback = this.configService.llm.fallbacks[fallbackProfileId]
    if (!fallback) {
      throw new Error(`Fallback profile "${fallbackProfileId}" not found`)
    }

    return new FallbackProvider(primary, [this.createProvider(fallback, fallbackProfileId)], this.logger)
  }

  /**
   * Creates provider for the default profile.
   */
  createDefault(): LLMProvider {
    const { defaultProfile } = this.configService.llm
    return this.createForProfile(defaultProfile)
  }

  private createProvider(profile: LlmProfile, profileId: string): LLMProvider {
    const factory = new ProviderFactory(
      {
        profileName: profileId,
        // Cast: LlmProfile.provider includes 'custom' which isn't supported by ProviderFactory
        provider: profile.provider as ProviderType,
        model: profile.model,
        timeout: profile.timeout * 1000, // seconds to ms
        maxRetries: profile.timeoutMaxRetries,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
        // OpenRouter-specific provider routing
        providerAllowlist: profile.providerAllowlist,
        providerBlocklist: profile.providerBlocklist,
      },
      this.logger
    )
    return factory.create()
  }
}
