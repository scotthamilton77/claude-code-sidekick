/**
 * Config Factory for Testing
 *
 * Creates test configuration objects with sensible defaults.
 * Useful for testing config-dependent behavior.
 *
 * Updated for Phase 2 YAML domain-based config structure:
 * - core: logging, paths
 * - llm: provider settings
 * - transcript: file watching settings
 * - features: feature flags with enabled/settings
 *
 * @example
 * ```typescript
 * const config = createTestConfig({
 *   llm: { provider: 'openai' }
 * });
 * ```
 */

import type { SidekickConfig } from '@sidekick/core'

/** Recursively make all properties optional */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

const DEFAULT_CONFIG: SidekickConfig = {
  core: {
    logging: {
      level: 'info',
      format: 'pretty',
      consoleEnabled: false,
    },
    paths: {
      state: '.sidekick',
    },
    supervisor: {
      idleTimeoutMs: 300000,
      shutdownTimeoutMs: 30000,
    },
    ipc: {
      connectTimeoutMs: 5000,
      requestTimeoutMs: 30000,
      maxRetries: 3,
      retryDelayMs: 100,
    },
  },
  llm: {
    provider: 'openrouter',
    emulatedProvider: undefined,
    model: 'x-ai/grok-4-fast',
    temperature: 0,
    maxTokens: undefined,
    fallbackProvider: 'openrouter',
    fallbackModel: 'google/gemini-2.5-flash-lite',
    timeout: 30,
    timeoutMaxRetries: 3,
    debugDumpEnabled: false,
  },
  transcript: {
    watchDebounceMs: 100,
    metricsPersistIntervalMs: 5000,
  },
  features: {
    // Example feature with new structure
    reminders: {
      enabled: true,
      settings: {
        updateThreshold: 15,
        stuckThreshold: 20,
      },
    },
    sessionSummary: {
      enabled: true,
      settings: {},
    },
  },
}

/**
 * Create a test configuration with defaults merged with overrides.
 */
export function createTestConfig(overrides?: DeepPartial<SidekickConfig>): SidekickConfig {
  return deepMerge(DEFAULT_CONFIG, overrides ?? {}) as SidekickConfig
}

/**
 * Deep merge helper for nested objects.
 * Uses unknown internally to handle DeepPartial inputs.
 */
function deepMerge(target: unknown, source: unknown): unknown {
  if (!isPlainObject(target) || !isPlainObject(source)) {
    return source !== undefined ? source : target
  }

  const result: Record<string, unknown> = { ...target }

  for (const key of Object.keys(source)) {
    const sourceValue = source[key]
    const targetValue = result[key]

    if (isPlainObject(sourceValue) && isPlainObject(targetValue)) {
      result[key] = deepMerge(targetValue, sourceValue)
    } else if (sourceValue !== undefined) {
      result[key] = sourceValue
    }
  }

  return result
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
