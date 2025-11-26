/**
 * LLM Service - High-level wrapper for LLM provider interactions
 *
 * Integrates shared-providers with telemetry and provides clean interface for features.
 * Wraps provider calls with observability (timing, token tracking, error metrics).
 *
 * @example
 * ```typescript
 * const llmService = new LLMService(
 *   {
 *     provider: 'claude-cli',
 *     model: 'claude-sonnet-4',
 *     timeout: 30000,
 *   },
 *   logger,
 *   telemetry
 * )
 *
 * const response = await llmService.complete({
 *   messages: [{ role: 'user', content: 'Summarize this session' }]
 * })
 * ```
 */

import { ProviderFactory } from './factory.js'
import type { ProviderConfig, ProviderType } from './factory.js'
import type { LLMProvider, LLMRequest, LLMResponse, Logger, Telemetry } from '@sidekick/types'

/**
 * LLM Service configuration
 * Maps to ProviderFactory config for compatibility
 */
export interface LLMServiceConfig {
  provider: ProviderType
  model: string
  apiKey?: string
  baseURL?: string
  maxRetries?: number
  timeout?: number
  cliPath?: string
}

/**
 * LLM Service - Observability-wrapped provider interface
 *
 * Provides clean interface for features to call LLM with automatic
 * telemetry emission (duration, tokens, success/failure).
 */
export class LLMService implements LLMProvider {
  private readonly provider: LLMProvider
  public readonly id: string

  constructor(
    private readonly config: LLMServiceConfig,
    private readonly logger: Logger,
    private readonly telemetry: Telemetry
  ) {
    // Convert to ProviderConfig (types are compatible)
    const providerConfig: ProviderConfig = {
      provider: config.provider,
      model: config.model,
      apiKey: config.apiKey,
      baseURL: config.baseURL,
      maxRetries: config.maxRetries ?? 3,
      timeout: config.timeout ?? 30000,
      cliPath: config.cliPath,
    }

    // Use ProviderFactory to create underlying provider
    const factory = new ProviderFactory(providerConfig, logger)
    this.provider = factory.create()
    this.id = this.provider.id

    logger.debug('LLMService initialized', {
      provider: config.provider,
      model: config.model,
      maxRetries: providerConfig.maxRetries,
      timeout: providerConfig.timeout,
    })
  }

  /**
   * Complete an LLM request with telemetry emission
   *
   * Wraps provider.complete() with timing metrics and error tracking.
   * All telemetry is emitted regardless of success/failure.
   */
  async complete(request: LLMRequest): Promise<LLMResponse> {
    const startTime = Date.now()
    const model = request.model ?? this.config.model

    this.logger.debug('LLM request starting', {
      provider: this.config.provider,
      model,
      messageCount: request.messages.length,
    })

    try {
      const response = await this.provider.complete(request)

      const duration = Date.now() - startTime

      // Emit success telemetry
      this.telemetry.histogram('llm_request_duration', duration, 'ms', {
        provider: this.config.provider,
        model,
        success: 'true',
      })

      if (response.usage) {
        this.telemetry.histogram('llm_input_tokens', response.usage.inputTokens, 'tokens', {
          provider: this.config.provider,
          model,
        })

        this.telemetry.histogram('llm_output_tokens', response.usage.outputTokens, 'tokens', {
          provider: this.config.provider,
          model,
        })
      }

      this.logger.debug('LLM request completed', {
        provider: this.config.provider,
        model,
        duration,
        inputTokens: response.usage?.inputTokens,
        outputTokens: response.usage?.outputTokens,
      })

      return response
    } catch (error) {
      const duration = Date.now() - startTime

      // Emit failure telemetry
      this.telemetry.histogram('llm_request_duration', duration, 'ms', {
        provider: this.config.provider,
        model,
        success: 'false',
      })

      this.telemetry.increment('llm_request_errors', {
        provider: this.config.provider,
        model,
        error_type: error instanceof Error ? error.constructor.name : 'unknown',
      })

      this.logger.error('LLM request failed', {
        provider: this.config.provider,
        model,
        duration,
        error: error instanceof Error ? error.message : String(error),
      })

      throw error
    }
  }
}
