import { describe, it, expect, vi } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { FallbackProvider, ProviderError, type LLMProvider, type LLMRequest } from '../index'

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

describe('FallbackProvider', () => {
  const mockRequest: LLMRequest = {
    messages: [{ role: 'user', content: 'test' }],
  }

  const successResponse = {
    content: 'Success',
    model: 'test-model',
    rawResponse: { status: 200, body: '{}' },
  }

  it('returns primary provider response on success', async () => {
    const primary: LLMProvider = {
      id: 'primary',
      complete: vi.fn().mockResolvedValue(successResponse),
    }

    const fallback: LLMProvider = {
      id: 'fallback',
      complete: vi.fn().mockResolvedValue(successResponse),
    }

    const provider = new FallbackProvider(primary, [fallback], logger)
    const result = await provider.complete(mockRequest)

    expect(result).toEqual(successResponse)
    expect(primary.complete).toHaveBeenCalledTimes(1)
    expect(fallback.complete).not.toHaveBeenCalled()
  })

  it('falls back to secondary provider when primary fails', async () => {
    const primaryError = new ProviderError('Primary failed', 'primary', true)
    const primary: LLMProvider = {
      id: 'primary',
      complete: vi.fn().mockRejectedValue(primaryError),
    }

    const fallback: LLMProvider = {
      id: 'fallback',
      complete: vi.fn().mockResolvedValue(successResponse),
    }

    const provider = new FallbackProvider(primary, [fallback], logger)
    const result = await provider.complete(mockRequest)

    expect(result).toEqual(successResponse)
    expect(primary.complete).toHaveBeenCalledTimes(1)
    expect(fallback.complete).toHaveBeenCalledTimes(1)
  })

  it('tries all fallbacks in order', async () => {
    const primaryError = new ProviderError('Primary failed', 'primary', true)
    const primary: LLMProvider = {
      id: 'primary',
      complete: vi.fn().mockRejectedValue(primaryError),
    }

    const fallback1: LLMProvider = {
      id: 'fallback1',
      complete: vi.fn().mockRejectedValue(new ProviderError('Fallback1 failed', 'fallback1', true)),
    }

    const fallback2: LLMProvider = {
      id: 'fallback2',
      complete: vi.fn().mockResolvedValue(successResponse),
    }

    const provider = new FallbackProvider(primary, [fallback1, fallback2], logger)
    const result = await provider.complete(mockRequest)

    expect(result).toEqual(successResponse)
    expect(primary.complete).toHaveBeenCalledTimes(1)
    expect(fallback1.complete).toHaveBeenCalledTimes(1)
    expect(fallback2.complete).toHaveBeenCalledTimes(1)
  })

  it('throws original error when all providers fail', async () => {
    const primaryError = new ProviderError('Primary failed', 'primary', true)
    const primary: LLMProvider = {
      id: 'primary',
      complete: vi.fn().mockRejectedValue(primaryError),
    }

    const fallback: LLMProvider = {
      id: 'fallback',
      complete: vi.fn().mockRejectedValue(new ProviderError('Fallback failed', 'fallback', true)),
    }

    const provider = new FallbackProvider(primary, [fallback], logger)

    await expect(provider.complete(mockRequest)).rejects.toThrow('Primary failed')
    expect(primary.complete).toHaveBeenCalledTimes(1)
    expect(fallback.complete).toHaveBeenCalledTimes(1)
  })

  it('handles empty fallback array', async () => {
    const primaryError = new ProviderError('Primary failed', 'primary', true)
    const primary: LLMProvider = {
      id: 'primary',
      complete: vi.fn().mockRejectedValue(primaryError),
    }

    const provider = new FallbackProvider(primary, [], logger)

    await expect(provider.complete(mockRequest)).rejects.toThrow('Primary failed')
    expect(primary.complete).toHaveBeenCalledTimes(1)
  })

  describe('fallback tracking', () => {
    it('tracks lastUsedProviderId as primary on primary success', async () => {
      const primary: LLMProvider = {
        id: 'primary',
        complete: vi.fn().mockResolvedValue(successResponse),
      }

      const fallback: LLMProvider = {
        id: 'fallback',
        complete: vi.fn().mockResolvedValue(successResponse),
      }

      const provider = new FallbackProvider(primary, [fallback], logger)
      await provider.complete(mockRequest)

      expect(provider.lastUsedProviderId).toBe('primary')
      expect(provider.fallbackWasUsed).toBe(false)
    })

    it('tracks fallbackWasUsed and lastUsedProviderId on fallback', async () => {
      const primaryError = new ProviderError('Primary failed', 'primary', true)
      const primary: LLMProvider = {
        id: 'primary',
        complete: vi.fn().mockRejectedValue(primaryError),
      }

      const fallback: LLMProvider = {
        id: 'fallback',
        complete: vi.fn().mockResolvedValue(successResponse),
      }

      const provider = new FallbackProvider(primary, [fallback], logger)
      await provider.complete(mockRequest)

      expect(provider.lastUsedProviderId).toBe('fallback')
      expect(provider.fallbackWasUsed).toBe(true)
    })

    it('tracks second fallback when first fallback also fails', async () => {
      const primaryError = new ProviderError('Primary failed', 'primary', true)
      const primary: LLMProvider = {
        id: 'primary',
        complete: vi.fn().mockRejectedValue(primaryError),
      }

      const fallback1: LLMProvider = {
        id: 'fallback1',
        complete: vi.fn().mockRejectedValue(new ProviderError('Fallback1 failed', 'fallback1', true)),
      }

      const fallback2: LLMProvider = {
        id: 'fallback2',
        complete: vi.fn().mockResolvedValue(successResponse),
      }

      const provider = new FallbackProvider(primary, [fallback1, fallback2], logger)
      await provider.complete(mockRequest)

      expect(provider.lastUsedProviderId).toBe('fallback2')
      expect(provider.fallbackWasUsed).toBe(true)
    })

    it('resets tracking state on new request', async () => {
      const primaryError = new ProviderError('Primary failed', 'primary', true)
      let primaryShouldFail = true

      const primary: LLMProvider = {
        id: 'primary',
        complete: vi.fn().mockImplementation(() => {
          if (primaryShouldFail) {
            return Promise.reject(primaryError)
          }
          return Promise.resolve(successResponse)
        }),
      }

      const fallback: LLMProvider = {
        id: 'fallback',
        complete: vi.fn().mockResolvedValue(successResponse),
      }

      const provider = new FallbackProvider(primary, [fallback], logger)

      // First request: primary fails, fallback succeeds
      await provider.complete(mockRequest)
      expect(provider.lastUsedProviderId).toBe('fallback')
      expect(provider.fallbackWasUsed).toBe(true)

      // Second request: primary succeeds
      primaryShouldFail = false
      await provider.complete(mockRequest)
      expect(provider.lastUsedProviderId).toBe('primary')
      expect(provider.fallbackWasUsed).toBe(false)
    })

    it('has null lastUsedProviderId when all providers fail', async () => {
      const primaryError = new ProviderError('Primary failed', 'primary', true)
      const primary: LLMProvider = {
        id: 'primary',
        complete: vi.fn().mockRejectedValue(primaryError),
      }

      const fallback: LLMProvider = {
        id: 'fallback',
        complete: vi.fn().mockRejectedValue(new ProviderError('Fallback failed', 'fallback', true)),
      }

      const provider = new FallbackProvider(primary, [fallback], logger)

      await expect(provider.complete(mockRequest)).rejects.toThrow('Primary failed')
      expect(provider.lastUsedProviderId).toBe(null)
      expect(provider.fallbackWasUsed).toBe(false)
    })
  })
})
