/**
 * SupervisorClient Unit Tests
 *
 * Tests the supervisor lifecycle management including:
 * - kill() - forceful termination of project-local supervisor
 * - killAllSupervisors() - kill all supervisors across projects
 * - User-level PID file management
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createConsoleLogger } from '../logger.js'
import { getPidPath, getSocketPath, getTokenPath, getUserPidPath, getUserSupervisorsDir } from '../ipc/transport.js'
import { killAllSupervisors, SupervisorClient, UserPidInfo } from '../supervisor-client.js'

const logger = createConsoleLogger({ minimumLevel: 'error' })
let tmpProjectDir: string
let tmpUserDir: string

describe('SupervisorClient', () => {
  beforeEach(async () => {
    tmpProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-supervisor-test-'))
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-user-test-'))

    // Create .sidekick directories
    await fs.mkdir(path.join(tmpProjectDir, '.sidekick'), { recursive: true })
    await fs.mkdir(path.join(tmpUserDir, '.sidekick', 'supervisors'), { recursive: true })

    // Mock os.homedir() for user-level PID paths
    vi.spyOn(os, 'homedir').mockReturnValue(tmpUserDir)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fs.rm(tmpProjectDir, { recursive: true, force: true })
      await fs.rm(tmpUserDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  describe('kill()', () => {
    it('should return killed: false when no supervisor running', async () => {
      const client = new SupervisorClient(tmpProjectDir, logger)
      const result = await client.kill()

      expect(result.killed).toBe(false)
      expect(result.pid).toBeUndefined()
    })

    it('should clean up stale PID files when process is dead', async () => {
      // Write a PID file for a non-existent process
      const stalePid = 999999999 // Very unlikely to exist
      await fs.writeFile(getPidPath(tmpProjectDir), stalePid.toString())
      await fs.writeFile(getSocketPath(tmpProjectDir), '')
      await fs.writeFile(getTokenPath(tmpProjectDir), 'stale-token')

      const client = new SupervisorClient(tmpProjectDir, logger)
      const result = await client.kill()

      expect(result.killed).toBe(false)

      // Stale files should be cleaned up
      await expect(fs.access(getPidPath(tmpProjectDir))).rejects.toThrow()
    })
  })

  describe('user-level PID path', () => {
    it('should generate deterministic hash-based path', () => {
      const path1 = getUserPidPath('/project/foo')
      const path2 = getUserPidPath('/project/foo')
      const path3 = getUserPidPath('/project/bar')

      expect(path1).toBe(path2) // Same project = same path
      expect(path1).not.toBe(path3) // Different project = different path
      expect(path1).toContain('.pid')
    })
  })

  describe('getStatus()', () => {
    it('should return stopped when no supervisor running', async () => {
      const client = new SupervisorClient(tmpProjectDir, logger)
      const status = await client.getStatus()

      expect(status.status).toBe('stopped')
      expect(status.ping).toBeUndefined()
    })

    it('should return running with ping when supervisor responds', async () => {
      const IpcServer = (await import('../ipc/server.js')).IpcServer
      const token = 'test-token-12345'
      await fs.writeFile(getTokenPath(tmpProjectDir), token)
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString()) // Use own PID as alive process

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

      const server = new IpcServer(getSocketPath(tmpProjectDir), logger, handler)
      await server.start()

      const client = new SupervisorClient(tmpProjectDir, logger)
      const status = await client.getStatus()

      expect(status.status).toBe('running')
      expect(status.ping).toBe('pong')

      await server.stop()
    })

    it('should return unresponsive when supervisor fails to respond', async () => {
      // Write PID for alive process but no server running
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      const client = new SupervisorClient(tmpProjectDir, logger)
      const status = await client.getStatus()

      expect(status.status).toBe('unresponsive')
      expect(status.error).toBeDefined()
    })
  })

  describe('stopAndWait()', () => {
    it('should return true when supervisor stops within timeout', async () => {
      const client = new SupervisorClient(tmpProjectDir, logger)

      // Mock isRunning to return true once, then false (simulating supervisor stopped)
      let callCount = 0
      vi.spyOn(client as unknown as { isRunning: () => Promise<boolean> }, 'isRunning').mockImplementation(() => {
        callCount++
        return Promise.resolve(callCount <= 1) // First call true, subsequent false
      })

      // Mock stop to do nothing (we're testing the polling, not stop itself)
      vi.spyOn(client, 'stop').mockResolvedValue()

      const result = await client.stopAndWait(5000)

      expect(result).toBe(true)
      expect(client.stop).toHaveBeenCalledOnce()
    })

    it('should return false when timeout is reached', async () => {
      const client = new SupervisorClient(tmpProjectDir, logger)

      // Mock isRunning to always return true (supervisor never stops)
      vi.spyOn(client as unknown as { isRunning: () => Promise<boolean> }, 'isRunning').mockResolvedValue(true)

      // Mock stop to do nothing
      vi.spyOn(client, 'stop').mockResolvedValue()

      // Use short timeout for test speed
      const result = await client.stopAndWait(1500)

      expect(result).toBe(false)
      expect(client.stop).toHaveBeenCalledOnce()
    })

    it('should return true immediately if supervisor already stopped', async () => {
      const client = new SupervisorClient(tmpProjectDir, logger)

      // Mock isRunning to return false immediately
      vi.spyOn(client as unknown as { isRunning: () => Promise<boolean> }, 'isRunning').mockResolvedValue(false)

      // Mock stop to do nothing
      vi.spyOn(client, 'stop').mockResolvedValue()

      const start = Date.now()
      const result = await client.stopAndWait(5000)
      const elapsed = Date.now() - start

      expect(result).toBe(true)
      // Should complete quickly (within 1.5s - one poll interval + buffer)
      expect(elapsed).toBeLessThan(1500)
    })
  })
})

describe('killAllSupervisors', () => {
  let tmpUserDir: string

  beforeEach(async () => {
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-killall-test-'))
    await fs.mkdir(path.join(tmpUserDir, '.sidekick', 'supervisors'), { recursive: true })

    vi.spyOn(os, 'homedir').mockReturnValue(tmpUserDir)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    try {
      await fs.rm(tmpUserDir, { recursive: true, force: true })
    } catch {
      // Cleanup may fail
    }
  })

  it('should return empty array when no supervisors directory exists', async () => {
    // Remove the supervisors directory
    await fs.rm(getUserSupervisorsDir(), { recursive: true, force: true })

    const results = await killAllSupervisors(logger)
    expect(results).toEqual([])
  })

  it('should return empty array when no PID files exist', async () => {
    const results = await killAllSupervisors(logger)
    expect(results).toEqual([])
  })

  it('should clean up stale PID files for dead processes', async () => {
    // Write a PID file for a non-existent process
    const stalePidInfo: UserPidInfo = {
      pid: 999999999, // Very unlikely to exist
      projectDir: '/fake/project',
      startedAt: new Date().toISOString(),
    }

    const pidFilePath = path.join(getUserSupervisorsDir(), 'stale.pid')
    await fs.writeFile(pidFilePath, JSON.stringify(stalePidInfo))

    const results = await killAllSupervisors(logger)

    // Should not report the stale process as killed (it's already dead)
    expect(results).toEqual([])

    // Stale file should be cleaned up
    await expect(fs.access(pidFilePath)).rejects.toThrow()
  })

  it('should clean up invalid JSON PID files', async () => {
    const invalidPidPath = path.join(getUserSupervisorsDir(), 'invalid.pid')
    await fs.writeFile(invalidPidPath, 'not valid json')

    const results = await killAllSupervisors(logger)
    expect(results).toEqual([])

    // Invalid file should be cleaned up
    await expect(fs.access(invalidPidPath)).rejects.toThrow()
  })

  it('should ignore non-.pid files in supervisors directory', async () => {
    // Write a non-.pid file
    const otherFile = path.join(getUserSupervisorsDir(), 'readme.txt')
    await fs.writeFile(otherFile, 'This is not a PID file')

    const results = await killAllSupervisors(logger)
    expect(results).toEqual([])

    // Non-PID file should still exist
    await expect(fs.access(otherFile)).resolves.toBeUndefined()
  })
})
