/**
 * OpenRouter provider implementation using OpenAI SDK
 *
 * Maps to Track 1: src/sidekick/lib/llm.sh::_llm_invoke_openrouter()
 *
 * This provider uses the official OpenAI SDK with a custom baseURL to invoke
 * OpenRouter models. OpenRouter's API is OpenAI-compatible, so we can reuse
 * the battle-tested SDK. All invocation logic is inherited from OpenAICompatibleProvider.
 */

import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js'
import { OpenRouterConfig } from './types.js'

/**
 * OpenRouter provider implementation
 *
 * Example usage:
 * ```typescript
 * const provider = new OpenRouterProvider({
 *   type: 'openrouter',
 *   model: 'google/gemma-3n-e4b-it',
 *   apiKey: process.env.OPENROUTER_API_KEY,
 *   timeout: 30,
 * })
 *
 * const response = await provider.invoke('What is 2+2?')
 * console.log(response.content)
 * console.log(response.metadata.usage)
 * ```
 */
export class OpenRouterProvider extends OpenAICompatibleProvider<OpenRouterConfig> {
  /**
   * OpenRouter uses a custom base URL
   */
  protected getDefaultBaseURL(): string {
    return 'https://openrouter.ai/api/v1'
  }
}
