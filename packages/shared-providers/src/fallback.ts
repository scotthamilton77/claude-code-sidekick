/**
 * Fallback Provider Wrapper
 *
 * High-availability wrapper that attempts primary provider first,
 * then falls back to secondary providers on failure. Preserves
 * original error if all providers fail.
 */

import type { Logger, LLMProvider, LLMRequest, LLMResponse } from '@sidekick/types'

export class FallbackProvider implements LLMProvider {
  readonly id = 'fallback-wrapper'

  // Track last request results for instrumentation
  private _lastUsedProviderId: string | null = null
  private _fallbackWasUsed: boolean = false

  /** The provider ID that handled the last request (primary or fallback) */
  get lastUsedProviderId(): string | null {
    return this._lastUsedProviderId
  }

  /** Whether a fallback provider was used for the last request */
  get fallbackWasUsed(): boolean {
    return this._fallbackWasUsed
  }

  constructor(
    private readonly primary: LLMProvider,
    private readonly fallbacks: LLMProvider[],
    private readonly logger: Logger
  ) {
    this.logger.debug('Fallback provider initialized', {
      primary: primary.id,
      fallbacks: fallbacks.map((f) => f.id),
    })
  }

  async complete(request: LLMRequest): Promise<LLMResponse> {
    // Reset tracking state for new request
    this._fallbackWasUsed = false
    this._lastUsedProviderId = null

    let primaryError: Error | undefined

    try {
      const response = await this.primary.complete(request)
      this._lastUsedProviderId = this.primary.id
      return response
    } catch (err) {
      primaryError = err as Error
      this.logger.warn('Primary provider failed, attempting fallback', {
        primary: this.primary.id,
        error: primaryError.message,
      })
    }

    for (const fallback of this.fallbacks) {
      try {
        this.logger.info('Trying fallback provider', { provider: fallback.id })
        const response = await fallback.complete(request)
        this._lastUsedProviderId = fallback.id
        this._fallbackWasUsed = true
        return response
      } catch (err) {
        this.logger.warn('Fallback provider failed', {
          provider: fallback.id,
          error: (err as Error).message,
        })
        // Continue to next fallback
      }
    }

    // All providers failed, throw original error
    this.logger.error('All providers failed', {
      primary: this.primary.id,
      fallbackCount: this.fallbacks.length,
    })
    throw primaryError
  }
}
