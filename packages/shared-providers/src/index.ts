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

// Core interfaces
export type { Message, LLMRequest, LLMResponse, LLMProvider } from './interface'

// Error types
export { ProviderError, RateLimitError, AuthError, TimeoutError } from './errors'

// Factory
export { ProviderFactory, type ProviderConfig, type ProviderType } from './factory'

// Fallback wrapper
export { FallbackProvider } from './fallback'

// Provider implementations (exported for advanced use cases)
export { OpenAINativeProvider, type OpenAINativeConfig } from './providers/openai-native'
export { AnthropicCliProvider, type AnthropicCliConfig } from './providers/anthropic-cli'
export { AbstractProvider } from './providers/base'

// LLM Service (high-level wrapper with telemetry)
export { LLMService, type LLMServiceConfig } from './llm-service'
