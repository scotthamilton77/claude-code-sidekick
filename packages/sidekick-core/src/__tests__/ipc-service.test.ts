/**
 * IpcService Unit Tests
 *
 * Tests the high-level IPC abstraction including:
 * - Connection pooling (reuse across calls)
 * - Graceful degradation when daemon unavailable
 * - Authentication flow
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsoleLogger } from '../logger.js'
import { IpcServer } from '../ipc/server.js'
import { getSocketPath, getTokenPath } from '../ipc/transport.js'
import { IpcService } from '../ipc-service.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })
let tmpDir: string

describe('IpcService', () => {
  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-ipc-service-test-'))
    // Create .sidekick directory structure
    await fs.mkdir(path.join(tmpDir, '.sidekick'), { recursive: true })
  })

  afterEach(async () => {
    try {
      await fs.rm(tmpDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  describe('send()', () => {
    it('should send request and return result', async () => {
      // Set up a mock server with handshake support
      const token = 'test-token-12345'
      await fs.writeFile(getTokenPath(tmpDir), token)

      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          if (p.token !== token) throw new Error('Invalid token')
          return { version: '1.0.0', status: 'ok' }
        }
        return { received: method, params: p }
      })

      const server = new IpcServer(getSocketPath(tmpDir), logger, handler)
      await server.start()

      const service = new IpcService(tmpDir, logger)
      const result = await service.send('test.method', { foo: 'bar' })

      expect(result).toEqual({ received: 'test.method', params: { foo: 'bar', token } })

      service.close()
      await server.stop()
    })

    it('should reuse connection across multiple calls', async () => {
      const token = 'test-token-12345'
      await fs.writeFile(getTokenPath(tmpDir), token)

      let handshakeCount = 0
      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          handshakeCount++
          if (p.token !== token) throw new Error('Invalid token')
          return { version: '1.0.0', status: 'ok' }
        }
        return 'ok'
      })

      const server = new IpcServer(getSocketPath(tmpDir), logger, handler)
      await server.start()

      const service = new IpcService(tmpDir, logger)

      // Multiple calls should only handshake once
      await service.send('call1')
      await service.send('call2')
      await service.send('call3')

      expect(handshakeCount).toBe(1)

      service.close()
      await server.stop()
    })
  })

  describe('graceful degradation', () => {
    it('should return null when daemon unavailable (default behavior)', async () => {
      // No server running, no token file
      const service = new IpcService(tmpDir, logger)
      const result = await service.send('some.method')

      expect(result).toBeNull()
      service.close()
    })

    it('should throw when gracefulDegradation is false', async () => {
      const service = new IpcService(tmpDir, logger, { gracefulDegradation: false })

      await expect(service.send('some.method')).rejects.toThrow('Daemon token not found')
      service.close()
    })

    it('should respect per-call gracefulDegradation override', async () => {
      const service = new IpcService(tmpDir, logger, { gracefulDegradation: true })

      // Default is graceful, but we override to throw
      await expect(service.send('some.method', {}, { gracefulDegradation: false })).rejects.toThrow()

      service.close()
    })
  })

  describe('isAvailable()', () => {
    it('should return false when daemon not running', async () => {
      const service = new IpcService(tmpDir, logger)
      const available = await service.isAvailable()

      expect(available).toBe(false)
      service.close()
    })

    it('should return true when daemon is running and responsive', async () => {
      const token = 'test-token-12345'
      await fs.writeFile(getTokenPath(tmpDir), token)

      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          if (p.token !== token) throw new Error('Invalid token')
          return { version: '1.0.0', status: 'ok' }
        }
        if (method === 'ping') {
          return 'pong'
        }
        return null
      })

      const server = new IpcServer(getSocketPath(tmpDir), logger, handler)
      await server.start()

      const service = new IpcService(tmpDir, logger)
      const available = await service.isAvailable()

      expect(available).toBe(true)

      service.close()
      await server.stop()
    })
  })

  describe('close()', () => {
    it('should close connection and reset authentication state', async () => {
      const token = 'test-token-12345'
      await fs.writeFile(getTokenPath(tmpDir), token)

      let handshakeCount = 0
      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          handshakeCount++
          if (p.token !== token) throw new Error('Invalid token')
          return { version: '1.0.0', status: 'ok' }
        }
        return 'ok'
      })

      const server = new IpcServer(getSocketPath(tmpDir), logger, handler)
      await server.start()

      const service = new IpcService(tmpDir, logger)
      await service.send('call1')

      expect(handshakeCount).toBe(1)

      // Close and reconnect - should re-authenticate
      service.close()
      await service.send('call2')

      expect(handshakeCount).toBe(2)

      service.close()
      await server.stop()
    })
  })
})
