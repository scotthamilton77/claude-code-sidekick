/**
 * OpenAI Native Provider (supports OpenAI and OpenRouter)
 *
 * Uses the official OpenAI Node.js SDK for both OpenAI and OpenRouter.
 * OpenRouter support is achieved via custom baseURL configuration.
 * Relies on SDK's built-in retry mechanism for resilience.
 */

import OpenAI from 'openai'
import type { Logger } from '@sidekick/core'
import type { LLMRequest, LLMResponse } from '../interface'
import { AbstractProvider } from './base'
import { AuthError, RateLimitError, TimeoutError, ProviderError } from '../errors'

export interface OpenAINativeConfig {
  apiKey: string
  baseURL?: string
  model: string
  maxRetries?: number
  timeout?: number
}

export class OpenAINativeProvider extends AbstractProvider {
  readonly id: string
  private readonly client: OpenAI
  private readonly defaultModel: string

  constructor(config: OpenAINativeConfig, logger: Logger) {
    super(logger)
    this.id = config.baseURL?.includes('openrouter') ? 'openrouter' : 'openai'
    this.defaultModel = config.model

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries ?? 3,
      timeout: config.timeout ?? 60000,
    })

    this.logger.debug('OpenAI provider initialized', {
      provider: this.id,
      model: this.defaultModel,
      baseURL: config.baseURL,
      apiKey: this.redactApiKey(config.apiKey),
    })
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    this.logRequest(request)

    try {
      const messages = request.system
        ? [{ role: 'system' as const, content: request.system }, ...request.messages]
        : request.messages

      const completion = await this.client.chat.completions.create({
        model: request.model ?? this.defaultModel,
        messages,
        temperature: request.temperature,
        max_tokens: request.maxTokens,
        ...request.additionalParams,
      })

      const response: LLMResponse = {
        content: completion.choices[0]?.message?.content ?? '',
        model: completion.model,
        usage: completion.usage
          ? {
              inputTokens: completion.usage.prompt_tokens,
              outputTokens: completion.usage.completion_tokens,
            }
          : undefined,
        rawResponse: {
          status: 200,
          body: JSON.stringify(completion),
        },
      }

      this.logResponse(response, Date.now() - startTime)
      return response
    } catch (error) {
      this.logError(error as Error)
      throw this.mapError(error)
    }
  }

  private mapError(error: unknown): ProviderError {
    if (error instanceof OpenAI.APIError) {
      if (error.status === 401 || error.status === 403) {
        return new AuthError(this.id, error)
      }
      if (error.status === 429) {
        const retryAfter = error.headers?.['retry-after']
          ? parseInt(error.headers['retry-after'], 10)
          : undefined
        return new RateLimitError(this.id, retryAfter, error)
      }
      if (error.status && error.status >= 500) {
        return new ProviderError(`Server error: ${error.message}`, this.id, true, error)
      }
      return new ProviderError(`API error: ${error.message}`, this.id, false, error)
    }

    if (error instanceof Error) {
      if (error.name === 'AbortError' || error.message.includes('timeout')) {
        return new TimeoutError(this.id, error)
      }
      return new ProviderError(error.message, this.id, false, error)
    }

    return new ProviderError(String(error), this.id, false)
  }
}
