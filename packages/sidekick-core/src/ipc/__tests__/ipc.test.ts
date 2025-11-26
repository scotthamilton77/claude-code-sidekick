import fs from 'fs/promises'
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
})
