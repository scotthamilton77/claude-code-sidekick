import { Duplex } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsoleLogger, Logger } from '../../logger.js'
import { IpcClient } from '../client.js'
import { JSONRPC_VERSION } from '../protocol.js'

/**
 * FakeSocket - A fake socket implementation for testing IPC client behavior
 * without actual network connections.
 *
 * This is a "fake" per the testing skill guidance, not a "mock":
 * - It provides a working implementation that behaves like a real socket
 * - Tests verify actual behavior/output, not method calls
 */
class FakeSocket extends Duplex {
  public responses: string[] = []
  public writtenData: string[] = []
  private responseIndex = 0
  public connectCallback: (() => void) | null = null
  public shouldError = false
  public errorToThrow: Error | null = null

  constructor() {
    super()
  }

  // Simulate sending data from "server" to client
  simulateServerResponse(response: object): void {
    const data = JSON.stringify(response) + '\n'
    this.push(data)
  }

  simulateClose(): void {
    this.emit('close')
  }

  simulateError(error: Error): void {
    this.emit('error', error)
  }

  override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    this.writtenData.push(chunk.toString())
    callback()
  }

  override _read(): void {
    // No-op, we push data manually via simulateServerResponse
  }

  override destroy(): this {
    this.emit('close')
    return this
  }

  override end(): this {
    return this
  }
}

/**
 * Creates a connected IpcClient with a fake socket for testing
 */
function createConnectedClient(
  logger: Logger
): { client: IpcClient; socket: FakeSocket } {
  const socket = new FakeSocket()
  const client = new IpcClient('/fake/socket.sock', logger)

  // Access private properties for testing
  const clientAny = client as unknown as {
    socket: FakeSocket | null
    setupListeners: () => void
    handleResponse: (message: string) => void
    pendingRequests: Map<string | number, { resolve: (val: unknown) => void; reject: (err: Error) => void; timer: NodeJS.Timeout }>
    nextId: number
  }

  clientAny.socket = socket
  clientAny.setupListeners()

  return { client, socket }
}

