/**
 * Claude provider implementation using Anthropic SDK
 *
 * Maps to Track 1: src/sidekick/lib/llm.sh::_llm_invoke_claude_cli()
 *
 * This provider uses the official @anthropic-ai/sdk to invoke Claude models
 * via the Anthropic API. It supports:
 * - Configurable timeout with AbortController
 * - Retry logic for transient failures
 * - Full metadata extraction (tokens, cost, timing)
 * - JSON extraction from responses
 */

import Anthropic from '@anthropic-ai/sdk'
import { LLMProvider } from './LLMProvider.js'
import { ClaudeConfig, InvokeOptions, LLMResponse, LLMErrorType, TokenUsage } from './types.js'

/**
 * Claude provider implementation
 *
 * Example usage:
 * ```typescript
 * const provider = new ClaudeProvider({
 *   type: 'claude-cli',
 *   model: 'claude-sonnet-4-20250514',
 *   timeout: 30,
 * })
 *
 * const response = await provider.invoke('What is 2+2?')
 * console.log(response.content)
 * console.log(response.metadata.usage)
 * ```
 */
export class ClaudeProvider extends LLMProvider<ClaudeConfig> {
  private client: Anthropic

  constructor(config: ClaudeConfig) {
    super(config)

    // Initialize Anthropic client
    // Note: API key comes from ANTHROPIC_API_KEY environment variable
    // or can be passed in config.options.apiKey
    const apiKey =
      (config.options?.['apiKey'] as string | undefined) ?? process.env['ANTHROPIC_API_KEY']

    if (!apiKey) {
      throw this.createError(
        LLMErrorType.CONFIG_ERROR,
        'Anthropic API key not found. Set ANTHROPIC_API_KEY environment variable or pass apiKey in config.options'
      )
    }

    this.client = new Anthropic({
      apiKey,
      // Disable automatic retries - we handle retries ourselves
      maxRetries: 0,
      // Note: timeout will be set per-request in invoke()
    })
  }

  /**
   * Invoke Claude with a prompt
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
          // Call Anthropic API
          const message = await this.client.messages.create(
            {
              model: this.config.model,
              max_tokens: 4096, // Default max tokens
              messages: [
                {
                  role: 'user',
                  content: prompt,
                },
              ],
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

          // Extract content from message
          // Content is an array of blocks, typically one text block
          const textBlocks = message.content.filter((block) => block.type === 'text')
          const content = textBlocks.map((block) => block.text).join('\n')

          // Extract token usage
          const usage: TokenUsage = {
            inputTokens: message.usage.input_tokens,
            outputTokens: message.usage.output_tokens,
            totalTokens: message.usage.input_tokens + message.usage.output_tokens,
          }

          // Calculate approximate cost (using Sonnet 4 pricing as reference)
          // TODO: Make pricing configurable per model
          const costUsd = this.calculateCost(usage, this.config.model)

          // Build response
          const response: LLMResponse = {
            content,
            metadata: {
              wallTimeMs,
              usage,
              costUsd,
              rawResponse: JSON.stringify(message),
              providerMetadata: {
                messageId: message.id,
                model: message.model,
                stopReason: message.stop_reason,
                stopSequence: message.stop_sequence,
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
          error instanceof Anthropic.APIConnectionTimeoutError ||
          (error as Error).name === 'AbortError'

        // Check if this is a rate limit error
        const isRateLimit = error instanceof Anthropic.RateLimitError

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
        lastError instanceof Anthropic.APIConnectionTimeoutError ||
        lastError.name === 'AbortError'
      ) {
        errorType = LLMErrorType.TIMEOUT
      } else if (lastError instanceof Anthropic.RateLimitError) {
        errorType = LLMErrorType.API_ERROR
      } else if (lastError instanceof Anthropic.APIError) {
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

  /**
   * Calculate approximate cost in USD based on token usage
   *
   * Note: This uses hardcoded pricing. In production, pricing should be
   * configurable or fetched from a pricing service.
   *
   * @param usage - Token usage statistics
   * @param model - Model name
   * @returns Estimated cost in USD
   */
  private calculateCost(usage: TokenUsage, model: string): number {
    // Pricing per million tokens (as of January 2025)
    // These are approximate - actual pricing may vary
    const pricing: Record<string, { input: number; output: number }> = {
      // Sonnet 4
      'claude-sonnet-4-20250514': { input: 3.0, output: 15.0 },
      'claude-sonnet-4-20250409': { input: 3.0, output: 15.0 },

      // Sonnet 3.5
      'claude-3-5-sonnet-20241022': { input: 3.0, output: 15.0 },
      'claude-3-5-sonnet-20240620': { input: 3.0, output: 15.0 },

      // Haiku
      'claude-3-5-haiku-20241022': { input: 0.8, output: 4.0 },
      'claude-3-haiku-20240307': { input: 0.25, output: 1.25 },

      // Opus
      'claude-3-opus-20240229': { input: 15.0, output: 75.0 },
    }

    // Use model-specific pricing or fallback to default (Sonnet pricing)
    const defaultPricing = { input: 3.0, output: 15.0 }
    const modelPricing = pricing[model] ?? defaultPricing

    // Calculate cost (price per million tokens)
    const inputCost = (usage.inputTokens / 1_000_000) * modelPricing.input
    const outputCost = (usage.outputTokens / 1_000_000) * modelPricing.output

    return inputCost + outputCost
  }
}
