/**
 * OpenAI provider implementation using OpenAI SDK
 *
 * Maps to Track 1: src/sidekick/lib/llm.sh::_llm_invoke_openai_api()
 *
 * This provider uses the official openai SDK to invoke OpenAI/Azure OpenAI models
 * via the OpenAI API. All invocation logic is inherited from OpenAICompatibleProvider.
 */

import { OpenAICompatibleProvider } from './OpenAICompatibleProvider.js'
import { OpenAIConfig } from './types.js'

/**
 * OpenAI provider implementation
 *
 * Example usage:
 * ```typescript
 * const provider = new OpenAIProvider({
 *   type: 'openai-api',
 *   model: 'gpt-5-nano',
 *   apiKey: process.env.OPENAI_API_KEY,
 *   timeout: 30,
 * })
 *
 * const response = await provider.invoke('What is 2+2?')
 * console.log(response.content)
 * console.log(response.metadata.usage)
 * ```
 */
export class OpenAIProvider extends OpenAICompatibleProvider<OpenAIConfig> {
  /**
   * OpenAI uses the SDK's default base URL (https://api.openai.com/v1)
   */
  protected getDefaultBaseURL(): string | undefined {
    return undefined // Use SDK default
  }
}
