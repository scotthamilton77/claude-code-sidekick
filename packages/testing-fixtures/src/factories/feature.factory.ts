/**
 * Feature Factory for Testing
 *
 * Creates test data for feature implementations.
 * Helps with testing feature hooks and lifecycle.
 *
 * @example
 * ```typescript
 * const feature = createTestFeature({
 *   name: 'test-feature',
 *   enabled: true
 * });
 * ```
 */

export interface FeatureConfig {
  name: string
  enabled: boolean
  config?: Record<string, unknown>
}

export interface FeatureHooks {
  onSessionStart?: (context: unknown) => Promise<void>
  onSessionEnd?: (context: unknown) => Promise<void>
  onUserPrompt?: (context: unknown, prompt: string) => Promise<string>
  onToolUse?: (context: unknown, tool: string) => Promise<void>
}

export interface TestFeature {
  name: string
  enabled: boolean
  config: Record<string, unknown>
  hooks: FeatureHooks
}

/**
 * Create a test feature with minimal hooks.
 */
export function createTestFeature(overrides?: Partial<FeatureConfig>): TestFeature {
  return {
    name: 'test-feature',
    enabled: true,
    config: {},
    hooks: {},
    ...overrides,
  }
}

/**
 * Create a feature with lifecycle hooks that record calls.
 */
export function createRecordingFeature(name = 'recording-feature'): TestFeature & {
  recordedCalls: Array<{ hook: string; args: unknown[] }>
} {
  const recordedCalls: Array<{ hook: string; args: unknown[] }> = []

  return {
    name,
    enabled: true,
    config: {},
    hooks: {
      async onSessionStart(context: unknown) {
        recordedCalls.push({ hook: 'onSessionStart', args: [context] })
        return Promise.resolve()
      },
      async onSessionEnd(context: unknown) {
        recordedCalls.push({ hook: 'onSessionEnd', args: [context] })
        return Promise.resolve()
      },
      async onUserPrompt(context: unknown, prompt: string) {
        recordedCalls.push({ hook: 'onUserPrompt', args: [context, prompt] })
        return Promise.resolve(prompt)
      },
      async onToolUse(context: unknown, tool: string) {
        recordedCalls.push({ hook: 'onToolUse', args: [context, tool] })
        return Promise.resolve()
      },
    },
    recordedCalls,
  }
}
