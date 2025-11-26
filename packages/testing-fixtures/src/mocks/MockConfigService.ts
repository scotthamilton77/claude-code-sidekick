/**
 * Mock Config Service for Testing
 *
 * Provides a simple in-memory configuration service for testing.
 * Allows setting arbitrary config values without file I/O.
 *
 * @example
 * ```typescript
 * const config = new MockConfigService();
 * config.set({ llm: { provider: 'openai-api' } });
 * expect(config.get('llm.provider')).toBe('openai-api');
 * ```
 */

import type { SidekickConfig } from '@sidekick/core'

export class MockConfigService {
  private config: Partial<SidekickConfig> = {}

  /**
   * Set configuration (deep merges with existing).
   */
  set(newConfig: Partial<SidekickConfig>): void {
    this.config = this.deepMerge(this.config, newConfig)
  }

  private deepMerge<T extends Record<string, unknown>>(target: T, source: Partial<T>): T {
    const result = { ...target }

    for (const key of Object.keys(source) as Array<keyof T>) {
      const sourceValue = source[key]
      const targetValue = result[key]

      if (this.isPlainObject(sourceValue) && this.isPlainObject(targetValue)) {
        result[key] = this.deepMerge(
          targetValue as Record<string, unknown>,
          sourceValue as Record<string, unknown>
        ) as T[keyof T]
      } else {
        result[key] = sourceValue as T[keyof T]
      }
    }

    return result
  }

  private isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
  }

  /**
   * Get configuration value by dot-path or return entire config.
   */
  get<T = unknown>(path?: string): T {
    if (!path) {
      return this.config as T
    }

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
   * Get entire config object.
   */
  getAll(): Partial<SidekickConfig> {
    return this.config
  }
}
