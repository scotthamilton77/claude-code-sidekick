/**
 * Tests for MockProvider
 *
 * Validates mock provider functionality without making real API calls.
 * Zero API costs.
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { z } from 'zod'
import { MockProvider, createSimpleMock, createErrorMock } from './MockProvider.js'
import { LLMErrorType } from '../../src/lib/providers/types.js'

describe('MockProvider', () => {
  describe('Basic functionality', () => {
    it('should return default response when queue is empty', async () => {
      const provider = new MockProvider()
      const response = await provider.invoke('test prompt')

      expect(response.content).toBe('{"mock": true}')
      expect(response.metadata.wallTimeMs).toBeGreaterThanOrEqual(10)
      expect(response.metadata.usage).toBeDefined()
      expect(response.metadata.usage?.inputTokens).toBe(10)
      expect(response.metadata.usage?.outputTokens).toBe(5)
    })

    it('should return custom default response', async () => {
      const provider = new MockProvider({
        defaultResponse: {
          content: '{"custom": "response"}',
          latencyMs: 50,
          usage: { inputTokens: 20, outputTokens: 10, totalTokens: 30 },
          costUsd: 0.002,
        },
      })

      const response = await provider.invoke('test')

      expect(response.content).toBe('{"custom": "response"}')
      expect(response.metadata.wallTimeMs).toBeGreaterThanOrEqual(50)
      expect(response.metadata.usage?.inputTokens).toBe(20)
      expect(response.metadata.costUsd).toBe(0.002)
    })

    it('should use custom model name', () => {
      const provider = new MockProvider({ model: 'my-mock-model' })

      expect(provider.getModelName()).toBe('my-mock-model')
      expect(provider.getProviderName()).toBe('custom')
      expect(provider.getIdentifier()).toBe('custom/my-mock-model')
    })
  })

  describe('Response queue', () => {
    it('should return responses from queue in order', async () => {
      const provider = new MockProvider({
        responseQueue: [
          { content: '{"order": 1}' },
          { content: '{"order": 2}' },
          { content: '{"order": 3}' },
        ],
      })

      const r1 = await provider.invoke('first')
      const r2 = await provider.invoke('second')
      const r3 = await provider.invoke('third')

      expect(r1.content).toBe('{"order": 1}')
      expect(r2.content).toBe('{"order": 2}')
      expect(r3.content).toBe('{"order": 3}')
    })

    it('should fall back to default after queue is exhausted', async () => {
      const provider = new MockProvider({
        responseQueue: [{ content: '{"queued": true}' }],
        defaultResponse: { content: '{"default": true}' },
      })

      const r1 = await provider.invoke('first')
      const r2 = await provider.invoke('second')

      expect(r1.content).toBe('{"queued": true}')
      expect(r2.content).toBe('{"default": true}')
    })

    it('should handle enqueuing responses dynamically', async () => {
      const provider = new MockProvider()

      provider.enqueueResponse({ content: '{"dynamic": 1}' })
      provider.enqueueResponse({ content: '{"dynamic": 2}' })

      const r1 = await provider.invoke('test')
      const r2 = await provider.invoke('test')

      expect(r1.content).toBe('{"dynamic": 1}')
      expect(r2.content).toBe('{"dynamic": 2}')
    })
  })

  describe('Error simulation', () => {
    it('should throw timeout error when configured', async () => {
      const provider = new MockProvider({
        responseQueue: [
          {
            type: LLMErrorType.TIMEOUT,
            message: 'Simulated timeout',
            latencyMs: 100,
          },
        ],
      })

      await expect(provider.invoke('test')).rejects.toThrow('Simulated timeout')

      const lastInvocation = provider.getLastInvocation()
      expect(lastInvocation?.error).toBeDefined()
      expect(lastInvocation?.error?.type).toBe(LLMErrorType.TIMEOUT)
    })

    it('should throw API error when configured', async () => {
      const provider = new MockProvider({
        responseQueue: [
          {
            type: LLMErrorType.API_ERROR,
            message: 'Rate limit exceeded',
          },
        ],
      })

      await expect(provider.invoke('test')).rejects.toThrow('Rate limit exceeded')

      const lastInvocation = provider.getLastInvocation()
      expect(lastInvocation?.error?.type).toBe(LLMErrorType.API_ERROR)
    })

    it('should support enqueuing errors dynamically', async () => {
      const provider = new MockProvider()

      provider.enqueueError({
        type: LLMErrorType.NETWORK_ERROR,
        message: 'Connection failed',
      })

      await expect(provider.invoke('test')).rejects.toThrow('Connection failed')
    })

    it('should mix success and error responses', async () => {
      const provider = new MockProvider({
        responseQueue: [
          { content: '{"success": 1}' },
          { type: LLMErrorType.TIMEOUT, message: 'Timeout' },
          { content: '{"success": 2}' },
        ],
      })

      const r1 = await provider.invoke('test1')
      expect(r1.content).toBe('{"success": 1}')

      await expect(provider.invoke('test2')).rejects.toThrow('Timeout')

      const r3 = await provider.invoke('test3')
      expect(r3.content).toBe('{"success": 2}')
    })
  })

  describe('Invocation history', () => {
    let provider: MockProvider

    beforeEach(() => {
      provider = new MockProvider()
    })

    it('should track all invocations', async () => {
      await provider.invoke('first')
      await provider.invoke('second')
      await provider.invoke('third')

      const history = provider.getInvocationHistory()
      expect(history).toHaveLength(3)
      expect(history[0]!.prompt).toBe('first')
      expect(history[1]!.prompt).toBe('second')
      expect(history[2]!.prompt).toBe('third')
    })

    it('should record invocation options', async () => {
      const options = { timeout: 60, maxRetries: 5 }
      await provider.invoke('test', options)

      const lastInvocation = provider.getLastInvocation()
      expect(lastInvocation).toBeDefined()
      expect(lastInvocation!.options).toEqual(options)
    })

    it('should record timestamps', async () => {
      const before = new Date()
      await provider.invoke('test')
      const after = new Date()

      const lastInvocation = provider.getLastInvocation()
      expect(lastInvocation).toBeDefined()
      expect(lastInvocation!.timestamp.getTime()).toBeGreaterThanOrEqual(before.getTime())
      expect(lastInvocation!.timestamp.getTime()).toBeLessThanOrEqual(after.getTime())
    })

    it('should record successful responses', async () => {
      await provider.invoke('test')

      const lastInvocation = provider.getLastInvocation()
      expect(lastInvocation).toBeDefined()
      expect(lastInvocation!.response).toBeDefined()
      expect(lastInvocation!.error).toBeUndefined()
    })

    it('should record errors', async () => {
      provider.enqueueError({ type: LLMErrorType.TIMEOUT, message: 'Test error' })

      try {
        await provider.invoke('test')
      } catch {
        // Expected
      }

      const lastInvocation = provider.getLastInvocation()
      expect(lastInvocation).toBeDefined()
      expect(lastInvocation!.error).toBeDefined()
      expect(lastInvocation!.response).toBeUndefined()
    })

    it('should clear history', async () => {
      await provider.invoke('test')
      expect(provider.getInvocationCount()).toBe(1)

      provider.clearHistory()
      expect(provider.getInvocationCount()).toBe(0)
      expect(provider.getInvocationHistory()).toHaveLength(0)
    })

    it('should return correct invocation count', async () => {
      expect(provider.getInvocationCount()).toBe(0)

      await provider.invoke('test1')
      expect(provider.getInvocationCount()).toBe(1)

      await provider.invoke('test2')
      expect(provider.getInvocationCount()).toBe(2)
    })
  })

  describe('JSON extraction', () => {
    it('should extract JSON from response', async () => {
      const provider = new MockProvider({
        defaultResponse: {
          content: '{"result": "success", "count": 42}',
        },
      })

      const response = await provider.invoke('test')
      const json = provider.extractJSON(response)

      expect(json).toEqual({ result: 'success', count: 42 })
    })

    it('should extract JSON from markdown code block', async () => {
      const provider = new MockProvider({
        defaultResponse: {
          content: '```json\n{"wrapped": true}\n```',
        },
      })

      const response = await provider.invoke('test')
      const json = provider.extractJSON(response)

      expect(json).toEqual({ wrapped: true })
    })

    it('should extract JSON from markdown without language specifier', async () => {
      const provider = new MockProvider({
        defaultResponse: {
          content: '```\n{"noLanguage": true}\n```',
        },
      })

      const response = await provider.invoke('test')
      const json = provider.extractJSON(response)

      expect(json).toEqual({ noLanguage: true })
    })

    it('should unwrap single-element arrays', async () => {
      const provider = new MockProvider({
        defaultResponse: {
          content: '[{"unwrapped": true}]',
        },
      })

      const response = await provider.invoke('test')
      const json = provider.extractJSON(response)

      expect(json).toEqual({ unwrapped: true })
    })

    it('should validate JSON with schema', async () => {
      const schema = z.object({
        name: z.string(),
        age: z.number(),
      })

      const provider = new MockProvider({
        defaultResponse: {
          content: '{"name": "Alice", "age": 30}',
        },
      })

      const response = await provider.invoke('test')
      const json = provider.extractJSON(response, schema)

      expect(json).toEqual({ name: 'Alice', age: 30 })
    })

    it('should throw validation error for invalid schema', async () => {
      const schema = z.object({
        required: z.string(),
      })

      const provider = new MockProvider({
        defaultResponse: {
          content: '{"wrong": "field"}',
        },
      })

      const response = await provider.invoke('test')

      expect(() => provider.extractJSON(response, schema)).toThrow()

      try {
        provider.extractJSON(response, schema)
        // Should not reach here
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        if (error instanceof Error && 'type' in error) {
          expect(error.type).toBe(LLMErrorType.VALIDATION_ERROR)
        }
      }
    })

    it('should throw JSON parse error for invalid JSON', async () => {
      const provider = new MockProvider({
        defaultResponse: {
          content: 'not valid json at all',
        },
      })

      const response = await provider.invoke('test')

      expect(() => provider.extractJSON(response)).toThrow()

      try {
        provider.extractJSON(response)
        // Should not reach here
        expect.fail('Expected error to be thrown')
      } catch (error) {
        expect(error).toBeInstanceOf(Error)
        if (error instanceof Error && 'type' in error) {
          expect(error.type).toBe(LLMErrorType.JSON_PARSE_ERROR)
        }
      }
    })
  })

  describe('Queue management', () => {
    it('should report queue size correctly', () => {
      const provider = new MockProvider({
        responseQueue: [{ content: '1' }, { content: '2' }, { content: '3' }],
      })

      expect(provider.getQueueSize()).toBe(3)
      expect(provider.isQueueEmpty()).toBe(false)
    })

    it('should update queue size after invocations', async () => {
      const provider = new MockProvider({
        responseQueue: [{ content: '1' }, { content: '2' }],
      })

      expect(provider.getQueueSize()).toBe(2)

      await provider.invoke('test')
      expect(provider.getQueueSize()).toBe(1)

      await provider.invoke('test')
      expect(provider.getQueueSize()).toBe(0)
      expect(provider.isQueueEmpty()).toBe(true)
    })

    it('should set default response dynamically', async () => {
      const provider = new MockProvider()

      provider.setDefaultResponse({
        content: '{"updated": true}',
      })

      const response = await provider.invoke('test')
      expect(response.content).toBe('{"updated": true}')
    })
  })

  describe('Latency simulation', () => {
    it('should simulate realistic latency', async () => {
      const provider = new MockProvider({
        defaultResponse: {
          content: '{}',
          latencyMs: 100,
        },
      })

      const start = Date.now()
      await provider.invoke('test')
      const elapsed = Date.now() - start

      // Allow some tolerance for timer precision
      expect(elapsed).toBeGreaterThanOrEqual(90)
    })

    it('should report latency in metadata', async () => {
      const provider = new MockProvider({
        defaultResponse: {
          content: '{}',
          latencyMs: 150,
        },
      })

      const response = await provider.invoke('test')
      expect(response.metadata.wallTimeMs).toBe(150)
      expect(response.metadata.apiDurationMs).toBe(150)
    })
  })

  describe('Helper factories', () => {
    it('should create simple mock with createSimpleMock', async () => {
      const provider = createSimpleMock({ test: 'data' }, { latencyMs: 50 })

      const response = await provider.invoke('test')
      const json = provider.extractJSON(response)

      expect(json).toEqual({ test: 'data' })
      expect(response.metadata.wallTimeMs).toBe(50)
    })

    it('should create error mock with createErrorMock', async () => {
      const provider = createErrorMock(LLMErrorType.API_ERROR, 'Test error', {
        latencyMs: 25,
      })

      await expect(provider.invoke('test')).rejects.toThrow('Test error')

      const lastInvocation = provider.getLastInvocation()
      expect(lastInvocation?.error?.type).toBe(LLMErrorType.API_ERROR)
    })

    it('should support custom model in factory', () => {
      const provider = createSimpleMock({ data: 'test' }, { model: 'factory-model' })

      expect(provider.getModelName()).toBe('factory-model')
    })
  })
})
