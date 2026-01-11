import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { AnthropicCliProvider, AuthError, TimeoutError, ProviderError } from '../../index'
import { EventEmitter } from 'node:events'

/** Mock ChildProcess with guaranteed stdout/stderr (never null like real ChildProcess) */
interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
}

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

describe('AnthropicCliProvider', () => {
  let mockSpawn: any

  beforeEach(async () => {
    vi.clearAllMocks()
    const { spawn } = await import('node:child_process')
    mockSpawn = spawn as any
  })

  const createMockProcess = (): MockChildProcess => {
    const proc = new EventEmitter() as MockChildProcess
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    }
    return proc
  }

  it('creates provider with default CLI path', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
        // No cliPath specified - should default to 'claude'
      },
      logger
    )

    expect(provider.id).toBe('claude-cli')

    // Start a request to verify spawn is called with default 'claude' path
    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      mockProc.stdout.emit('data', JSON.stringify({ content: 'Response' }))
      mockProc.emit('close', 0)
    }, 10)

    await responsePromise

    // Verify the default CLI path 'claude' was used
    expect(mockSpawn).toHaveBeenCalledWith('claude', expect.any(Array), expect.any(Object))
  })

  it('uses custom CLI path when provided', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
        cliPath: '/usr/local/bin/claude-custom',
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      mockProc.stdout.emit('data', JSON.stringify({ content: 'Response' }))
      mockProc.emit('close', 0)
    }, 10)

    await responsePromise

    // Verify the custom CLI path was used
    expect(mockSpawn).toHaveBeenCalledWith('/usr/local/bin/claude-custom', expect.any(Array), expect.any(Object))
  })

  it('completes request successfully with JSON response', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // Simulate successful response
    setTimeout(() => {
      mockProc.stdout.emit(
        'data',
        JSON.stringify({
          content: 'Hello there!',
          usage: {
            input_tokens: 10,
            output_tokens: 15,
          },
        })
      )
      mockProc.emit('close', 0)
    }, 10)

    const response = await responsePromise

    expect(response.content).toBe('Hello there!')
    expect(response.model).toBe('claude-3-5-sonnet-20241022')
    expect(response.usage).toEqual({
      inputTokens: 10,
      outputTokens: 15,
    })
  })

  it('handles plain text response when JSON parsing fails', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      mockProc.stdout.emit('data', 'Plain text response')
      mockProc.emit('close', 0)
    }, 10)

    const response = await responsePromise

    expect(response.content).toBe('Plain text response')
  })

  it('parses result field from JSON response (primary field)', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      mockProc.stdout.emit(
        'data',
        JSON.stringify({
          result: 'Result field response',
          content: 'Content field response', // Should be ignored when result is present
          usage: { input_tokens: 5, output_tokens: 10 },
        })
      )
      mockProc.emit('close', 0)
    }, 10)

    const response = await responsePromise

    expect(response.content).toBe('Result field response')
  })

  it('parses message field as fallback from JSON response', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      mockProc.stdout.emit(
        'data',
        JSON.stringify({
          message: 'Message field response',
          usage: { input_tokens: 5, output_tokens: 10 },
        })
      )
      mockProc.emit('close', 0)
    }, 10)

    const response = await responsePromise

    expect(response.content).toBe('Message field response')
  })

  it('falls back to raw stdout when no recognized fields in JSON', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    const rawJson = JSON.stringify({ unrecognized_field: 'some value' })
    setTimeout(() => {
      mockProc.stdout.emit('data', rawJson)
      mockProc.emit('close', 0)
    }, 10)

    const response = await responsePromise

    // Falls back to stdout when no result/content/message
    expect(response.content).toBe(rawJson)
  })

  it('includes system prompt in request', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
      system: 'You are helpful',
    })

    setTimeout(() => {
      mockProc.stdout.emit('data', JSON.stringify({ content: 'Response' }))
      mockProc.emit('close', 0)
    }, 10)

    await responsePromise

    expect(mockProc.stdin.write).toHaveBeenCalledWith(expect.stringContaining('System: You are helpful'))
  })

  it('throws TimeoutError on exit code 124', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
        maxRetries: 1,
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      mockProc.emit('close', 124)
    }, 10)

    await expect(responsePromise).rejects.toThrow('Request timeout')
  })

  it('throws AuthError on authentication failure', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
        maxRetries: 1,
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      mockProc.stderr.emit('data', 'authentication failed')
      mockProc.emit('close', 401)
    }, 10)

    await expect(responsePromise).rejects.toThrow(AuthError)
  })

  it('throws ProviderError when CLI not found', async () => {
    const notFoundError = new Error('spawn claude ENOENT')
    ;(notFoundError as any).code = 'ENOENT'
    mockSpawn.mockReturnValue(createMockProcess())

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
        cliPath: 'nonexistent-cli',
        maxRetries: 1,
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      const proc = mockSpawn.mock.results[0].value
      proc.emit('error', notFoundError)
    }, 10)

    await expect(responsePromise).rejects.toThrow('Claude CLI not found')
  })

  it('retries on transient failures', async () => {
    vi.useFakeTimers()

    const mockProc1 = createMockProcess()
    const mockProc2 = createMockProcess()
    mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
        maxRetries: 2,
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    // First attempt fails
    await vi.advanceTimersByTimeAsync(5)
    mockProc1.stderr.emit('data', 'Server error')
    mockProc1.emit('close', 500)

    // Advance through retry delay
    await vi.advanceTimersByTimeAsync(1000)

    // Second attempt succeeds
    await vi.advanceTimersByTimeAsync(5)
    mockProc2.stdout.emit('data', JSON.stringify({ content: 'Success' }))
    mockProc2.emit('close', 0)

    const response = await responsePromise

    expect(response.content).toBe('Success')
    expect(mockSpawn).toHaveBeenCalledTimes(2)

    vi.useRealTimers()
  })

  it('does not retry AuthError', async () => {
    const mockProc = createMockProcess()
    mockSpawn.mockReturnValue(mockProc)

    const provider = new AnthropicCliProvider(
      {
        model: 'claude-3-5-sonnet-20241022',
        maxRetries: 3,
      },
      logger
    )

    const responsePromise = provider.complete({
      messages: [{ role: 'user', content: 'Hello' }],
    })

    setTimeout(() => {
      mockProc.stderr.emit('data', 'unauthorized')
      mockProc.emit('close', 401)
    }, 10)

    await expect(responsePromise).rejects.toThrow(AuthError)
    expect(mockSpawn).toHaveBeenCalledTimes(1) // No retries
  })
})
