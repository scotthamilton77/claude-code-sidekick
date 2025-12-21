/**
 * Mock Config Service for Testing
 *
 * Provides a simple in-memory configuration service for testing.
 * Allows setting arbitrary config values without file I/O.
 * Implements ConfigService interface for type compatibility.
 *
 * Updated for Phase 2 YAML domain-based config structure:
 * - core: logging, paths
 * - llm: provider settings
 * - transcript: file watching settings
 * - features: feature flags with enabled/settings
 *
 * @example
 * ```typescript
 * const config = new MockConfigService();
 * config.set({ llm: { provider: 'openai' } });
 * expect(config.llm.provider).toBe('openai');
 * ```
 */

import type {
  ConfigService,
  CoreConfig,
  DerivedPaths,
  FeatureConfig,
  FeaturesConfig,
  LlmConfig,
  SidekickConfig,
  TranscriptConfig,
} from '@sidekick/core'

/** Recursively make all properties optional */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

/** Default config values matching Zod schema defaults */
const DEFAULT_CORE: CoreConfig = {
  logging: { level: 'info', format: 'pretty', consoleEnabled: false },
  paths: { state: '.sidekick' },
  supervisor: { idleTimeoutMs: 300000, shutdownTimeoutMs: 30000 },
  ipc: { connectTimeoutMs: 5000, requestTimeoutMs: 30000, maxRetries: 3, retryDelayMs: 100 },
}

const DEFAULT_LLM: LlmConfig = {
  provider: 'claude-cli',
  emulatedProvider: undefined,
  model: undefined,
  temperature: 0,
  maxTokens: undefined,
  fallbackProvider: undefined,
  fallbackModel: undefined,
  timeout: 30,
  timeoutMaxRetries: 3,
  debugDumpEnabled: false,
}

const DEFAULT_TRANSCRIPT: TranscriptConfig = {
  watchDebounceMs: 100,
  metricsPersistIntervalMs: 5000,
}

const DEFAULT_FEATURES: FeaturesConfig = {}

export class MockConfigService implements ConfigService {
  private _core: CoreConfig = { ...DEFAULT_CORE }
  private _llm: LlmConfig = { ...DEFAULT_LLM }
  private _transcript: TranscriptConfig = { ...DEFAULT_TRANSCRIPT }
  private _features: FeaturesConfig = { ...DEFAULT_FEATURES }

  /** Config sources (empty for mock) */
  readonly sources: string[] = []

  /** Derived paths (mock implementation) */
  readonly paths: DerivedPaths = {
    sessionRoot: (sessionId: string) => `.sidekick/sessions/${sessionId}`,
    stagingRoot: (sessionId: string) => `.sidekick/sessions/${sessionId}/stage`,
    hookStaging: (sessionId: string, hookName: string) => `.sidekick/sessions/${sessionId}/stage/${hookName}`,
    sessionState: (sessionId: string, filename: string) => `.sidekick/sessions/${sessionId}/state/${filename}`,
    logsDir: () => `.sidekick/logs`,
  }

  get core(): CoreConfig {
    return this._core
  }

  get llm(): LlmConfig {
    return this._llm
  }

  get transcript(): TranscriptConfig {
    return this._transcript
  }

  get features(): FeaturesConfig {
    return this._features
  }

  /**
   * Set configuration (deep merges with existing).
   */
  set(newConfig: DeepPartial<SidekickConfig>): void {
    if (newConfig.core) {
      this._core = this.deepMerge(this._core, newConfig.core) as CoreConfig
    }
    if (newConfig.llm) {
      this._llm = this.deepMerge(this._llm, newConfig.llm) as LlmConfig
    }
    if (newConfig.transcript) {
      this._transcript = this.deepMerge(this._transcript, newConfig.transcript) as TranscriptConfig
    }
    if (newConfig.features) {
      this._features = this.deepMerge(this._features, newConfig.features) as FeaturesConfig
    }
  }

  private deepMerge(target: unknown, source: unknown): unknown {
    if (!this.isPlainObject(target) || !this.isPlainObject(source)) {
      return source !== undefined ? source : target
    }

    const result: Record<string, unknown> = { ...target }

    for (const key of Object.keys(source)) {
      const sourceValue = source[key]
      const targetValue = result[key]

      if (this.isPlainObject(sourceValue) && this.isPlainObject(targetValue)) {
        result[key] = this.deepMerge(targetValue, sourceValue)
      } else if (sourceValue !== undefined) {
        result[key] = sourceValue
      }
    }

    return result
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  /**
   * Get a specific feature's config with type safety.
   */
  getFeature<T = Record<string, unknown>>(name: string): FeatureConfig & { settings: T } {
    const feature = this._features[name] ?? { enabled: true, settings: {} }
    return feature as FeatureConfig & { settings: T }
  }

  /**
   * Get configuration value by dot-path (extended API for tests).
   */
  getPath<T = unknown>(path: string): T {
    const config = this.getAll()
    const keys = path.split('.')
    let value: unknown = config

    for (const key of keys) {
      if (value && typeof value === 'object' && key in value) {
        value = (value as Record<string, unknown>)[key]
      } else {
        return undefined as T
      }
    }

    return value as T
  }

  /**
   * Reset to default config.
   */
  reset(): void {
    this._core = { ...DEFAULT_CORE }
    this._llm = { ...DEFAULT_LLM }
    this._transcript = { ...DEFAULT_TRANSCRIPT }
    this._features = { ...DEFAULT_FEATURES }
  }

  /**
   * Get entire config object (ConfigService interface).
   */
  getAll(): SidekickConfig {
    return {
      core: this._core,
      llm: this._llm,
      transcript: this._transcript,
      features: this._features,
    }
  }
}
