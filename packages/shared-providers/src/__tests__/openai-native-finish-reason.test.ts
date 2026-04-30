/**
 * OpenAI Native Provider - finishReason and MalformedResponseError Tests
 *
 * RED-phase tests: these tests reference MalformedResponseError (not yet in errors.ts)
 * and LLMResponse.finishReason (not yet in @sidekick/types). Compilation errors ARE
 * the expected red signal for this phase.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { OpenAINativeProvider } from '../providers/openai-native'
import { MalformedResponseError, ProviderError } from '../errors'

// Constructor mock must use `function` keyword (Vitest 4.x requirement)
vi.mock('openai', () => {
  return {
    default: vi.fn().mockImplementation(function () {
      return {
        chat: {
          completions: {
            create: vi.fn(),
          },
        },
      }
    }),
  }
})

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

describe('OpenAINativeProvider - finishReason', () => {
  let mockCreate: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    const OpenAI = (await import('openai')).default
    vi.mocked(OpenAI).mockClear()

    // Fresh mockCreate per test — must .mockClear() not just reassign because the
    // vi.fn() created in the factory is not reset by vi.restoreAllMocks()
    mockCreate = vi.fn()
    vi.mocked(OpenAI).mockImplementation(function () {
      return {
        chat: {
          completions: {
            create: mockCreate,
          },
        },
      } as any
    })
  })

  const makeProvider = () =>
    new OpenAINativeProvider(
      {
        apiKey: 'test-key',
        model: 'gpt-4',
      },
      logger
    )

  const baseUsage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }

  it('populates finishReason === "stop" from finish_reason: "stop"', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'hi' }, finish_reason: 'stop' }],
      model: 'gpt-4',
      usage: baseUsage,
    })

    const response = await makeProvider().complete({
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(response.finishReason).toBe('stop')
  })

  it('populates finishReason === "length" from finish_reason: "length"', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'clipped' }, finish_reason: 'length' }],
      model: 'gpt-4',
      usage: baseUsage,
    })

    const response = await makeProvider().complete({
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(response.finishReason).toBe('length')
  })

  it('produces finishReason === undefined when finish_reason is null (no throw)', async () => {
    mockCreate.mockResolvedValue({
      choices: [{ message: { content: 'x' }, finish_reason: null }],
      model: 'gpt-4',
      usage: baseUsage,
    })

    const response = await makeProvider().complete({
      messages: [{ role: 'user', content: 'test' }],
    })

    expect(response.finishReason).toBeUndefined()
  })

  it('throws MalformedResponseError with code and providerMessage when choices is undefined and error envelope is present', async () => {
    mockCreate.mockResolvedValue({
      choices: undefined,
      error: { code: 'rate_exceeded', message: 'Too many' },
      model: 'gpt-4',
    })

    await expect(makeProvider().complete({ messages: [{ role: 'user', content: 'test' }] })).rejects.toSatisfy(
      (err: unknown) => {
        if (!(err instanceof MalformedResponseError)) return false
        return err.code === 'rate_exceeded' && err.providerMessage === 'Too many'
      }
    )
  })

  it('throws MalformedResponseError when choices is an empty array', async () => {
    mockCreate.mockResolvedValue({
      choices: [],
      model: 'gpt-4',
      usage: baseUsage,
    })

    await expect(makeProvider().complete({ messages: [{ role: 'user', content: 'test' }] })).rejects.toBeInstanceOf(
      MalformedResponseError
    )
  })

  it('throws MalformedResponseError with undefined code and providerMessage when neither choices nor error envelope present', async () => {
    mockCreate.mockResolvedValue({
      model: 'gpt-4',
    })

    await expect(makeProvider().complete({ messages: [{ role: 'user', content: 'test' }] })).rejects.toSatisfy(
      (err: unknown) => {
        if (!(err instanceof MalformedResponseError)) return false
        return err.code === undefined && err.providerMessage === undefined
      }
    )
  })

  it('thrown MalformedResponseError satisfies instanceof ProviderError', async () => {
    mockCreate.mockResolvedValue({
      choices: [],
      model: 'gpt-4',
    })

    await expect(makeProvider().complete({ messages: [{ role: 'user', content: 'test' }] })).rejects.toBeInstanceOf(
      ProviderError
    )
  })
})