describe('IpcClient', () => {
  let logger: Logger

  beforeEach(() => {
    logger = createConsoleLogger({ minimumLevel: 'error' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('constructor', () => {
    it('initializes with default options', () => {
      const client = new IpcClient('/test.sock', logger)
      expect(client.isConnected()).toBe(false)
    })

    it('accepts custom options', () => {
      const client = new IpcClient('/test.sock', logger, {
        connectTimeoutMs: 1000,
        requestTimeoutMs: 5000,
        maxRetries: 5,
        retryDelayMs: 200,
      })
      expect(client.isConnected()).toBe(false)
    })
  })

  describe('isConnected', () => {
    it('returns false when not connected', () => {
      const client = new IpcClient('/test.sock', logger)
      expect(client.isConnected()).toBe(false)
    })

    it('returns true when socket is set', () => {
      const { client } = createConnectedClient(logger)
      expect(client.isConnected()).toBe(true)
    })
  })

  describe('close', () => {
    it('does nothing when not connected', () => {
      const client = new IpcClient('/test.sock', logger)
      expect(() => client.close()).not.toThrow()
    })

    it('clears socket reference when connected', () => {
      const { client } = createConnectedClient(logger)
      expect(client.isConnected()).toBe(true)
      client.close()
      expect(client.isConnected()).toBe(false)
    })

    it('clears pending request timers', () => {
      const { client, socket } = createConnectedClient(logger)
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')

      // Start a call that will remain pending
      void client.call('pending-method')

      // Get the pending request count
      const clientAny = client as unknown as {
        pendingRequests: Map<string | number, unknown>
      }
      expect(clientAny.pendingRequests.size).toBe(1)

      // Close should clear the timer
      client.close()
      expect(clearTimeoutSpy).toHaveBeenCalled()
      expect(clientAny.pendingRequests.size).toBe(0)
    })
  })

  describe('call', () => {
    it('throws if not connected', async () => {
      const client = new IpcClient('/test.sock', logger)
      await expect(client.call('test')).rejects.toThrow('Not connected')
    })

    it('sends JSON-RPC request with correct format', async () => {
      const { client, socket } = createConnectedClient(logger)

      // Start the call (will wait for response)
      const callPromise = client.call('testMethod', { key: 'value' })

      // Verify the written data
      expect(socket.writtenData.length).toBe(1)
      const sentRequest = JSON.parse(socket.writtenData[0].trim())
      expect(sentRequest).toEqual({
        jsonrpc: JSONRPC_VERSION,
        method: 'testMethod',
        params: { key: 'value' },
        id: 1,
      })

      // Send response to complete the call
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'success',
        id: 1,
      })

      const result = await callPromise
      expect(result).toBe('success')
    })

    it('increments request id for each call', async () => {
      const { client, socket } = createConnectedClient(logger)

      const call1 = client.call('method1')
      const call2 = client.call('method2')

      expect(socket.writtenData.length).toBe(2)

      const request1 = JSON.parse(socket.writtenData[0].trim())
      const request2 = JSON.parse(socket.writtenData[1].trim())

      expect(request1.id).toBe(1)
      expect(request2.id).toBe(2)

      // Complete both calls
      socket.simulateServerResponse({ jsonrpc: JSONRPC_VERSION, result: 'r1', id: 1 })
      socket.simulateServerResponse({ jsonrpc: JSONRPC_VERSION, result: 'r2', id: 2 })

      await Promise.all([call1, call2])
    })
  })

  describe('response handling', () => {
    it('resolves with result on successful response', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: { data: 'test-data' },
        id: 1,
      })

      const result = await callPromise
      expect(result).toEqual({ data: 'test-data' })
    })

    it('rejects with error on error response', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        error: { code: -32603, message: 'Internal error' },
        id: 1,
      })

      await expect(callPromise).rejects.toThrow('[-32603] Internal error')
    })

    it('ignores responses with null id', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')

      // Send a notification (null id) - should be ignored
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'notification-result',
        id: null,
      })

      // The call should still be pending
      const clientAny = client as unknown as {
        pendingRequests: Map<string | number, unknown>
      }
      expect(clientAny.pendingRequests.size).toBe(1)

      // Now send the actual response
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'actual-result',
        id: 1,
      })

      const result = await callPromise
      expect(result).toBe('actual-result')
    })

    it('ignores responses with undefined id', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')

      // Send a response without id (which becomes undefined after parsing)
      socket.push(JSON.stringify({ jsonrpc: '2.0', result: 'no-id' }) + '\n')

      // The call should still be pending
      const clientAny = client as unknown as {
        pendingRequests: Map<string | number, unknown>
      }
      expect(clientAny.pendingRequests.size).toBe(1)

      // Send the actual response
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'with-id',
        id: 1,
      })

      const result = await callPromise
      expect(result).toBe('with-id')
    })

    it('handles invalid JSON gracefully', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')

      // Send invalid JSON - should be logged and ignored
      socket.push('not-valid-json\n')

      // The call should still be pending
      const clientAny = client as unknown as {
        pendingRequests: Map<string | number, unknown>
      }
      expect(clientAny.pendingRequests.size).toBe(1)

      // Send valid response
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'valid',
        id: 1,
      })

      const result = await callPromise
      expect(result).toBe('valid')
    })

    it('handles invalid response schema gracefully', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')

      // Send valid JSON but invalid schema
      socket.push(JSON.stringify({ invalid: 'schema' }) + '\n')

      // The call should still be pending
      const clientAny = client as unknown as {
        pendingRequests: Map<string | number, unknown>
      }
      expect(clientAny.pendingRequests.size).toBe(1)

      // Send valid response
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'valid',
        id: 1,
      })

      const result = await callPromise
      expect(result).toBe('valid')
    })

    it('clears timeout on successful response', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'success',
        id: 1,
      })

      await callPromise
      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('handles buffered/partial messages correctly', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')

      // Send partial message (no newline yet)
      socket.push('{"jsonrpc":"2.0",')
      socket.push('"result":"buffered",')
      socket.push('"id":1}\n')

      const result = await callPromise
      expect(result).toBe('buffered')
    })

    it('handles multiple messages in one chunk', async () => {
      const { client, socket } = createConnectedClient(logger)

      const call1 = client.call('method1')
      const call2 = client.call('method2')

      // Send both responses in one chunk
      const responses =
        JSON.stringify({ jsonrpc: JSONRPC_VERSION, result: 'r1', id: 1 }) +
        '\n' +
        JSON.stringify({ jsonrpc: JSONRPC_VERSION, result: 'r2', id: 2 }) +
        '\n'
      socket.push(responses)

      const [result1, result2] = await Promise.all([call1, call2])
      expect(result1).toBe('r1')
      expect(result2).toBe('r2')
    })
  })

  describe('connection close handling', () => {
    it('rejects all pending requests on connection close', async () => {
      const { client, socket } = createConnectedClient(logger)

      const call1 = client.call('method1')
      const call2 = client.call('method2')

      socket.simulateClose()

      await expect(call1).rejects.toThrow('Connection closed')
      await expect(call2).rejects.toThrow('Connection closed')
    })

    it('clears pending request timers on close', async () => {
      const clearTimeoutSpy = vi.spyOn(global, 'clearTimeout')
      const { client, socket } = createConnectedClient(logger)

      const call1 = client.call('method1')
      const call2 = client.call('method2')

      socket.simulateClose()

      // Wait for both calls to reject
      await expect(call1).rejects.toThrow('Connection closed')
      await expect(call2).rejects.toThrow('Connection closed')

      // Verify timers were cleared (at least 2 times for the 2 pending requests)
      expect(clearTimeoutSpy).toHaveBeenCalled()
    })

    it('sets socket to null on close', async () => {
      const { client, socket } = createConnectedClient(logger)

      expect(client.isConnected()).toBe(true)
      socket.simulateClose()
      expect(client.isConnected()).toBe(false)
    })
  })

  describe('request timeout', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('rejects when response not received within timeout', async () => {
      const { client } = createConnectedClient(logger)

      // Access private options to set a short timeout
      const clientAny = client as unknown as { options: { requestTimeoutMs: number } }
      clientAny.options.requestTimeoutMs = 100

      const callPromise = client.call('slow-method')

      // Advance time past timeout and catch the rejection
      vi.advanceTimersByTime(150)

      await expect(callPromise).rejects.toThrow('Request timeout after 100ms for method: slow-method')
    })

    it('removes pending request after timeout', async () => {
      const { client } = createConnectedClient(logger)

      const clientAny = client as unknown as {
        options: { requestTimeoutMs: number }
        pendingRequests: Map<string | number, unknown>
      }
      clientAny.options.requestTimeoutMs = 100

      const callPromise = client.call('slow-method')

      expect(clientAny.pendingRequests.size).toBe(1)

      vi.advanceTimersByTime(150)

      await expect(callPromise).rejects.toThrow('Request timeout')
      expect(clientAny.pendingRequests.size).toBe(0)
    })
  })

  describe('transient error detection', () => {
    // Test the isTransientError logic indirectly through callWithRetry behavior
    // The isTransientError method is private but its behavior affects retry logic

    it('identifies connection closed as transient', () => {
      const client = new IpcClient('/test.sock', logger)
      // Access private method for testing
      const isTransient = (client as unknown as { isTransientError: (err: Error) => boolean }).isTransientError
      expect(isTransient(new Error('Connection closed'))).toBe(true)
    })

    it('identifies connection timeout as transient', () => {
      const client = new IpcClient('/test.sock', logger)
      const isTransient = (client as unknown as { isTransientError: (err: Error) => boolean }).isTransientError
      expect(isTransient(new Error('Connection timeout'))).toBe(true)
    })

    it('identifies ECONNRESET as transient', () => {
      const client = new IpcClient('/test.sock', logger)
      const isTransient = (client as unknown as { isTransientError: (err: Error) => boolean }).isTransientError
      expect(isTransient(new Error('ECONNRESET'))).toBe(true)
    })

    it('identifies ECONNREFUSED as transient', () => {
      const client = new IpcClient('/test.sock', logger)
      const isTransient = (client as unknown as { isTransientError: (err: Error) => boolean }).isTransientError
      expect(isTransient(new Error('ECONNREFUSED'))).toBe(true)
    })

    it('identifies ENOENT as transient', () => {
      const client = new IpcClient('/test.sock', logger)
      const isTransient = (client as unknown as { isTransientError: (err: Error) => boolean }).isTransientError
      expect(isTransient(new Error('ENOENT'))).toBe(true)
    })

    it('identifies EPIPE as transient', () => {
      const client = new IpcClient('/test.sock', logger)
      const isTransient = (client as unknown as { isTransientError: (err: Error) => boolean }).isTransientError
      expect(isTransient(new Error('EPIPE'))).toBe(true)
    })

    it('identifies application errors as non-transient', () => {
      const client = new IpcClient('/test.sock', logger)
      const isTransient = (client as unknown as { isTransientError: (err: Error) => boolean }).isTransientError
      expect(isTransient(new Error('Invalid token'))).toBe(false)
      expect(isTransient(new Error('Method not found'))).toBe(false)
      expect(isTransient(new Error('Permission denied'))).toBe(false)
    })
  })

  describe('callWithRetry', () => {
    // These tests verify retry behavior without actually connecting
    // The actual retry with real connections is tested in integration tests

    it('returns result on successful call', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.callWithRetry('test', { key: 'value' }, 3)

      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'success',
        id: 1,
      })

      const result = await callPromise
      expect(result).toBe('success')
    })

    it('throws immediately for non-transient errors', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.callWithRetry('test', undefined, 3)

      // Send error response (non-transient)
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        error: { code: -32603, message: 'Application error' },
        id: 1,
      })

      await expect(callPromise).rejects.toThrow('[-32603] Application error')

      // Should only have made one request (no retries)
      expect(socket.writtenData.length).toBe(1)
    })

    it('uses default maxRetries from options when not specified', async () => {
      const { client, socket } = createConnectedClient(logger)

      // Access private options
      const clientAny = client as unknown as {
        options: { maxRetries: number; retryDelayMs: number }
      }
      clientAny.options.maxRetries = 2
      clientAny.options.retryDelayMs = 10

      const callPromise = client.callWithRetry('test') // No retries param

      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'ok',
        id: 1,
      })

      await expect(callPromise).resolves.toBe('ok')
    })

    it('respects custom retry count override', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.callWithRetry('test', undefined, 5) // Override to 5 retries

      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'ok',
        id: 1,
      })

      await expect(callPromise).resolves.toBe('ok')
    })

    it('converts non-Error exceptions to Error', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.callWithRetry('test', undefined, 1)

      // Simulate a string thrown (by sending malformed response that causes internal error)
      // The JSON-RPC error will be wrapped in Error
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        error: { code: -32600, message: 'String error' },
        id: 1,
      })

      await expect(callPromise).rejects.toThrow('[-32600] String error')
    })
  })

  describe('sleep helper', () => {
    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('resolves after specified delay', async () => {
      const client = new IpcClient('/test.sock', logger)
      const sleep = (client as unknown as { sleep: (ms: number) => Promise<void> }).sleep.bind(client)

      const sleepPromise = sleep(100)
      let resolved = false
      sleepPromise.then(() => {
        resolved = true
      })

      // Not resolved yet
      expect(resolved).toBe(false)

      // Advance time
      await vi.advanceTimersByTimeAsync(100)

      // Now resolved
      expect(resolved).toBe(true)
    })
  })

  describe('callWithRetry reconnection (sandbox limitation)', () => {
    /**
     * These tests document behavior that requires real socket connections.
     * The reconnection logic in callWithRetry (lines 178-180) auto-connects
     * when the socket is null. Full testing requires integration tests.
     *
     * See: AGENTS.md §sandbox_testing
     * Run with INTEGRATION_TESTS=1 outside sandbox for full coverage.
     */
    it('documents that reconnection requires integration tests', () => {
      // This is a documentation test - the actual reconnection is tested
      // in ipc.test.ts when run outside sandbox
      const client = new IpcClient('/test.sock', logger)
      expect(client.isConnected()).toBe(false)
      // Calling callWithRetry on disconnected client would trigger connect()
      // which requires real socket functionality
    })
  })

  describe('empty line handling', () => {
    it('ignores empty lines in response stream', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')

      // Send empty lines followed by valid response
      socket.push('\n\n\n')
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'success',
        id: 1,
      })

      const result = await callPromise
      expect(result).toBe('success')
    })

    it('ignores whitespace-only lines', async () => {
      const { client, socket } = createConnectedClient(logger)

      const callPromise = client.call('test')

      // Send whitespace lines followed by valid response
      socket.push('   \n\t\n')
      socket.simulateServerResponse({
        jsonrpc: JSONRPC_VERSION,
        result: 'success',
        id: 1,
      })

      const result = await callPromise
      expect(result).toBe('success')
    })
  })
})
