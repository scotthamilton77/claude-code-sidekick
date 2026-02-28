/**
 * Minimal Service Type Constraints for Config/Assets
 *
 * These define what BaseContext needs from config and asset services.
 * Full implementations with Zod schemas live in @sidekick/core.
 * Structural typing means real implementations satisfy these automatically.
 *
 * @see docs/design/CONFIG-SYSTEM.md
 */

/**
 * Minimal config service constraint for context typing.
 * The actual ConfigService interface is defined in @sidekick/core.
 *
 * Note: "Minimal" interfaces are a deliberate pattern to break circular dependencies.
 * @sidekick/types is the foundation with no deps on other sidekick packages.
 * @sidekick/core implements full ConfigService/AssetResolver with Zod schemas.
 * BaseContext uses these minimal constraints; structural typing ensures the full
 * implementations satisfy them automatically.
 */

/**
 * LLM profile configuration used in MinimalConfigService.
 * Contains the essential fields needed for provider creation.
 */
export interface MinimalLlmProfile {
  readonly provider: string
  readonly model: string
  readonly temperature?: number
  readonly maxTokens?: number
  readonly timeout?: number
  readonly timeoutMaxRetries?: number
  /** Optional fallback profile ID from fallbackProfiles namespace */
  readonly fallbackProfileId?: string
  /** OpenRouter-specific provider routing */
  readonly providerAllowlist?: readonly string[]
  readonly providerBlocklist?: readonly string[]
}

export interface MinimalConfigService {
  readonly core: {
    readonly logging: {
      readonly level: string
      /** Per-component log level overrides */
      readonly components: Record<string, string>
    }
    readonly development: { readonly enabled: boolean }
  }
  readonly llm: {
    readonly defaultProfile: string
    readonly defaultFallbackProfileId?: string
    readonly profiles: Record<string, MinimalLlmProfile>
    readonly fallbackProfiles: Record<string, MinimalLlmProfile>
  }
  getAll(): unknown
  getFeature<T = Record<string, unknown>>(name: string): { enabled: boolean; settings: T }
}

/**
 * Minimal asset resolver constraint for context typing.
 * The actual AssetResolver interface is defined in @sidekick/core.
 */
export interface MinimalAssetResolver {
  readonly cascadeLayers: string[]
  /**
   * Resolve an asset by relative path, returning its content.
   * Returns null if the asset is not found in any cascade layer.
   */
  resolve(relativePath: string): string | null
}
