/**
 * Profile Provider Factory
 *
 * Creates LLM providers from profile configurations.
 * Reads config at call time to enable runtime tunability.
 */

import type { Logger, LLMProvider, MinimalConfigService, MinimalLlmProfile } from '@sidekick/types'
import { ProviderFactory, type ProviderType } from './factory'
import { FallbackProvider } from './fallback'

export class ProfileProviderFactory {
  constructor(
    private readonly configService: MinimalConfigService,
    private readonly logger: Logger
  ) {}

  /**
   * Creates a provider for a profile, reading config at call time.
   * Wraps with FallbackProvider if a fallback is resolved.
   *
   * Fallback resolution cascade:
   *   1. Explicit fallbackProfileId parameter (caller override)
   *   2. Profile-level fallbackProfileId (per-profile config)
   *   3. Global defaultFallbackProfileId (llm config level)
   *   4. No fallback
   */
  createForProfile(profileId: string, fallbackProfileId?: string): LLMProvider {
    const profile = this.configService.llm.profiles[profileId]
    if (!profile) {
      throw new Error(`Profile "${profileId}" not found`)
    }

    const primary = this.createProvider(profile, profileId)

    // Resolve fallback: explicit > profile-level > global default
    const resolvedFallbackId =
      fallbackProfileId ?? profile.fallbackProfileId ?? this.configService.llm.defaultFallbackProfileId

    if (!resolvedFallbackId) return primary

    const fallback = this.configService.llm.fallbackProfiles[resolvedFallbackId]
    if (!fallback) {
      throw new Error(`Fallback profile "${resolvedFallbackId}" not found`)
    }

    return new FallbackProvider(primary, [this.createProvider(fallback, resolvedFallbackId)], this.logger)
  }

  /**
   * Creates provider for the default profile.
   */
  createDefault(): LLMProvider {
    const { defaultProfile } = this.configService.llm
    return this.createForProfile(defaultProfile)
  }

  private createProvider(profile: MinimalLlmProfile, profileId: string): LLMProvider {
    const factory = new ProviderFactory(
      {
        profileName: profileId,
        // Cast: LlmProfile.provider includes 'custom' which isn't supported by ProviderFactory
        provider: profile.provider as ProviderType,
        model: profile.model,
        timeout: profile.timeout ? profile.timeout * 1000 : undefined, // seconds to ms
        maxRetries: profile.timeoutMaxRetries,
        temperature: profile.temperature,
        maxTokens: profile.maxTokens,
        // OpenRouter-specific provider routing
        providerAllowlist: profile.providerAllowlist ? [...profile.providerAllowlist] : undefined,
        providerBlocklist: profile.providerBlocklist ? [...profile.providerBlocklist] : undefined,
      },
      this.logger
    )
    return factory.create()
  }
}
