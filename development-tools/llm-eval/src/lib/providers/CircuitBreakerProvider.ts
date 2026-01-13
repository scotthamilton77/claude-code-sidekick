/**
 * Circuit breaker provider wrapper
 *
 * Wraps an LLM provider with circuit breaker pattern for resilience.
 * Uses Cockatiel library for circuit breaker implementation.
 */

import {
  handleWhen,
  circuitBreaker,
  ConsecutiveBreaker,
  ExponentialBackoff,
  CircuitState,
  BrokenCircuitError,
} from 'cockatiel'
import type { CircuitBreakerPolicy } from 'cockatiel'
import { LLMProvider } from './LLMProvider.js'
import { InvokeOptions, LLMResponse, ProviderConfig } from './types.js'

/**
 * Circuit breaker configuration options
 */
export interface CircuitBreakerOptions {
  /** Enable circuit breaker (default: true) */
  enabled?: boolean
  /** Number of consecutive failures before opening circuit (default: 3) */
  failureThreshold?: number
  /** Initial backoff duration in seconds (default: 60) */
  backoffInitial?: number
  /** Maximum backoff duration in seconds (default: 3600) */
  backoffMax?: number
  /** Backoff multiplier for exponential growth (default: 2) */
  backoffMultiplier?: number
}

/**
 * Circuit breaker provider wrapper
 *
 * Wraps any LLM provider with Cockatiel's circuit breaker pattern.
 * Automatically switches to fallback provider when circuit opens.
 */
export class CircuitBreakerProvider<
  TConfig extends ProviderConfig = ProviderConfig,
> extends LLMProvider<TConfig> {
  private readonly primaryProvider: LLMProvider<TConfig>
  private readonly fallbackProvider: LLMProvider | undefined
  private readonly options: Required<CircuitBreakerOptions>
  private readonly breaker: CircuitBreakerPolicy

  /**
   * Create a circuit breaker provider
   *
   * @param primary - Primary LLM provider
   * @param fallback - Optional fallback provider (used when circuit is open)
   * @param options - Circuit breaker configuration
   */
  constructor(
    primary: LLMProvider<TConfig>,
    fallback?: LLMProvider,
    options: CircuitBreakerOptions = {}
  ) {
    // Create config based on primary's config
    const config = {
      type: primary.getProviderName(),
      model: primary.getModelName(),
      timeout: 30000,
    } as TConfig
    super(config)

    this.primaryProvider = primary
    this.fallbackProvider = fallback

    // Set defaults
    this.options = {
      enabled: options.enabled ?? true,
      failureThreshold: options.failureThreshold ?? 3,
      backoffInitial: options.backoffInitial ?? 60,
      backoffMax: options.backoffMax ?? 3600,
      backoffMultiplier: options.backoffMultiplier ?? 2,
    }

    // Create Cockatiel circuit breaker
    // Note: Cockatiel uses milliseconds, we accept seconds
    const policy = handleWhen(() => true) // Handle all errors
    this.breaker = circuitBreaker(policy, {
      breaker: new ConsecutiveBreaker(this.options.failureThreshold),
      halfOpenAfter: new ExponentialBackoff({
        initialDelay: this.options.backoffInitial * 1000,
        maxDelay: this.options.backoffMax * 1000,
        exponent: this.options.backoffMultiplier,
      }),
    })
  }

  /**
   * Invoke the LLM with circuit breaker protection
   *
   * @param prompt - The prompt text to send to the LLM
   * @param options - Invocation options
   * @returns Promise resolving to LLMResponse
   * @throws LLMError on failure, or BrokenCircuitError if circuit is open without fallback
   */
  async invoke(prompt: string, options?: InvokeOptions): Promise<LLMResponse> {
    // If disabled, bypass circuit breaker entirely
    if (!this.options.enabled) {
      return this.primaryProvider.invoke(prompt, options)
    }

    // Execute through circuit breaker
    try {
      return await this.breaker.execute(async () => {
        return this.primaryProvider.invoke(prompt, options)
      })
    } catch (error) {
      // If circuit is broken and we have a fallback, use it
      if (error instanceof BrokenCircuitError && this.fallbackProvider) {
        return this.fallbackProvider.invoke(prompt, options)
      }

      // Re-throw all other errors (including BrokenCircuitError without fallback)
      throw error
    }
  }

  /**
   * Get current circuit state (for debugging/monitoring)
   *
   * @returns Current circuit state: 'closed', 'open', or 'half-open'
   */
  getCircuitState(): 'closed' | 'open' | 'half-open' {
    const state = this.breaker.state
    switch (state) {
      case CircuitState.Closed:
        return 'closed'
      case CircuitState.Open:
        return 'open'
      case CircuitState.HalfOpen:
        return 'half-open'
      default:
        return 'closed'
    }
  }

  /**
   * Get provider name (delegates to primary)
   */
  override getProviderName(): string {
    return this.primaryProvider.getProviderName()
  }

  /**
   * Get model name (delegates to primary)
   */
  override getModelName(): string {
    return this.primaryProvider.getModelName()
  }

  /**
   * Get identifier (delegates to primary)
   */
  override getIdentifier(): string {
    return this.primaryProvider.getIdentifier()
  }
}
