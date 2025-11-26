/**
 * Mock Config Service for Testing
 *
 * Provides a simple in-memory configuration service for testing.
 * Allows setting arbitrary config values without file I/O.
 * Implements ConfigService interface for type compatibility.
 *
 * @example
 * ```typescript
 * const config = new MockConfigService();
 * config.set({ llm: { provider: 'openai-api' } });
 * expect(config.get('llm.provider')).toBe('openai-api');
 * ```
 */

import type { ConfigService, SidekickConfig } from '@sidekick/core'

/** Recursively make all properties optional */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

export class MockConfigService implements ConfigService {
  private config: DeepPartial<SidekickConfig> = {}
  /** Config sources (empty for mock) */
  readonly sources: string[] = []

  /**
   * Set configuration (deep merges with existing).
   */
  set(newConfig: DeepPartial<SidekickConfig>): void {
    this.config = this.deepMerge(this.config, newConfig) as DeepPartial<SidekickConfig>
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
   * Get configuration value by key (ConfigService interface).
   */
  get<K extends keyof SidekickConfig>(key: K): SidekickConfig[K] {
    return this.config[key] as SidekickConfig[K]
  }

  /**
   * Get configuration value by dot-path (extended API for tests).
   */
  getPath<T = unknown>(path: string): T {
    const keys = path.split('.')
    let value: unknown = this.config

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
   * Reset to empty config.
   */
  reset(): void {
    this.config = {}
  }

  /**
   * Get entire config object (ConfigService interface).
   * Note: Returns partial config cast to full type for test compatibility.
   */
  getAll(): SidekickConfig {
    return this.config as SidekickConfig
  }
}
