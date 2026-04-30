/**
 * Standardized Error Types for LLM Providers
 *
 * Provides consistent error handling across all provider implementations.
 * All errors include provider context and retryability hints.
 */

export class ProviderError extends Error {
  public readonly provider: string
  public readonly retryable: boolean
  public readonly cause?: Error

  constructor(message: string, provider: string, retryable: boolean, cause?: Error) {
    super(message)
    this.name = 'ProviderError'
    this.provider = provider
    this.retryable = retryable
    this.cause = cause
    Object.setPrototypeOf(this, ProviderError.prototype)
  }
}

export class RateLimitError extends ProviderError {
  public readonly retryAfter?: number

  constructor(provider: string, retryAfter?: number, cause?: Error) {
    super('Rate limit exceeded', provider, true, cause)
    this.name = 'RateLimitError'
    this.retryAfter = retryAfter
    Object.setPrototypeOf(this, RateLimitError.prototype)
  }
}

export class AuthError extends ProviderError {
  constructor(provider: string, cause?: Error) {
    super('Authentication failed', provider, false, cause)
    this.name = 'AuthError'
    Object.setPrototypeOf(this, AuthError.prototype)
  }
}

export class TimeoutError extends ProviderError {
  constructor(provider: string, cause?: Error) {
    super('Request timeout', provider, true, cause)
    this.name = 'TimeoutError'
    Object.setPrototypeOf(this, TimeoutError.prototype)
  }
}

export class MalformedResponseError extends ProviderError {
  readonly code?: string
  readonly providerMessage?: string

  constructor(provider: string, code?: string, providerMessage?: string, cause?: Error) {
    super(
      `Malformed response from ${provider}: ${code ?? 'unknown'} - ${providerMessage ?? 'no message'}`,
      provider,
      false,
      cause,
    )
    this.name = 'MalformedResponseError'
    this.code = code
    this.providerMessage = providerMessage
    Object.setPrototypeOf(this, MalformedResponseError.prototype)
  }
}
