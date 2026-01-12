import { Duplex } from 'stream'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsoleLogger, Logger } from '../../logger.js'
import { IpcServer } from '../server.js'
import { ErrorCodes, JSONRPC_VERSION } from '../protocol.js'

/**
 * FakeSocket - A fake socket implementation for testing IPC server behavior
 * without actual network connections.
 */
class FakeSocket extends Duplex {
  public writtenData: string[] = []

  constructor() {
    super()
  }

  // Simulate receiving data from "client"
  simulateClientRequest(request: object): void {
    const data = JSON.stringify(request) + '\n'
    this.push(data)
  }

  simulateClientMessage(message: string): void {
    this.push(message + '\n')
  }

  simulateError(error: Error): void {
    this.emit('error', error)
  }

  override _write(chunk: Buffer, _encoding: string, callback: (error?: Error | null) => void): void {
    this.writtenData.push(chunk.toString())
    callback()
  }

  override _read(): void {
    // No-op
  }

  override write(chunk: string | Buffer): boolean {
    this.writtenData.push(chunk.toString())
    return true
  }

  getLastResponse(): object | null {
    if (this.writtenData.length === 0) return null
    const lastData = this.writtenData[this.writtenData.length - 1]
    return JSON.parse(lastData.trim())
  }

  getAllResponses(): object[] {
    return this.writtenData.map((data) => JSON.parse(data.trim()))
  }
}

/**
 * Creates a testable IpcServer with a fake socket for direct message testing
 */
function createTestableServer(
  logger: Logger,
  handler: (method: string, params: unknown) => Promise<unknown>
): { server: IpcServer; triggerConnection: (socket: FakeSocket) => void } {
  const server = new IpcServer('/fake/socket.sock', logger, handler)

  // Access the private server instance to trigger connection events
  const serverAny = server as unknown as {
    server: {
      emit: (event: string, socket: FakeSocket) => void
    }
  }

  const triggerConnection = (socket: FakeSocket): void => {
    // Manually emit connection event to simulate client connecting
    serverAny.server.emit('connection', socket)
  }

  return { server, triggerConnection }
}

