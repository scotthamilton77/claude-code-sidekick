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
    let primaryError: Error | undefined

    try {
      return await this.primary.complete(request)
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
        return await fallback.complete(request)
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
