/**
 * Tests for Mock LLM Provider
 *
 * Verifies that the mock provider correctly simulates LLM behavior
 * for use in component testing without API costs.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { MockLLMProvider, createTestMockProvider } from './LLMProvider'

describe('MockLLMProvider', () => {
  let mock: MockLLMProvider

  beforeEach(() => {
    mock = new MockLLMProvider('test-provider', 'test-model')
  })

  describe('constructor', () => {
    it('should create mock with provider and model names', () => {
      expect(mock.getProviderName()).toBe('test-provider')
      expect(mock.getModelName()).toBe('test-model')
    })

    it('should use default names if not provided', () => {
      const defaultMock = new MockLLMProvider()
      expect(defaultMock.getProviderName()).toBe('mock')
      expect(defaultMock.getModelName()).toBe('mock-model')
    })
  })

  describe('invoke()', () => {
    it('should return default response for unmatched prompts', async () => {
      const response = await mock.invoke('any prompt')

      expect(response.content).toBe('{"status":"ok","message":"Mock response"}')
      expect(response.metadata.provider).toBe('test-provider')
      expect(response.metadata.model).toBe('test-model')
    })

    it('should return matched response when prompt is registered', async () => {
      mock.addResponse('hello', { content: '{"greeting":"hi"}' })

      const response = await mock.invoke('hello')

      expect(response.content).toBe('{"greeting":"hi"}')
    })

    it('should track invocation count', async () => {
      expect(mock.getInvocationCount()).toBe(0)

      await mock.invoke('first')
      expect(mock.getInvocationCount()).toBe(1)

      await mock.invoke('second')
      expect(mock.getInvocationCount()).toBe(2)
    })

    it('should include token estimates in metadata', async () => {
      const response = await mock.invoke('test prompt')

      expect(response.metadata.tokens).toBeDefined()
      expect(response.metadata.tokens!.prompt).toBeGreaterThan(0)
      expect(response.metadata.tokens!.completion).toBeGreaterThan(0)
      expect(response.metadata.tokens!.total).toBe(
        response.metadata.tokens!.prompt + response.metadata.tokens!.completion
      )
    })

    it('should simulate latency when configured', async () => {
      mock.addResponse('slow', { content: 'result', latency: 50 })

      const start = Date.now()
      const response = await mock.invoke('slow')
      const elapsed = Date.now() - start

      expect(elapsed).toBeGreaterThanOrEqual(45) // Allow 5ms tolerance
      expect(response.metadata.latency_ms).toBe(50)
    })

    it('should throw error when configured to fail', async () => {
      mock.addResponse('fail', {
        content: 'should not see this',
        shouldFail: true,
        error: new Error('Simulated failure'),
      })

      await expect(mock.invoke('fail')).rejects.toThrow('Simulated failure')
    })

    it('should throw generic error when shouldFail is true but no error provided', async () => {
      mock.addResponse('fail', {
        content: 'should not see this',
        shouldFail: true,
      })

      await expect(mock.invoke('fail')).rejects.toThrow('Mock provider configured to fail')
    })
  })

  describe('timeout handling', () => {
    it('should throw timeout error when latency exceeds timeout', async () => {
      mock.addResponse('slow', { content: 'result', latency: 1000 })

      const start = Date.now()
      await expect(mock.invoke('slow', { timeout: 100 })).rejects.toThrow(
        'Request timeout after 100ms'
      )
      const elapsed = Date.now() - start

      // Should wait for timeout duration before throwing
      expect(elapsed).toBeGreaterThanOrEqual(95)
      expect(elapsed).toBeLessThan(150)
    })

    it('should succeed when latency is within timeout', async () => {
      mock.addResponse('fast', { content: 'result', latency: 50 })

      const response = await mock.invoke('fast', { timeout: 100 })

      expect(response.content).toBe('result')
      expect(response.metadata.latency_ms).toBe(50)
    })

    it('should succeed when latency equals timeout', async () => {
      mock.addResponse('exact', { content: 'result', latency: 100 })

      const response = await mock.invoke('exact', { timeout: 100 })

      expect(response.content).toBe('result')
    })

    it('should not use timeout as default latency', async () => {
      // This was the original bug - timeout should not be used as latency default
      mock.addResponse('instant', { content: 'result' }) // No latency configured

      const start = Date.now()
      const response = await mock.invoke('instant', { timeout: 5000 })
      const elapsed = Date.now() - start

      // Should be instant (< 50ms), not 5000ms
      expect(elapsed).toBeLessThan(50)
      expect(response.metadata.latency_ms).toBe(0)
    })

    it('should work without timeout option', async () => {
      mock.addResponse('slow', { content: 'result', latency: 100 })

      const response = await mock.invoke('slow')

      expect(response.content).toBe('result')
      expect(response.metadata.latency_ms).toBe(100)
    })
  })

  describe('extractJSON()', () => {
    it('should extract and validate valid JSON', () => {
      const response = {
        content: '{"name":"test","value":42}',
        metadata: { provider: 'test', model: 'test' },
      }

      const schema = z.object({
        name: z.string(),
        value: z.number(),
      })

      const result = mock.extractJSON(response, schema)

      expect(result).toEqual({ name: 'test', value: 42 })
    })

    it('should extract JSON from code fence format', () => {
      const response = {
        content: '```json\n{"name":"test","value":42}\n```',
        metadata: { provider: 'test', model: 'test' },
      }

      const schema = z.object({
        name: z.string(),
        value: z.number(),
      })

      const result = mock.extractJSON(response, schema)

      expect(result).toEqual({ name: 'test', value: 42 })
    })

    it('should extract JSON from code fence without json label', () => {
      const response = {
        content: '```\n{"name":"test","value":42}\n```',
        metadata: { provider: 'test', model: 'test' },
      }

      const schema = z.object({
        name: z.string(),
        value: z.number(),
      })

      const result = mock.extractJSON(response, schema)

      expect(result).toEqual({ name: 'test', value: 42 })
    })

    it('should throw error for invalid JSON', () => {
      const response = {
        content: 'not valid json',
        metadata: { provider: 'test', model: 'test' },
      }

      const schema = z.object({ name: z.string() })

      expect(() => mock.extractJSON(response, schema)).toThrow('Failed to parse JSON')
    })

    it('should throw error when JSON does not match schema', () => {
      const response = {
        content: '{"name":"test"}',
        metadata: { provider: 'test', model: 'test' },
      }

      const schema = z.object({
        name: z.string(),
        required_field: z.number(), // Missing in response
      })

      expect(() => mock.extractJSON(response, schema)).toThrow('Schema validation failed')
    })
  })

  describe('setDefaultResponse()', () => {
    it('should override default response', async () => {
      mock.setDefaultResponse({ content: '{"custom":"default"}' })

      const response = await mock.invoke('any prompt')

      expect(response.content).toBe('{"custom":"default"}')
    })
  })

  describe('reset()', () => {
    it('should clear all responses and reset invocation count', async () => {
      mock.addResponse('test', { content: 'custom' })
      await mock.invoke('test')
      await mock.invoke('test')

      expect(mock.getInvocationCount()).toBe(2)

      mock.reset()

      expect(mock.getInvocationCount()).toBe(0)
      const response = await mock.invoke('test')
      expect(response.content).toBe('{"status":"ok","message":"Mock response"}')
    })
  })
})

describe('createTestMockProvider()', () => {
  it('should create mock with pre-configured test responses', async () => {
    const mock = createTestMockProvider()

    const response = await mock.invoke('hello')
    expect(response.content).toContain('Hello from mock provider')
  })

  it('should use provided provider and model names', () => {
    const mock = createTestMockProvider('custom-provider', 'custom-model')

    expect(mock.getProviderName()).toBe('custom-provider')
    expect(mock.getModelName()).toBe('custom-model')
  })

  it('should include error response for testing failures', async () => {
    const mock = createTestMockProvider()

    await expect(mock.invoke('error')).rejects.toThrow('Simulated API error')
  })

  it('should include slow response for testing latency', async () => {
    const mock = createTestMockProvider()

    // The 'timeout' response has 5000ms latency
    const start = Date.now()
    await mock.invoke('timeout')
    const elapsed = Date.now() - start

    expect(elapsed).toBeGreaterThanOrEqual(4900) // Allow 100ms tolerance
  })

  it('should timeout when using timeout response with timeout option', async () => {
    const mock = createTestMockProvider()

    // The 'timeout' response has 5000ms latency, should timeout at 1000ms
    await expect(mock.invoke('timeout', { timeout: 1000 })).rejects.toThrow(
      'Request timeout after 1000ms'
    )
  })
})
