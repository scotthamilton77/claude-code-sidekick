/**
 * Base provider for OpenAI-compatible APIs (OpenAI, OpenRouter, etc.)
 *
 * Maps to Track 1: src/sidekick/lib/llm.sh::_llm_invoke_openai_api() and _llm_invoke_openrouter()
 *
 * This abstract base class implements the complete invoke() logic that is shared
 * between all OpenAI SDK-based providers. Derived classes only need to specify
 * the default baseURL via getDefaultBaseURL().
 *
 * Supports:
 * - Configurable timeout with AbortController
 * - Retry logic for transient failures (timeout, rate limit)
 * - Structured output with JSON schema enforcement
 * - Full metadata extraction (tokens, timing, HTTP status)
 * - JSON extraction from responses (including tool_calls fallback)
 */

import OpenAI from 'openai'
import { LLMProvider } from './LLMProvider.js'
import {
  OpenAIConfig,
  OpenRouterConfig,
  InvokeOptions,
  LLMResponse,
  LLMErrorType,
  TokenUsage,
} from './types.js'

/**
 * Union type for OpenAI-compatible configs
 */
type OpenAICompatibleConfig = OpenAIConfig | OpenRouterConfig

/**
 * Abstract base provider for OpenAI-compatible APIs
 *
 * Implements all shared logic. Derived classes only need to provide the default baseURL.
 */
export abstract class OpenAICompatibleProvider<
  T extends OpenAICompatibleConfig,
