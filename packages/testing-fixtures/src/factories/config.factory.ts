/**
 * Config Factory for Testing
 *
 * Creates test configuration objects with sensible defaults.
 * Useful for testing config-dependent behavior.
 *
 * @example
 * ```typescript
 * const config = createTestConfig({
 *   llm: { provider: 'openai-api' }
 * });
 * ```
 */

import type { SidekickConfig } from '@sidekick/core'

/** Recursively make all properties optional */
type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P]
}

const DEFAULT_CONFIG: SidekickConfig = {
  llm: {
    provider: 'openrouter',
    timeout: 10,
    timeoutMaxRetries: 3,
    debugDumpEnabled: false,
    circuitBreaker: {
      enabled: true,
      failureThreshold: 3,
      backoffInitial: 60,
      backoffMax: 3600,
      backoffMultiplier: 2,
    },
  },
  sessionSummary: {
    excerptLines: 80,
    filterToolMessages: true,
    keepHistory: false,
    countdownLow: 5,
    countdownMed: 20,
    countdownHigh: 10000,
    bookmarkConfidenceThreshold: 0.8,
    bookmarkResetThreshold: 0.7,
    minUserMessages: 5,
    minRecentLines: 50,
    titleMaxWords: 8,
    intentMaxWords: 12,
  },
  features: {
    statusline: true,
    sessionSummary: true,
    resume: true,
    sleeper: true,
    snarkyComment: true,
    reminders: true,
    reminderUserPrompt: true,
    reminderToolCadence: true,
    reminderStuckCheckpoint: true,
    reminderPreCompletion: true,
    cleanup: true,
  },
  logLevel: 'info',
  consoleLogging: false,
  claudeBin: undefined,
  reminder: {
    userPromptCadence: 1,
    toolUseCadence: 60,
    stuckThreshold: 40,
  },
  cleanup: {
    enabled: true,
    minCount: 5,
    ageDays: 2,
    dryRun: false,
  },
  supervisor: {
    idleTimeoutMs: 5 * 60 * 1000, // 5 minutes
    shutdownTimeoutMs: 30 * 1000, // 30 seconds
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
