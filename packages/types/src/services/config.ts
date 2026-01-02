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
 */
// FIXME these "minimal" interfaces are a smell; should we have full types here in types/?
export interface MinimalConfigService {
  readonly core: {
    readonly logging: { readonly level: string }
    readonly development: { readonly enabled: boolean }
  }
  readonly llm: { readonly provider: string }
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