> extends LLMProvider<T> {
  protected client: OpenAI

  /**
   * Get the default base URL for this provider (used if config.endpoint is not set)
   *
   * Examples:
   * - OpenAI: undefined (use SDK default)
   * - OpenRouter: 'https://openrouter.ai/api/v1'
   */
  protected abstract getDefaultBaseURL(): string | undefined

  constructor(config: T) {
    super(config)

    // Validate API key
    if (!config.apiKey) {
      const providerName = config.type === 'openai-api' ? 'OpenAI' : 'OpenRouter'
      const envVar = config.type === 'openai-api' ? 'OPENAI_API_KEY' : 'OPENROUTER_API_KEY'

      throw this.createError(
        LLMErrorType.CONFIG_ERROR,
        `${providerName} API key not found. Set apiKey in config or ${envVar} environment variable`
      )
    }

    // Determine base URL
    let baseURL: string | undefined

    if (config.endpoint) {
      // Use provided endpoint, stripping /chat/completions suffix if present
      baseURL = config.endpoint.replace(/\/chat\/completions$/, '')
    } else {
      // Use provider-specific default
      baseURL = this.getDefaultBaseURL()
    }

    // Initialize OpenAI client
    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL,
      // Disable automatic retries - we handle retries ourselves
      maxRetries: 0,
      // Note: timeout will be set per-request in invoke()
    })
  }

  /**
   * Invoke provider with a prompt
   *
   * Implements timeout handling with AbortController and retry logic
   * for transient failures (timeouts, rate limits).
   */
  async invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse> {
    const timeout = this.getTimeout(options)
    const maxRetries = this.getMaxRetries(options)
    const timeoutMs = timeout * 1000 // Convert seconds to milliseconds

    let lastError: Error | undefined
    let attempt = 0

    // Retry loop (initial attempt + retries)
    while (attempt <= maxRetries) {
      attempt++

      try {
        const startMs = Date.now()

        // Create AbortController for timeout handling
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

        try {
          // Build response_format based on options
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let responseFormat: any

          if (options?.jsonSchema) {
            // Use JSON schema for structured output
            responseFormat = {
              type: 'json_schema',
              json_schema: options.jsonSchema,
            }
          } else {
            // Default to json_object mode
            responseFormat = {
              type: 'json_object',
            }
          }

          // Call API (via OpenAI SDK)
          const completion = await this.client.chat.completions.create(
            {
              model: this.config.model,
              messages: [
                {
                  role: 'user',
                  content: prompt,
                },
              ],
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
              response_format: responseFormat,
            },
            {
              // Per-request timeout (in milliseconds)
              timeout: timeoutMs,
              signal: controller.signal,
            }
          )

          clearTimeout(timeoutId)

          // Extract response timing
          const endMs = Date.now()
          const wallTimeMs = endMs - startMs

          // Extract content from completion
          const choice = completion.choices[0]
          if (!choice) {
            const providerName = this.config.type === 'openai-api' ? 'OpenAI' : 'OpenRouter'
            throw this.createError(
              LLMErrorType.API_ERROR,
              `${providerName} API returned no choices in response`
            )
          }

          // Extract content - prefer message.content, fallback to tool_calls
          let content: string

          if (choice.message.content) {
            // Primary path: use message.content
            content = choice.message.content
          } else if (choice.message.tool_calls && choice.message.tool_calls.length > 0) {
            // Fallback: extract from tool_calls if content is empty
            const toolCall = choice.message.tool_calls[0]

            // Type guard for function tool calls
            if (toolCall && 'function' in toolCall) {
              if (toolCall.function.name === '<|constrain|>json') {
                // Special case: some models use this tool for JSON output
                content = toolCall.function.arguments
              } else {
                const providerName = this.config.type === 'openai-api' ? 'OpenAI' : 'OpenRouter'
                throw this.createError(
                  LLMErrorType.API_ERROR,
                  `${providerName} API returned unexpected tool call: ${toolCall.function.name}`,
                  undefined,
                  {
                    toolCalls: choice.message.tool_calls,
                  }
                )
              }
            } else {
              const providerName = this.config.type === 'openai-api' ? 'OpenAI' : 'OpenRouter'
              throw this.createError(
                LLMErrorType.API_ERROR,
                `${providerName} API returned non-function tool call`,
                undefined,
                {
                  toolCalls: choice.message.tool_calls,
                }
              )
            }
          } else {
            // Neither content nor tool_calls - error
            const providerName = this.config.type === 'openai-api' ? 'OpenAI' : 'OpenRouter'
            throw this.createError(
              LLMErrorType.API_ERROR,
              `${providerName} API returned empty content and no tool_calls`,
              undefined,
              {
                choice,
              }
            )
          }

          // Extract token usage
          const usage: TokenUsage | undefined = completion.usage
            ? {
                inputTokens: completion.usage.prompt_tokens,
                outputTokens: completion.usage.completion_tokens,
                totalTokens: completion.usage.total_tokens,
              }
            : undefined

          // Extract reasoning if present (some models like gpt-oss-20b include this)
          const reasoning =
            'reasoning' in choice.message
              ? (choice.message as { reasoning?: string }).reasoning
              : undefined

          // Build response
          const response: LLMResponse = {
            content,
            metadata: {
              wallTimeMs,
              ...(usage && { usage }), // Only include if present
              // Note: OpenAI/OpenRouter don't provide cost in API response
              // costUsd is omitted (not set to undefined) per exactOptionalPropertyTypes
              rawResponse: JSON.stringify(completion),
              providerMetadata: {
                completionId: completion.id,
                model: completion.model,
                finishReason: choice.finish_reason,
                ...(reasoning && { reasoning }),
              },
            },
          }

          return response
        } finally {
          clearTimeout(timeoutId)
        }
      } catch (error) {
        lastError = error as Error

        // Check if this is a timeout error
        const isTimeout =
          error instanceof OpenAI.APIConnectionTimeoutError ||
          (error as Error).name === 'AbortError'

        // Check if this is a rate limit error
        const isRateLimit = error instanceof OpenAI.RateLimitError

        // Retry on timeout or rate limit, but not on other errors
        if ((isTimeout || isRateLimit) && attempt <= maxRetries) {
          // Brief delay before retry (exponential backoff)
          const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000)
          await new Promise((resolve) => setTimeout(resolve, delayMs))

          continue // Retry
        }

        // Non-retryable error or max retries exceeded - throw
        break
      }
    }

    // All retries exhausted, throw last error
    if (lastError) {
      // Map error types
      let errorType: LLMErrorType

      if (
        lastError instanceof OpenAI.APIConnectionTimeoutError ||
        lastError.name === 'AbortError'
      ) {
        errorType = LLMErrorType.TIMEOUT
      } else if (lastError instanceof OpenAI.RateLimitError) {
        errorType = LLMErrorType.API_ERROR
      } else if (lastError instanceof OpenAI.APIError) {
        errorType = LLMErrorType.API_ERROR
      } else if (lastError.name === 'TypeError' && lastError.message.includes('fetch failed')) {
        errorType = LLMErrorType.NETWORK_ERROR
      } else {
        errorType = LLMErrorType.UNKNOWN
      }

      throw this.createError(errorType, lastError.message, lastError, {
        attempts: attempt,
        maxRetries,
      })
    }

    // Should never reach here
    throw this.createError(LLMErrorType.UNKNOWN, 'Unknown error during invocation')
  }
}
