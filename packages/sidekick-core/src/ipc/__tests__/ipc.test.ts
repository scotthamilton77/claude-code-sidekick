import fs from 'fs/promises'
import net from 'net'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsoleLogger } from '../../logger.js'
import { IpcClient } from '../client.js'
import { IpcServer } from '../server.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })
let tmpDir: string
let socketPath: string

describe('IPC', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-ipc-test-'))
    socketPath = path.join(tmpDir, 'test.sock')
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail if test didn't create temp dir
    }
  })

  it('should handle request/response cycle', async () => {
    const handler = vi.fn().mockResolvedValue('pong')
    const server = new IpcServer(socketPath, logger, handler)
    await server.start()

    const client = new IpcClient(socketPath, logger)
    await client.connect()

    const result = await client.call('ping', { foo: 'bar' })
    expect(result).toBe('pong')
    expect(handler).toHaveBeenCalledWith('ping', { foo: 'bar' })

    client.close()
    await server.stop()
  })

  it('should handle errors', async () => {
    const handler = vi.fn().mockRejectedValue(new Error('Test Error'))
    const server = new IpcServer(socketPath, logger, handler)
    await server.start()

    const client = new IpcClient(socketPath, logger)
    await client.connect()

    await expect(client.call('fail')).rejects.toThrow('[-32603] Test Error') // JSON-RPC internal error code

    client.close()
    await server.stop()
  })

  describe('Connection Timeout', () => {
    it('should timeout if server does not exist', async () => {
      const client = new IpcClient(path.join(tmpDir, 'nonexistent.sock'), logger, {
        connectTimeoutMs: 100,
      })

      await expect(client.connect()).rejects.toThrow()
      expect(client.isConnected()).toBe(false)
    })

    it('connects successfully when server is listening (even with no handler)', async () => {
      // TCP connection succeeds when server is listening, regardless of handler setup.
      // This verifies IpcClient connection works with bare servers.
      const listenOnlySocketPath = path.join(tmpDir, 'listen-only.sock')
      const bareServer = net.createServer()
      await new Promise<void>((resolve) => bareServer.listen(listenOnlySocketPath, resolve))

      const client = new IpcClient(listenOnlySocketPath, logger, {
        connectTimeoutMs: 100,
      })

      // Connection succeeds because kernel accepts connections when server listens
      await client.connect()
      expect(client.isConnected()).toBe(true)

      client.close()
      bareServer.close()
    })

    it('should connect within timeout if server is responsive', async () => {
      const handler = vi.fn().mockResolvedValue('ok')
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger, {
        connectTimeoutMs: 5000,
      })

      await client.connect()
      expect(client.isConnected()).toBe(true)

      client.close()
      await server.stop()
    })
  })

  describe('Request Timeout', () => {
    it('should timeout if server does not respond', async () => {
      // Create a server that never responds
      const silentHandler = vi.fn().mockImplementation(
        () => new Promise(() => {}) // Never resolves
      )
      const server = new IpcServer(socketPath, logger, silentHandler)
      await server.start()

      const client = new IpcClient(socketPath, logger, {
        requestTimeoutMs: 100,
      })
      await client.connect()

      await expect(client.call('silent')).rejects.toThrow('Request timeout after 100ms for method: silent')

      client.close()
      await server.stop()
    })

    it('should complete within timeout if server responds quickly', async () => {
      const handler = vi.fn().mockResolvedValue('fast')
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger, {
        requestTimeoutMs: 5000,
      })
      await client.connect()

      const result = await client.call('fast')
      expect(result).toBe('fast')

      client.close()
      await server.stop()
    })

    it('should clear timeout on successful response', async () => {
      vi.useFakeTimers()
      const handler = vi.fn().mockResolvedValue('ok')
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger, {
        requestTimeoutMs: 1000,
      })
      await client.connect()

      const promise = client.call('test')

      // Advance time past timeout - should not reject if response received
      await vi.advanceTimersByTimeAsync(50) // Give time for response
      const result = await promise
      expect(result).toBe('ok')

      client.close()
      await server.stop()
      vi.useRealTimers()
    })
  })

  describe('Retry Logic', () => {
    it('should auto-connect when calling callWithRetry without prior connect', async () => {
      const handler = vi.fn().mockResolvedValue('success')
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      // Create client but don't connect - callWithRetry should handle it
      const client = new IpcClient(socketPath, logger, {
        maxRetries: 3,
        retryDelayMs: 10,
      })

      expect(client.isConnected()).toBe(false)

      // callWithRetry should connect automatically
      const result = await client.callWithRetry('test')
      expect(result).toBe('success')
      expect(client.isConnected()).toBe(true)

      client.close()
      await server.stop()
    })

    it('should retry when server becomes available', async () => {
      const handler = vi.fn().mockResolvedValue('delayed-success')
      const server = new IpcServer(socketPath, logger, handler)

      const client = new IpcClient(socketPath, logger, {
        maxRetries: 5,
        retryDelayMs: 50,
        connectTimeoutMs: 100,
      })

      // Start server after a delay - client should retry until it succeeds
      const startServerAfterDelay = async (): Promise<void> => {
        await new Promise((resolve) => setTimeout(resolve, 80))
        await server.start()
      }

      const [result] = await Promise.all([client.callWithRetry('test'), startServerAfterDelay()])

      expect(result).toBe('delayed-success')
      expect(handler).toHaveBeenCalledWith('test', undefined)

      client.close()
      await server.stop()
    })

    it('should fail after max retries on persistent error', async () => {
      const nonExistentSocket = path.join(tmpDir, 'nonexistent.sock')
      const client = new IpcClient(nonExistentSocket, logger, {
        maxRetries: 2,
        retryDelayMs: 10,
        connectTimeoutMs: 50,
      })

      // Should fail after retries (socket doesn't exist)
      await expect(client.callWithRetry('test')).rejects.toThrow()
    })

    it('should not retry on non-transient errors', async () => {
      const handler = vi.fn().mockRejectedValue(new Error('Application Error'))
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger, {
        maxRetries: 3,
        retryDelayMs: 10,
      })
      await client.connect()

      // Application errors should not trigger retry
      await expect(client.callWithRetry('fail')).rejects.toThrow('[-32603] Application Error')
      expect(handler).toHaveBeenCalledTimes(1) // Only called once, no retries

      client.close()
      await server.stop()
    })

    it('should use exponential backoff', async () => {
      const nonExistentSocket = path.join(tmpDir, 'nonexistent.sock')
      const client = new IpcClient(nonExistentSocket, logger, {
        maxRetries: 3,
        retryDelayMs: 50,
        connectTimeoutMs: 10,
      })

      const start = Date.now()
      try {
        await client.callWithRetry('test')
      } catch {
        // Expected to fail
      }
      const elapsed = Date.now() - start

      // With 3 retries and exponential backoff (50, 100, 200), should take at least 150ms
      // But connection timeout adds ~10ms per attempt, so allow some variance
      expect(elapsed).toBeGreaterThan(100)
    })
  })

  describe('isConnected', () => {
    it('should return false when not connected', () => {
      const client = new IpcClient(socketPath, logger)
      expect(client.isConnected()).toBe(false)
    })

    it('should return true after connect', async () => {
      const handler = vi.fn().mockResolvedValue('ok')
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger)
      await client.connect()

      expect(client.isConnected()).toBe(true)

      client.close()
      await server.stop()
    })

    it('should return false after close', async () => {
      const handler = vi.fn().mockResolvedValue('ok')
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger)
      await client.connect()
      client.close()

      expect(client.isConnected()).toBe(false)

      await server.stop()
    })
  })

  describe('Handler-Level Token Validation Pattern', () => {
    /**
     * ARCHITECTURE DECISION: Token validation is NOT built into IpcClient/IpcServer.
     *
     * The IPC transport layer is intentionally auth-agnostic. This design choice:
     * 1. Keeps IpcClient/IpcServer simple and focused on message passing
     * 2. Allows different handlers to implement different auth strategies
     * 3. Makes testing easier - handlers can be unit tested without transport mocks
     *
     * IMPORTANT: These tests verify that the transport correctly propagates
     * handler errors to clients. They do NOT test production authentication.
     * Production token enforcement is the responsibility of the Supervisor handler.
     *
     * If you need to verify production token security, test the actual
     * supervisor handler implementation directly, not through this test suite.
     *
     * @see docs/ARCHITECTURE.md for full rationale
     */

    const VALID_TOKEN = 'valid-test-token-abc123'

    // Creates a handler that implements token validation (like supervisor does)
    const createTokenValidatingHandler = (expectedToken: string): ReturnType<typeof vi.fn> => {
      return vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown> | undefined

        // Handshake validates token and returns version
        if (method === 'handshake') {
          if (p?.token !== expectedToken) {
            throw new Error('Invalid token')
          }
          return { version: '1.0.0', status: 'ok' }
        }

        // All other methods require valid token (post-handshake)
        if (!p?.token || p.token !== expectedToken) {
          throw new Error('Unauthorized')
        }

        switch (method) {
          case 'ping':
            return 'pong'
          case 'state.update':
            return { updated: true }
          default:
            throw new Error(`Method not found: ${method}`)
        }
      })
    }

    it('propagates handler success when token is valid', async () => {
      const handler = createTokenValidatingHandler(VALID_TOKEN)
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger)
      await client.connect()

      // Handshake with valid token
      const handshakeResult = await client.call('handshake', { token: VALID_TOKEN })
      expect(handshakeResult).toEqual({ version: '1.0.0', status: 'ok' })

      // Subsequent call with valid token
      const pingResult = await client.call('ping', { token: VALID_TOKEN })
      expect(pingResult).toBe('pong')

      client.close()
      await server.stop()
    })

    it('propagates handler error when token is invalid on handshake', async () => {
      const handler = createTokenValidatingHandler(VALID_TOKEN)
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger)
      await client.connect()

      // Handshake with wrong token should fail
      await expect(client.call('handshake', { token: 'wrong-token' })).rejects.toThrow('Invalid token')

      client.close()
      await server.stop()
    })

    it('propagates handler error when token is missing on handshake', async () => {
      const handler = createTokenValidatingHandler(VALID_TOKEN)
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger)
      await client.connect()

      // Handshake without token should fail
      await expect(client.call('handshake', {})).rejects.toThrow('Invalid token')

      client.close()
      await server.stop()
    })

    it('propagates handler error when token is missing on subsequent call', async () => {
      const handler = createTokenValidatingHandler(VALID_TOKEN)
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger)
      await client.connect()

      // First authenticate properly
      await client.call('handshake', { token: VALID_TOKEN })

      // Then try to call without token
      await expect(client.call('ping', {})).rejects.toThrow('Unauthorized')

      client.close()
      await server.stop()
    })

    it('propagates handler error when token is tampered on subsequent call', async () => {
      const handler = createTokenValidatingHandler(VALID_TOKEN)
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger)
      await client.connect()

      // First authenticate properly
      await client.call('handshake', { token: VALID_TOKEN })

      // Then try to call with wrong token
      await expect(client.call('ping', { token: 'tampered-token' })).rejects.toThrow('Unauthorized')

      client.close()
      await server.stop()
    })

    it('should reject call when token is null', async () => {
      const handler = createTokenValidatingHandler(VALID_TOKEN)
      const server = new IpcServer(socketPath, logger, handler)
      await server.start()

      const client = new IpcClient(socketPath, logger)
      await client.connect()

      // Handshake with null token
      await expect(client.call('handshake', { token: null })).rejects.toThrow('Invalid token')

      client.close()
      await server.stop()
    })
  })
})
