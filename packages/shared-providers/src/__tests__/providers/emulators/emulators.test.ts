/**
 * Emulator Tests
 *
 * Tests for OpenAIEmulator, OpenRouterEmulator, and base emulator functionality.
 * Uses a fake EmulatorStateManager to test behavior without file I/O.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LLMRequest, Logger } from '@sidekick/types'
import { OpenAIEmulator } from '../../../providers/emulators/openai-emulator'
import { OpenRouterEmulator } from '../../../providers/emulators/openrouter-emulator'
import type { EmulatorStateManager } from '../../../providers/emulators/emulator-state'

// Fake EmulatorStateManager - simple working implementation
function createFakeStateManager(): EmulatorStateManager {
  const counts = new Map<string, number>()

  return {
    load: vi.fn().mockResolvedValue({ version: 1, providers: {} }),
    incrementCallCount: vi.fn().mockImplementation((providerId: string) => {
      const count = (counts.get(providerId) ?? 0) + 1
      counts.set(providerId, count)
      return Promise.resolve(count)
    }),
    getCallCount: vi.fn().mockImplementation((providerId: string) => {
      return Promise.resolve(counts.get(providerId) ?? 0)
    }),
    reset: vi.fn().mockResolvedValue(undefined),
  } as unknown as EmulatorStateManager
}

// Fake logger
function createFakeLogger(): Logger {
  return {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
    child: vi.fn().mockReturnThis(),
    flush: vi.fn().mockResolvedValue(undefined),
  } as unknown as Logger
}

// Standard test request
const testRequest: LLMRequest = {
  messages: [{ role: 'user', content: 'Hello, world!' }],
  system: 'You are a helpful assistant.',
}

describe('OpenAIEmulator', () => {
  let stateManager: ReturnType<typeof createFakeStateManager>
  let logger: Logger
  let emulator: OpenAIEmulator

  beforeEach(() => {
    stateManager = createFakeStateManager()
    logger = createFakeLogger()
    emulator = new OpenAIEmulator(stateManager, { model: 'gpt-4' }, logger)
  })

  describe('complete', () => {
    it('returns response with correct content format', async () => {
      const response = await emulator.complete(testRequest)

      expect(response.content).toMatch(/\[OpenAI Emulator\] Call #1 - Model: gpt-4/)
    })

    it('uses request model when provided', async () => {
      const response = await emulator.complete({
        ...testRequest,
        model: 'gpt-4-turbo',
      })

      expect(response.model).toBe('gpt-4-turbo')
      expect(response.content).toContain('gpt-4-turbo')
    })

    it('uses config model when request model not provided', async () => {
      const response = await emulator.complete(testRequest)

      expect(response.model).toBe('gpt-4')
    })

    it('uses default model when neither request nor config model provided', async () => {
      const emulatorNoConfig = new OpenAIEmulator(stateManager, {}, logger)
      const response = await emulatorNoConfig.complete(testRequest)

      expect(response.model).toBe('gpt-4')
    })

    it('increments call count with state manager', async () => {
      await emulator.complete(testRequest)
      await emulator.complete(testRequest)

      expect(stateManager.incrementCallCount).toHaveBeenCalledTimes(2)
      expect(stateManager.incrementCallCount).toHaveBeenCalledWith('openai')
    })

    it('includes call number in response', async () => {
      const response1 = await emulator.complete(testRequest)
      const response2 = await emulator.complete(testRequest)

      expect(response1.content).toContain('Call #1')
      expect(response2.content).toContain('Call #2')
    })

    it('returns token usage estimates', async () => {
      const response = await emulator.complete(testRequest)

      expect(response.usage).toBeDefined()
      expect(response.usage?.inputTokens).toBeGreaterThan(0)
      expect(response.usage?.outputTokens).toBeGreaterThan(0)
    })

    it('estimates input tokens from system and messages', async () => {
      const response = await emulator.complete({
        messages: [
          { role: 'user', content: 'A'.repeat(100) }, // 100 chars = ~25 tokens
        ],
        system: 'B'.repeat(80), // 80 chars = 20 tokens
      })

      // (100 + 80) / 4 = 45 tokens expected
      expect(response.usage?.inputTokens).toBe(45)
    })

    it('estimates input tokens without system message', async () => {
      const response = await emulator.complete({
        messages: [
          { role: 'user', content: 'A'.repeat(40) }, // 40 chars = 10 tokens
        ],
      })

      expect(response.usage?.inputTokens).toBe(10)
    })

    it('returns OpenAI-compatible raw response', async () => {
      const response = await emulator.complete(testRequest)

      expect(response.rawResponse.status).toBe(200)
      expect(response.rawResponse.body).toBeDefined()

      const body = JSON.parse(response.rawResponse.body)
      expect(body.object).toBe('chat.completion')
      expect(body.choices[0].message.role).toBe('assistant')
      expect(body.choices[0].finish_reason).toBe('stop')
      expect(body.usage.prompt_tokens).toBe(response.usage?.inputTokens)
      expect(body.usage.completion_tokens).toBe(response.usage?.outputTokens)
    })

    it('logs request and response', async () => {
      await emulator.complete(testRequest)

      expect(logger.debug).toHaveBeenCalledWith(
        'LLM request initiated',
        expect.objectContaining({
          provider: 'openai-emulator',
          messageCount: 1,
          hasSystem: true,
        })
      )
      expect(logger.info).toHaveBeenCalledWith(
        'LLM request completed',
        expect.objectContaining({
          provider: 'openai-emulator',
          status: 200,
        })
      )
    })
  })

  describe('id', () => {
    it('returns openai-emulator', () => {
      expect(emulator.id).toBe('openai-emulator')
    })
  })
})

describe('OpenRouterEmulator', () => {
  let stateManager: ReturnType<typeof createFakeStateManager>
  let logger: Logger
  let emulator: OpenRouterEmulator

  beforeEach(() => {
    stateManager = createFakeStateManager()
    logger = createFakeLogger()
    emulator = new OpenRouterEmulator(stateManager, { model: 'openai/gpt-4' }, logger)
  })

  describe('complete', () => {
    it('returns response with correct content format', async () => {
      const response = await emulator.complete(testRequest)

      expect(response.content).toMatch(/\[OpenRouter Emulator\] Call #1 - Model: openai\/gpt-4/)
    })

    it('uses request model when provided', async () => {
      const response = await emulator.complete({
        ...testRequest,
        model: 'anthropic/claude-3',
      })

      expect(response.model).toBe('anthropic/claude-3')
      expect(response.content).toContain('anthropic/claude-3')
    })

    it('uses default model when neither request nor config model provided', async () => {
      const emulatorNoConfig = new OpenRouterEmulator(stateManager, {}, logger)
      const response = await emulatorNoConfig.complete(testRequest)

      expect(response.model).toBe('openai/gpt-4')
    })

    it('increments call count with state manager for openrouter', async () => {
      await emulator.complete(testRequest)

      expect(stateManager.incrementCallCount).toHaveBeenCalledWith('openrouter')
    })

    it('returns OpenRouter-compatible raw response', async () => {
      const response = await emulator.complete(testRequest)

      expect(response.rawResponse.status).toBe(200)

      const body = JSON.parse(response.rawResponse.body)
      expect(body.id).toMatch(/^gen-emu-/)
      expect(body.object).toBe('chat.completion')
    })
  })

  describe('id', () => {
    it('returns openrouter-emulator', () => {
      expect(emulator.id).toBe('openrouter-emulator')
    })
  })
})

describe('Emulator token estimation', () => {
  let stateManager: ReturnType<typeof createFakeStateManager>
  let logger: Logger
  let emulator: OpenAIEmulator

  beforeEach(() => {
    stateManager = createFakeStateManager()
    logger = createFakeLogger()
    emulator = new OpenAIEmulator(stateManager, {}, logger)
  })

  it('calculates output tokens from response content', async () => {
    const response = await emulator.complete(testRequest)

    // Output content is "[OpenAI Emulator] Call #1 - Model: gpt-4" (~40 chars)
    // Expected: ceil(40 / 4) = 10 tokens (approximately)
    expect(response.usage?.outputTokens).toBeGreaterThan(5)
    expect(response.usage?.outputTokens).toBeLessThan(20)
  })

  it('handles multiple messages for input token estimation', async () => {
    const response = await emulator.complete({
      messages: [
        { role: 'user', content: 'A'.repeat(20) },
        { role: 'assistant', content: 'B'.repeat(20) },
        { role: 'user', content: 'C'.repeat(20) },
      ],
    })

    // 60 chars / 4 = 15 tokens
    expect(response.usage?.inputTokens).toBe(15)
  })
})
