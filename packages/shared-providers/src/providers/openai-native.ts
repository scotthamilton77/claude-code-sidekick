/**
 * OpenAI Native Provider (supports OpenAI and OpenRouter)
 *
 * Uses the official OpenAI Node.js SDK for both OpenAI and OpenRouter.
 * OpenRouter support is achieved via custom baseURL configuration.
 * Relies on SDK's built-in retry mechanism for resilience.
 */

import OpenAI from 'openai'
import type { Logger, LLMRequest, LLMResponse } from '@sidekick/types'
import { AbstractProvider } from './base'
import { AuthError, RateLimitError, TimeoutError, ProviderError, MalformedResponseError } from '../errors'

export interface OpenAINativeConfig {
  profileName?: string
  apiKey: string
  baseURL?: string
  model: string
  maxRetries?: number
  timeout?: number
  temperature?: number
  maxTokens?: number
  // OpenRouter-specific provider routing
  providerAllowlist?: string[]
  providerBlocklist?: string[]
}

export class OpenAINativeProvider extends AbstractProvider {
  readonly id: string
  private readonly client: OpenAI
  private readonly defaultModel: string
  private readonly temperature?: number
  private readonly maxTokens?: number
  private readonly providerAllowlist?: string[]
  private readonly providerBlocklist?: string[]

  constructor(config: OpenAINativeConfig, logger: Logger) {
    super(logger)
    this.id = config.baseURL?.includes('openrouter') ? 'openrouter' : 'openai'
    this.defaultModel = config.model
    this.temperature = config.temperature
    this.maxTokens = config.maxTokens
    this.providerAllowlist = config.providerAllowlist
    this.providerBlocklist = config.providerBlocklist

    this.client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries ?? 3,
      timeout: config.timeout ?? 60000,
    })

    this.logger.debug('OpenAI provider initialized', {
      profile: config.profileName,
      provider: this.id,
      model: this.defaultModel,
      baseURL: config.baseURL,
      temperature: this.temperature,
      maxTokens: this.maxTokens,
      providerAllowlist: this.providerAllowlist,
      providerBlocklist: this.providerBlocklist,
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

      // Build response_format if jsonSchema is provided
      const responseFormat = request.jsonSchema
        ? {
            type: 'json_schema' as const,
            json_schema: {
              name: request.jsonSchema.name,
              schema: request.jsonSchema.schema,
              strict: request.jsonSchema.strict ?? true,
            },
          }
        : undefined

      // Build OpenRouter provider routing if configured (only applies to OpenRouter)
      const providerRouting = this.buildProviderRouting()

      const completion = await this.client.chat.completions.create({
        model: request.model ?? this.defaultModel,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        response_format: responseFormat,
        ...providerRouting,
        ...request.additionalParams,
      })

      if (!completion.choices || completion.choices.length === 0) {
        // Some upstreams (notably OpenRouter) return 200 with a top-level `error`
        // envelope instead of `choices`; lift it into MalformedResponseError so
        // callers see structured details rather than an empty content string.
        const errorPayload = (completion as { error?: { code?: string; message?: string } }).error
        throw new MalformedResponseError(this.id, errorPayload?.code, errorPayload?.message)
      }

      const response: LLMResponse = {
        content: completion.choices[0]?.message?.content ?? '',
        model: completion.model,
        usage: completion.usage
          ? {
              inputTokens: completion.usage.prompt_tokens,
              outputTokens: completion.usage.completion_tokens,
            }
          : undefined,
        finishReason: completion.choices[0]?.finish_reason ?? undefined,
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

  /**
   * Build OpenRouter provider routing object.
   * Returns empty object if no routing configured or not using OpenRouter.
   * @see https://openrouter.ai/docs/guides/routing/provider-selection
   */
  private buildProviderRouting(): Record<string, unknown> {
    // Only apply to OpenRouter
    if (this.id !== 'openrouter') {
      return {}
    }

    const hasAllowlist = this.providerAllowlist && this.providerAllowlist.length > 0
    const hasBlocklist = this.providerBlocklist && this.providerBlocklist.length > 0

    if (!hasAllowlist && !hasBlocklist) {
      return {}
    }

    const providerObj: Record<string, string[]> = {}
    if (hasAllowlist) {
      providerObj.only = this.providerAllowlist!
    }
    if (hasBlocklist) {
      providerObj.ignore = this.providerBlocklist!
    }

    return { provider: providerObj }
  }

  private mapError(error: unknown): ProviderError {
    // Errors thrown above (e.g. MalformedResponseError) are already shaped — passing
    // them through the SDK-error branches below would discard their subclass identity.
    if (error instanceof ProviderError) {
      return error
    }

    if (error instanceof OpenAI.APIError) {
      if (error.status === 401 || error.status === 403) {
        return new AuthError(this.id, error)
      }
      if (error.status === 429) {
        const headers = error.headers as Record<string, string | null | undefined> | undefined
        const retryHeader = headers?.['retry-after']
        const retryAfter = typeof retryHeader === 'string' ? parseInt(retryHeader, 10) : undefined
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
