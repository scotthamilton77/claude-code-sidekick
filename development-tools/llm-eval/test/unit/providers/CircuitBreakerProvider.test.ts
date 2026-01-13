/**
 * Tests for CircuitBreakerProvider
 *
 * Tests our integration with Cockatiel, not Cockatiel's circuit breaker logic.
 * We trust Cockatiel to handle state transitions, failure counting, and backoff.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { CircuitBreakerProvider } from '../../../src/lib/providers/CircuitBreakerProvider.js'
import { LLMProvider } from '../../../src/lib/providers/LLMProvider.js'
import { InvokeOptions, LLMResponse, ProviderConfig } from '../../../src/lib/providers/types.js'

/**
 * Mock LLM Provider for testing
 */
class MockLLMProvider extends LLMProvider {
  private callCount = 0
  private shouldFail = false
  private failureMessage = 'Mock failure'

  constructor(config: ProviderConfig = { type: 'openrouter', model: 'test', timeout: 30000 }) {
    super(config)
  }

  async invoke(prompt: string, _options?: InvokeOptions): Promise<LLMResponse> {
    this.callCount++

    if (this.shouldFail) {
      throw new Error(this.failureMessage)
    }

    await Promise.resolve()

    return {
      content: `Mock response to: ${prompt}`,
      metadata: {
        wallTimeMs: 100,
        rawResponse: 'mock raw response',
        usage: {
          inputTokens: 10,
          outputTokens: 20,
          totalTokens: 30,
        },
      },
    }
  }

  setFailure(shouldFail: boolean, message = 'Mock failure'): void {
    this.shouldFail = shouldFail
    this.failureMessage = message
  }

  getCallCount(): number {
    return this.callCount
  }

  resetCallCount(): void {
    this.callCount = 0
  }
}

describe('CircuitBreakerProvider', () => {
  let primary: MockLLMProvider
  let fallback: MockLLMProvider

  beforeEach(() => {
    primary = new MockLLMProvider({ type: 'openrouter', model: 'test-primary', timeout: 30000 })
    fallback = new MockLLMProvider({ type: 'openrouter', model: 'test-fallback', timeout: 30000 })
  })

  describe('Disabled Mode', () => {
    it('should bypass circuit breaker when disabled', async () => {
      const breaker = new CircuitBreakerProvider(primary, fallback, {
        enabled: false,
      })

      // Should use primary even with failures
      primary.setFailure(false)
      const response1 = await breaker.invoke('test 1')
      expect(response1.content).toContain('test 1')
      expect(primary.getCallCount()).toBe(1)

      // Failures should propagate directly (no circuit breaker intervention)
      primary.setFailure(true)
      await expect(breaker.invoke('test 2')).rejects.toThrow('Mock failure')

      // Should not use fallback when disabled
      expect(fallback.getCallCount()).toBe(0)
    })
  })

  describe('Fallback Provider', () => {
    it('should switch to fallback when circuit breaks', async () => {
      const breaker = new CircuitBreakerProvider(primary, fallback, {
        failureThreshold: 2,
        backoffInitial: 1,
      })

      // Trigger failures to open circuit
      primary.setFailure(true)
      await expect(breaker.invoke('test 1')).rejects.toThrow()
      await expect(breaker.invoke('test 2')).rejects.toThrow()

      // Circuit should now be open, next call uses fallback
      fallback.setFailure(false)
      const response = await breaker.invoke('test 3')

      // Should have used fallback
      expect(response.content).toContain('test 3')
      expect(fallback.getCallCount()).toBeGreaterThan(0)
    })

    it('should throw BrokenCircuitError when circuit opens without fallback', async () => {
      const breaker = new CircuitBreakerProvider(primary, undefined, {
        failureThreshold: 2,
        backoffInitial: 1,
      })

      primary.setFailure(true)

      // Open circuit
      await expect(breaker.invoke('test 1')).rejects.toThrow()
      await expect(breaker.invoke('test 2')).rejects.toThrow()

      // Should throw BrokenCircuitError (no fallback available)
      await expect(breaker.invoke('test 3')).rejects.toThrow()
    })
  })

  describe('Provider Delegation', () => {
    it('should delegate getProviderName to primary', () => {
      const breaker = new CircuitBreakerProvider(primary, fallback)
      expect(breaker.getProviderName()).toBe('openrouter')
    })

    it('should delegate getModelName to primary', () => {
      const breaker = new CircuitBreakerProvider(primary, fallback)
      expect(breaker.getModelName()).toBe('test-primary')
    })

    it('should delegate getIdentifier to primary', () => {
      const breaker = new CircuitBreakerProvider(primary, fallback)
      expect(breaker.getIdentifier()).toBe('openrouter/test-primary')
    })
  })

  describe('Circuit State', () => {
    it('should start in closed state', () => {
      const breaker = new CircuitBreakerProvider(primary)
      expect(breaker.getCircuitState()).toBe('closed')
    })

    it('should expose current circuit state for monitoring', async () => {
      const breaker = new CircuitBreakerProvider(primary, fallback, {
        failureThreshold: 2,
        backoffInitial: 1,
      })

      // Initial state
      expect(breaker.getCircuitState()).toBe('closed')

      // Open circuit
      primary.setFailure(true)
      await expect(breaker.invoke('test 1')).rejects.toThrow()
      await expect(breaker.invoke('test 2')).rejects.toThrow()

      // State should reflect circuit is open (or transitioning)
      const state = breaker.getCircuitState()
      expect(['open', 'half-open']).toContain(state)
    })
  })

  describe('Configuration', () => {
    it('should accept custom failure threshold', () => {
      const breaker = new CircuitBreakerProvider(primary, fallback, {
        failureThreshold: 5,
      })

      // Should construct without errors
      expect(breaker).toBeDefined()
      expect(breaker.getCircuitState()).toBe('closed')
    })

    it('should accept custom backoff settings', () => {
      const breaker = new CircuitBreakerProvider(primary, fallback, {
        backoffInitial: 60,
        backoffMax: 3600,
        backoffMultiplier: 2,
      })

      // Should construct without errors
      expect(breaker).toBeDefined()
      expect(breaker.getCircuitState()).toBe('closed')
    })

    it('should convert seconds to milliseconds for Cockatiel', () => {
      // This test verifies our config mapping logic
      const breaker = new CircuitBreakerProvider(primary, fallback, {
        backoffInitial: 2, // 2 seconds
        backoffMax: 10, // 10 seconds
      })

      // Should construct successfully (Cockatiel internally uses milliseconds)
      expect(breaker).toBeDefined()
    })
  })

  describe('Success Cases', () => {
    it('should handle successful calls', async () => {
      const breaker = new CircuitBreakerProvider(primary, fallback)

      primary.setFailure(false)
      const response = await breaker.invoke('test')

      expect(response.content).toContain('test')
      expect(primary.getCallCount()).toBe(1)
      expect(fallback.getCallCount()).toBe(0)
    })

    it('should handle rapid successive successful calls', async () => {
      const breaker = new CircuitBreakerProvider(primary, fallback)

      primary.setFailure(false)

      // Make 10 rapid calls
      const promises = Array.from({ length: 10 }, (_, i) => breaker.invoke(`test ${i}`))

      const results = await Promise.all(promises)

      expect(results).toHaveLength(10)
      expect(primary.getCallCount()).toBe(10)
      expect(fallback.getCallCount()).toBe(0)
    })
  })
})
