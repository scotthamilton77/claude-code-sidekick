/**
 * Abstract Base Provider
 *
 * Common functionality for all LLM providers including logging hooks
 * and structured error handling. Providers extend this class to gain
 * automatic observability integration.
 */

import type { Logger, LLMProvider, LLMRequest, LLMResponse } from '@sidekick/types'

/**
 * Result of API key validation.
 */
export type ValidationResult = { valid: true } | { valid: false; error: string }

/**
 * Interface for providers that support API key validation.
 */
export interface ValidatableProvider {
  /**
   * Validate an API key by calling a free endpoint (e.g., /models).
   * This does not consume credits.
   */
  validateApiKey(apiKey: string, logger?: Logger): Promise<ValidationResult>
}

export abstract class AbstractProvider implements LLMProvider {
  abstract readonly id: string

  constructor(protected readonly logger: Logger) {}

  abstract complete(request: LLMRequest): Promise<LLMResponse>

  protected logRequest(request: LLMRequest): void {
    const totalContentLength = request.messages.reduce((sum, msg) => sum + msg.content.length, 0)

    this.logger.debug('LLM request initiated', {
      provider: this.id,
      model: request.model,
      messageCount: request.messages.length,
      hasSystem: !!request.system,
      systemLength: request.system?.length,
      totalContentLength,
    })
  }

  protected logResponse(response: LLMResponse, durationMs: number): void {
    this.logger.info('LLM request completed', {
      provider: this.id,
      model: response.model,
      durationMs,
      usage: response.usage,
      status: response.rawResponse.status,
      contentLength: response.content.length,
    })

    this.logger.debug('LLM response details', {
      provider: this.id,
      inputTokens: response.usage?.inputTokens,
      outputTokens: response.usage?.outputTokens,
      tokensPerSecond: response.usage?.outputTokens
        ? Math.round((response.usage.outputTokens / durationMs) * 1000)
        : undefined,
    })
  }

  protected logError(error: Error): void {
    this.logger.error('LLM request failed', {
      provider: this.id,
      error: error.message,
      name: error.name,
    })
  }

  protected redactApiKey(key: string): string {
    if (key.length <= 8) return '[REDACTED]'
    return `${key.slice(0, 4)}...${key.slice(-4)}`
  }
}