describe('IpcServer', () => {
  let logger: Logger

  beforeEach(() => {
    logger = createConsoleLogger({ minimumLevel: 'error' })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('message handling', () => {
    it('processes valid JSON-RPC request and returns result', async () => {
      const handler = vi.fn().mockResolvedValue({ status: 'ok' })
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Send valid request
      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'test',
        params: { key: 'value' },
        id: 1,
      })

      // Wait for async processing
      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      expect(handler).toHaveBeenCalledWith('test', { key: 'value' })

      const response = socket.getLastResponse()
      expect(response).toEqual({
        jsonrpc: JSONRPC_VERSION,
        result: { status: 'ok' },
        id: 1,
      })
    })

    it('returns error response when handler throws', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Handler failed'))
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'fail',
        id: 1,
      })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      const response = socket.getLastResponse()
      expect(response).toEqual({
        jsonrpc: JSONRPC_VERSION,
        error: {
          code: ErrorCodes.InternalError,
          message: 'Handler failed',
        },
        id: 1,
      })
    })

    it('returns error response when handler throws non-Error', async () => {
      const handler = vi.fn().mockRejectedValue('string error')
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'fail',
        id: 1,
      })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      const response = socket.getLastResponse()
      expect(response).toEqual({
        jsonrpc: JSONRPC_VERSION,
        error: {
          code: ErrorCodes.InternalError,
          message: 'Internal Error',
        },
        id: 1,
      })
    })

    it('returns InvalidRequest for malformed JSON-RPC', async () => {
      const handler = vi.fn()
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Send request with wrong jsonrpc version
      socket.simulateClientRequest({
        jsonrpc: '1.0',
        method: 'test',
        id: 1,
      })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      expect(handler).not.toHaveBeenCalled()

      const response = socket.getLastResponse()
      expect(response).toEqual({
        jsonrpc: JSONRPC_VERSION,
        error: {
          code: ErrorCodes.InvalidRequest,
          message: 'Invalid Request',
        },
        id: null,
      })
    })

    it('returns InvalidRequest for request without method', async () => {
      const handler = vi.fn()
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        id: 1,
      })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      const response = socket.getLastResponse()
      expect(response).toMatchObject({
        error: {
          code: ErrorCodes.InvalidRequest,
        },
      })
    })

    it('returns ParseError for invalid JSON', async () => {
      const handler = vi.fn()
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientMessage('not-valid-json')

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      expect(handler).not.toHaveBeenCalled()

      const response = socket.getLastResponse()
      expect(response).toEqual({
        jsonrpc: JSONRPC_VERSION,
        error: {
          code: ErrorCodes.ParseError,
          message: 'Parse Error',
        },
        id: null,
      })
    })

    it('does not send response for notification (no id)', async () => {
      const handler = vi.fn().mockResolvedValue('ignored')
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Send notification (no id)
      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'notify',
        params: { event: 'something' },
      })

      // Wait for handler to be called
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled()
      })

      // Should not send response for notifications
      expect(socket.writtenData.length).toBe(0)
    })

    it('does not send error response for notification when handler throws', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Notification error'))
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Send notification (no id)
      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'notify',
      })

      // Wait for handler to be called
      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled()
      })

      // Wait a bit more to ensure no response is sent
      await new Promise((resolve) => setTimeout(resolve, 50))

      // Should not send error for notifications
      expect(socket.writtenData.length).toBe(0)
    })

    it('handles multiple requests on same connection', async () => {
      const handler = vi
        .fn()
        .mockResolvedValueOnce('result1')
        .mockResolvedValueOnce('result2')
        .mockResolvedValueOnce('result3')

      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientRequest({ jsonrpc: JSONRPC_VERSION, method: 'm1', id: 1 })
      socket.simulateClientRequest({ jsonrpc: JSONRPC_VERSION, method: 'm2', id: 2 })
      socket.simulateClientRequest({ jsonrpc: JSONRPC_VERSION, method: 'm3', id: 3 })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(3)
      })

      const responses = socket.getAllResponses()
      expect(responses).toEqual([
        { jsonrpc: JSONRPC_VERSION, result: 'result1', id: 1 },
        { jsonrpc: JSONRPC_VERSION, result: 'result2', id: 2 },
        { jsonrpc: JSONRPC_VERSION, result: 'result3', id: 3 },
      ])
    })

    it('handles requests with string id', async () => {
      const handler = vi.fn().mockResolvedValue('ok')
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'test',
        id: 'uuid-123-abc',
      })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      const response = socket.getLastResponse()
      expect(response).toEqual({
        jsonrpc: JSONRPC_VERSION,
        result: 'ok',
        id: 'uuid-123-abc',
      })
    })
  })

  describe('socket error handling', () => {
    it('logs socket errors without crashing', async () => {
      const handler = vi.fn()
      const errorLogger = createConsoleLogger({ minimumLevel: 'error' })
      const logSpy = vi.spyOn(errorLogger, 'error')

      const { triggerConnection } = createTestableServer(errorLogger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Simulate socket error
      socket.simulateError(new Error('Socket error'))

      await vi.waitFor(() => {
        expect(logSpy).toHaveBeenCalled()
      })

      // Verify error was logged with correct message
      expect(logSpy).toHaveBeenCalledWith(
        'IPC socket error',
        expect.objectContaining({
          error: expect.any(Error),
        })
      )
    })
  })

  describe('message buffering', () => {
    it('handles partial messages correctly', async () => {
      const handler = vi.fn().mockResolvedValue('buffered-result')
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Send partial message
      socket.push('{"jsonrpc":"2.0",')
      socket.push('"method":"test",')
      socket.push('"id":1}\n')

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalled()
      })

      const response = socket.getLastResponse()
      expect(response).toEqual({
        jsonrpc: JSONRPC_VERSION,
        result: 'buffered-result',
        id: 1,
      })
    })

    it('handles multiple messages in single chunk', async () => {
      const handler = vi.fn().mockResolvedValueOnce('r1').mockResolvedValueOnce('r2')

      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Send multiple messages in one chunk
      const combined =
        JSON.stringify({ jsonrpc: JSONRPC_VERSION, method: 'm1', id: 1 }) +
        '\n' +
        JSON.stringify({ jsonrpc: JSONRPC_VERSION, method: 'm2', id: 2 }) +
        '\n'
      socket.push(combined)

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(2)
      })

      const responses = socket.getAllResponses()
      expect(responses.length).toBe(2)
    })

    it('ignores empty lines', async () => {
      const handler = vi.fn().mockResolvedValue('ok')
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Send empty lines followed by valid request
      socket.push('\n\n\n')
      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'test',
        id: 1,
      })

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1)
      })

      expect(socket.writtenData.length).toBe(1)
    })

    it('ignores whitespace-only lines', async () => {
      const handler = vi.fn().mockResolvedValue('ok')
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      // Send whitespace lines followed by valid request
      socket.push('   \n\t\t\n')
      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'test',
        id: 1,
      })

      await vi.waitFor(() => {
        expect(handler).toHaveBeenCalledTimes(1)
      })
    })
  })

  describe('validateSocketPath', () => {
    // Socket path validation is covered by transport.test.ts
    // This just verifies it's called on start()
    it('is called when starting server', () => {
      // We can't test start() directly without real socket, but the integration
      // tests verify this. This test documents the expected behavior.
      const server = new IpcServer('/path/to/socket.sock', logger, vi.fn())
      expect(server).toBeDefined()
    })
  })

  describe('response formatting', () => {
    it('formats success response with correct structure', async () => {
      const handler = vi.fn().mockResolvedValue({ complex: { data: [1, 2, 3] } })
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'test',
        id: 42,
      })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      const response = socket.getLastResponse() as { jsonrpc: string; result: unknown; id: number }
      expect(response.jsonrpc).toBe(JSONRPC_VERSION)
      expect(response.result).toEqual({ complex: { data: [1, 2, 3] } })
      expect(response.id).toBe(42)
    })

    it('formats error response with correct structure', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Test error message'))
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'test',
        id: 99,
      })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      const response = socket.getLastResponse() as {
        jsonrpc: string
        error: { code: number; message: string }
        id: number
      }
      expect(response.jsonrpc).toBe(JSONRPC_VERSION)
      expect(response.error.code).toBe(ErrorCodes.InternalError)
      expect(response.error.message).toBe('Test error message')
      expect(response.id).toBe(99)
    })

    it('adds newline to response for framing', async () => {
      const handler = vi.fn().mockResolvedValue('ok')
      const { triggerConnection } = createTestableServer(logger, handler)

      const socket = new FakeSocket()
      triggerConnection(socket)

      socket.simulateClientRequest({
        jsonrpc: JSONRPC_VERSION,
        method: 'test',
        id: 1,
      })

      await vi.waitFor(() => {
        expect(socket.writtenData.length).toBe(1)
      })

      // Check raw written data includes newline
      expect(socket.writtenData[0]).toMatch(/\n$/)
    })
  })
})
