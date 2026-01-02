/**
 * Shared LLM Providers Package
 *
 * Unified interface for interacting with various LLM providers.
 * Provides OpenAI, OpenRouter, and Anthropic CLI support with
 * automatic retries, fallback handling, and structured logging.
 *
 * @example
 * ```typescript
 * import { ProviderFactory } from '@sidekick/shared-providers'
 *
 * const factory = new ProviderFactory({
 *   provider: 'openai',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   model: 'gpt-4',
 * }, logger)
 *
 * const provider = factory.create()
 * const response = await provider.complete({
 *   messages: [{ role: 'user', content: 'Hello!' }]
 * })
 * ```
 */

// Core interfaces (re-exported from @sidekick/types)
export type { Message, LLMRequest, LLMResponse, LLMProvider } from '@sidekick/types'

// Error types
export { ProviderError, RateLimitError, AuthError, TimeoutError } from './errors'

// Factory
export { ProviderFactory, type ProviderConfig, type ProviderType, type EmulatedProviderType } from './factory'

// Profile-based factory (reads config at call time)
export { ProfileProviderFactory } from './profile-factory'

// Fallback wrapper
export { FallbackProvider } from './fallback'

// Provider implementations (exported for advanced use cases)
export { OpenAINativeProvider, type OpenAINativeConfig } from './providers/openai-native'
export { AnthropicCliProvider, type AnthropicCliConfig } from './providers/anthropic-cli'
export { AbstractProvider } from './providers/base'

// Emulator implementations (for cost-effective testing)
export {
  AbstractEmulator,
  EmulatorStateManager,
  OpenAIEmulator,
  OpenRouterEmulator,
  ClaudeCliEmulator,
  type EmulatorConfig,
  type EmulatorState,
  type ProviderCallState,
  type ClaudeCliEmulatorConfig,
} from './providers/emulators'

// LLM Service (high-level wrapper with telemetry)
export { LLMService, type LLMServiceConfig } from './llm-service'

// Claude CLI utilities
export { spawnClaudeCli, type ClaudeCliSpawnOptions, type ClaudeCliSpawnResult } from './claude-cli-spawn'
