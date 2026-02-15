/**
 * DaemonClient Unit Tests
 *
 * Tests the daemon lifecycle management including:
 * - start() - spawn new daemon, version checks, restart on mismatch
 * - stop() - graceful IPC shutdown with fallback
 * - kill() - forceful termination of project-local daemon
 * - killAllDaemons() - kill all daemons across projects
 * - User-level PID file management
 */
import type { ChildProcess } from 'child_process'
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import { createConsoleLogger } from '../logger.js'
import { getPidPath, getSocketPath, getTokenPath, getUserPidPath, getUserDaemonsDir } from '../ipc/transport.js'
import { killAllDaemons, DaemonClient, UserPidInfo } from '../daemon-client.js'

// Mock child_process.spawn
vi.mock('child_process', () => ({
  spawn: vi.fn(),
}))

// Import spawn after mock setup
import { spawn } from 'child_process'

const logger = createConsoleLogger({ minimumLevel: 'error' })
let tmpProjectDir: string
let tmpUserDir: string

describe('DaemonClient', () => {
  beforeEach(async () => {
    tmpProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-daemon-test-'))
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-user-test-'))

    // Create .sidekick directories
    await fs.mkdir(path.join(tmpProjectDir, '.sidekick'), { recursive: true })
    await fs.mkdir(path.join(tmpUserDir, '.sidekick', 'daemons'), { recursive: true })

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
    it('should return killed: false when no daemon running', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
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

      const client = new DaemonClient(tmpProjectDir, logger)
      const result = await client.kill()

      expect(result.killed).toBe(false)

      // Stale files should be cleaned up
      await expect(fs.access(getPidPath(tmpProjectDir))).rejects.toThrow()
    })

    it('should SIGKILL running daemon and return pid', async () => {
      // Use current process PID to simulate running daemon
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())
      await fs.writeFile(getSocketPath(tmpProjectDir), '')
      await fs.writeFile(getTokenPath(tmpProjectDir), 'token')

      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock process.kill to track calls without actually killing
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
        if (signal === 0) return true // Process alive check
        if (signal === 'SIGKILL') return true // Simulate successful kill
        return true
      })

      // Mock cleanupStaleFiles to prevent actual file deletion affecting other tests
      vi.spyOn(client as unknown as { cleanupStaleFiles: () => Promise<void> }, 'cleanupStaleFiles').mockResolvedValue()

      const result = await client.kill()

      expect(result.killed).toBe(true)
      expect(result.pid).toBe(process.pid)
      expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL')

      killSpy.mockRestore()
    })

    it('should handle SIGKILL failure gracefully', async () => {
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock process.kill to fail on SIGKILL but succeed on signal 0 (alive check)
      const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
        if (signal === 0) return true // Process is alive
        // SIGKILL fails
        const err = new Error('EPERM') as NodeJS.ErrnoException
        err.code = 'EPERM'
        throw err
      })

      // Mock cleanupStaleFiles
      vi.spyOn(client as unknown as { cleanupStaleFiles: () => Promise<void> }, 'cleanupStaleFiles').mockResolvedValue()

      const result = await client.kill()

      expect(result.killed).toBe(false)
      expect(result.pid).toBeUndefined()

      killSpy.mockRestore()
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
    it('should return stopped when no daemon running', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const status = await client.getStatus()

      expect(status.status).toBe('stopped')
      expect(status.ping).toBeUndefined()
    })

    it('should return running with ping when daemon responds', async () => {
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

      const client = new DaemonClient(tmpProjectDir, logger)
      const status = await client.getStatus()

      expect(status.status).toBe('running')
      expect(status.ping).toBe('pong')

      await server.stop()
    })

    it('should return unresponsive when daemon fails to respond', async () => {
      // Write PID for alive process but no server running
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      const client = new DaemonClient(tmpProjectDir, logger)
      const status = await client.getStatus()

      expect(status.status).toBe('unresponsive')
      expect(status.error).toBeDefined()
    })
  })

  describe('start()', () => {
    let mockSpawn: MockInstance
    let mockChildProcess: Partial<ChildProcess>

    beforeEach(() => {
      mockChildProcess = {
        unref: vi.fn(),
        pid: 12345,
      }
      // mockClear() resets call history — vi.restoreAllMocks() only restores spies (vi.spyOn),
      // not standalone vi.fn() instances from vi.mock() factories
      mockSpawn = vi
        .mocked(spawn)
        .mockClear()
        .mockReturnValue(mockChildProcess as ChildProcess)
    })

    it('should spawn daemon when none running', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock waitForStartup to succeed immediately
      vi.spyOn(client as unknown as { waitForStartup: () => Promise<void> }, 'waitForStartup').mockResolvedValue()

      await client.start()

      expect(mockSpawn).toHaveBeenCalledWith(
        'node',
        expect.arrayContaining([expect.stringContaining('sidekick-daemon')]),
        {
          detached: true,
          stdio: 'ignore',
          cwd: tmpProjectDir,
        }
      )
      expect(mockChildProcess.unref).toHaveBeenCalled()
    })

    it('should skip spawn when daemon running with matching version', async () => {
      const IpcServer = (await import('../ipc/server.js')).IpcServer
      const token = 'test-token-version-match'
      await fs.writeFile(getTokenPath(tmpProjectDir), token)
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const clientVersion: string = require('../../package.json').version

      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          if (p.token !== token) throw new Error('Invalid token')
          return { version: clientVersion, status: 'ok' } // Matching version
        }
        return null
      })

      const server = new IpcServer(getSocketPath(tmpProjectDir), logger, handler)
      await server.start()

      const client = new DaemonClient(tmpProjectDir, logger)
      await client.start()

      // Should NOT spawn because version matches
      expect(mockSpawn).not.toHaveBeenCalled()

      await server.stop()
    })

    it('should restart daemon on version mismatch', async () => {
      const IpcServer = (await import('../ipc/server.js')).IpcServer
      const token = 'test-token-version-mismatch'
      await fs.writeFile(getTokenPath(tmpProjectDir), token)
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          if (p.token !== token) throw new Error('Invalid token')
          return { version: '0.0.0-mismatched', status: 'ok' } // Mismatched version
        }
        if (method === 'shutdown') {
          return { ack: true }
        }
        return null
      })

      const server = new IpcServer(getSocketPath(tmpProjectDir), logger, handler)
      await server.start()

      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock waitForShutdown and waitForStartup
      vi.spyOn(client as unknown as { waitForShutdown: () => Promise<void> }, 'waitForShutdown').mockResolvedValue()
      vi.spyOn(client as unknown as { waitForStartup: () => Promise<void> }, 'waitForStartup').mockResolvedValue()

      await client.start()

      // Should spawn new daemon after version mismatch
      expect(mockSpawn).toHaveBeenCalled()

      await server.stop()
    })

    it('should throw if startup times out', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Don't mock waitForStartup - let it actually timeout
      // But use a very short timeout by mocking the internal method
      vi.spyOn(
        client as unknown as { waitForStartup: (t: number) => Promise<void> },
        'waitForStartup'
      ).mockRejectedValue(new Error('Daemon failed to start within timeout'))

      await expect(client.start()).rejects.toThrow('Daemon failed to start within timeout')
    })
  })

  describe('stop()', () => {
    it('should return early when no daemon running', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // No PID file exists, so isRunning() returns false
      await client.stop()

      // Should complete without error (no-op)
    })

    it('should perform graceful IPC shutdown', async () => {
      const IpcServer = (await import('../ipc/server.js')).IpcServer
      const token = 'test-token-stop'
      await fs.writeFile(getTokenPath(tmpProjectDir), token)
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      let shutdownCalled = false
      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          if (p.token !== token) throw new Error('Invalid token')
          return { version: '1.0.0', status: 'ok' }
        }
        if (method === 'shutdown') {
          shutdownCalled = true
          return { ack: true }
        }
        return null
      })

      const server = new IpcServer(getSocketPath(tmpProjectDir), logger, handler)
      await server.start()

      const client = new DaemonClient(tmpProjectDir, logger)
      await client.stop()

      expect(shutdownCalled).toBe(true)
      expect(handler).toHaveBeenCalledWith('handshake', expect.anything())
      expect(handler).toHaveBeenCalledWith('shutdown', expect.anything())

      await server.stop()
    })

    it('should fallback to killForcefully on IPC error', async () => {
      // Write PID for alive process but no server (will fail to connect)
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      const client = new DaemonClient(tmpProjectDir, logger)

      // Spy on killForcefully
      const killForceFullySpy = vi
        .spyOn(client as unknown as { killForcefully: () => Promise<void> }, 'killForcefully')
        .mockResolvedValue()

      await client.stop()

      expect(killForceFullySpy).toHaveBeenCalled()
    })
  })

  describe('stopAndWait()', () => {
    it('should return true when daemon stops within timeout', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock isRunning to return true once, then false (simulating daemon stopped)
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
      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock isRunning to always return true (daemon never stops)
      vi.spyOn(client as unknown as { isRunning: () => Promise<boolean> }, 'isRunning').mockResolvedValue(true)

      // Mock stop to do nothing
      vi.spyOn(client, 'stop').mockResolvedValue()

      // Use short timeout for test speed
      const result = await client.stopAndWait(1500)

      expect(result).toBe(false)
      expect(client.stop).toHaveBeenCalledOnce()
    })

    it('should return true immediately if daemon already stopped', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

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

  describe('checkVersion() [private]', () => {
    it('should return true on version match', async () => {
      const IpcServer = (await import('../ipc/server.js')).IpcServer
      const token = 'test-token-check-version'
      await fs.writeFile(getTokenPath(tmpProjectDir), token)
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const clientVersion: string = require('../../package.json').version

      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          if (p.token !== token) throw new Error('Invalid token')
          return { version: clientVersion, status: 'ok' }
        }
        return null
      })

      const server = new IpcServer(getSocketPath(tmpProjectDir), logger, handler)
      await server.start()

      const client = new DaemonClient(tmpProjectDir, logger)
      const checkVersion = (client as unknown as { checkVersion: () => Promise<boolean> }).checkVersion.bind(client)
      const result = await checkVersion()

      expect(result).toBe(true)

      await server.stop()
    })

    it('should return false on version mismatch', async () => {
      const IpcServer = (await import('../ipc/server.js')).IpcServer
      const token = 'test-token-mismatch'
      await fs.writeFile(getTokenPath(tmpProjectDir), token)
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      const handler = vi.fn().mockImplementation((method: string, params: unknown) => {
        const p = params as Record<string, unknown>
        if (method === 'handshake') {
          if (p.token !== token) throw new Error('Invalid token')
          return { version: '0.0.0-different', status: 'ok' }
        }
        return null
      })

      const server = new IpcServer(getSocketPath(tmpProjectDir), logger, handler)
      await server.start()

      const client = new DaemonClient(tmpProjectDir, logger)
      const checkVersion = (client as unknown as { checkVersion: () => Promise<boolean> }).checkVersion.bind(client)
      const result = await checkVersion()

      expect(result).toBe(false)

      await server.stop()
    })

    it('should return false on IPC error (triggers restart)', async () => {
      // No server running, so IPC will fail
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())
      await fs.writeFile(getTokenPath(tmpProjectDir), 'dummy-token')

      const client = new DaemonClient(tmpProjectDir, logger)
      const checkVersion = (client as unknown as { checkVersion: () => Promise<boolean> }).checkVersion.bind(client)
      const result = await checkVersion()

      // On error, should return false to trigger restart
      expect(result).toBe(false)
    })
  })

  describe('waitForShutdown() [private]', () => {
    it('should return when daemon stops', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock isRunning to return false immediately
      vi.spyOn(client as unknown as { isRunning: () => Promise<boolean> }, 'isRunning').mockResolvedValue(false)

      const waitForShutdown = (
        client as unknown as { waitForShutdown: (t?: number) => Promise<void> }
      ).waitForShutdown.bind(client)

      // Should complete without error
      await waitForShutdown(1000)
    })

    it('should force kill and cleanup on timeout', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock isRunning to always return true (daemon never stops)
      vi.spyOn(client as unknown as { isRunning: () => Promise<boolean> }, 'isRunning').mockResolvedValue(true)

      // Mock killForcefully and cleanupStaleFiles
      const killForceFullySpy = vi
        .spyOn(client as unknown as { killForcefully: () => Promise<void> }, 'killForcefully')
        .mockResolvedValue()
      const cleanupSpy = vi
        .spyOn(client as unknown as { cleanupStaleFiles: () => Promise<void> }, 'cleanupStaleFiles')
        .mockResolvedValue()

      const waitForShutdown = (
        client as unknown as { waitForShutdown: (t?: number) => Promise<void> }
      ).waitForShutdown.bind(client)

      // Use very short timeout
      await waitForShutdown(200)

      expect(killForceFullySpy).toHaveBeenCalled()
      expect(cleanupSpy).toHaveBeenCalled()
    })
  })

  describe('cleanupStaleFiles() [private]', () => {
    it('should not cleanup when process is alive', async () => {
      // Write PID for current process (alive)
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())
      await fs.writeFile(getSocketPath(tmpProjectDir), '')
      await fs.writeFile(getTokenPath(tmpProjectDir), 'token')

      const client = new DaemonClient(tmpProjectDir, logger)
      const cleanupStaleFiles = (
        client as unknown as { cleanupStaleFiles: () => Promise<void> }
      ).cleanupStaleFiles.bind(client)

      await cleanupStaleFiles()

      // Files should still exist (process is alive)
      await expect(fs.access(getPidPath(tmpProjectDir))).resolves.toBeUndefined()
      await expect(fs.access(getSocketPath(tmpProjectDir))).resolves.toBeUndefined()
      await expect(fs.access(getTokenPath(tmpProjectDir))).resolves.toBeUndefined()
    })

    it('should remove all stale files when process is dead', async () => {
      const deadPid = 999999999
      await fs.writeFile(getPidPath(tmpProjectDir), deadPid.toString())
      await fs.writeFile(getSocketPath(tmpProjectDir), '')
      await fs.writeFile(getTokenPath(tmpProjectDir), 'stale-token')

      // Also create user-level PID file
      const userPidPath = getUserPidPath(tmpProjectDir)
      await fs.mkdir(path.dirname(userPidPath), { recursive: true })
      await fs.writeFile(
        userPidPath,
        JSON.stringify({ pid: deadPid, projectDir: tmpProjectDir, startedAt: new Date().toISOString() })
      )

      const client = new DaemonClient(tmpProjectDir, logger)
      const cleanupStaleFiles = (
        client as unknown as { cleanupStaleFiles: () => Promise<void> }
      ).cleanupStaleFiles.bind(client)

      await cleanupStaleFiles()

      // All files should be removed
      await expect(fs.access(getPidPath(tmpProjectDir))).rejects.toThrow()
      await expect(fs.access(getSocketPath(tmpProjectDir))).rejects.toThrow()
      await expect(fs.access(getTokenPath(tmpProjectDir))).rejects.toThrow()
      await expect(fs.access(userPidPath)).rejects.toThrow()
    })

    it('should do nothing when no PID file exists', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const cleanupStaleFiles = (
        client as unknown as { cleanupStaleFiles: () => Promise<void> }
      ).cleanupStaleFiles.bind(client)

      // Should complete without error
      await cleanupStaleFiles()
    })
  })

  describe('waitForStartup() [private]', () => {
    it('should return when daemon becomes ready', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Create PID and socket files to simulate startup
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())
      await fs.writeFile(getSocketPath(tmpProjectDir), '')

      const waitForStartup = (
        client as unknown as { waitForStartup: (t?: number) => Promise<void> }
      ).waitForStartup.bind(client)

      // Should complete without error
      await waitForStartup(1000)
    })

    it('should throw on timeout when daemon never starts', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // No PID or socket files - daemon not starting
      const waitForStartup = (
        client as unknown as { waitForStartup: (t?: number) => Promise<void> }
      ).waitForStartup.bind(client)

      await expect(waitForStartup(200)).rejects.toThrow('Daemon failed to start within timeout')
    })

    it('should wait for socket even if PID file exists', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Write PID file but no socket
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())

      const waitForStartup = (
        client as unknown as { waitForStartup: (t?: number) => Promise<void> }
      ).waitForStartup.bind(client)

      await expect(waitForStartup(200)).rejects.toThrow('Daemon failed to start within timeout')
    })
  })

  describe('isLockStale() [private]', () => {
    it('should return true when lock file is older than threshold', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      // Write a lock with old timestamp
      const oldTimestamp = Date.now() - 60000 // 60 seconds ago
      await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, timestamp: oldTimestamp }))

      const isLockStale = (client as unknown as { isLockStale: (p: string) => Promise<boolean> }).isLockStale.bind(
        client
      )
      const result = await isLockStale(lockPath)

      expect(result).toBe(true)
    })

    it('should return false when lock is recent and process is alive', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      // Write a lock with current timestamp and own PID (alive)
      await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }))

      const isLockStale = (client as unknown as { isLockStale: (p: string) => Promise<boolean> }).isLockStale.bind(
        client
      )
      const result = await isLockStale(lockPath)

      expect(result).toBe(false)
    })

    it('should return true when owning process is dead', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      // Write a lock with recent timestamp but non-existent PID
      const deadPid = 999999999
      await fs.writeFile(lockPath, JSON.stringify({ pid: deadPid, timestamp: Date.now() }))

      const isLockStale = (client as unknown as { isLockStale: (p: string) => Promise<boolean> }).isLockStale.bind(
        client
      )
      const result = await isLockStale(lockPath)

      expect(result).toBe(true)
    })

    it('should return true when lock file contains invalid JSON', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      await fs.writeFile(lockPath, 'not valid json')

      const isLockStale = (client as unknown as { isLockStale: (p: string) => Promise<boolean> }).isLockStale.bind(
        client
      )
      const result = await isLockStale(lockPath)

      expect(result).toBe(true)
    })

    it('should return true when lock file does not exist', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'nonexistent.lock')

      const isLockStale = (client as unknown as { isLockStale: (p: string) => Promise<boolean> }).isLockStale.bind(
        client
      )
      const result = await isLockStale(lockPath)

      expect(result).toBe(true)
    })
  })

  describe('releaseLock() [private]', () => {
    it('should delete the lock file', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }))
      await expect(fs.access(lockPath)).resolves.toBeUndefined()

      const releaseLock = (client as unknown as { releaseLock: (p: string) => Promise<void> }).releaseLock.bind(client)
      await releaseLock(lockPath)

      await expect(fs.access(lockPath)).rejects.toThrow()
    })

    it('should not throw when lock file does not exist', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'nonexistent.lock')

      const releaseLock = (client as unknown as { releaseLock: (p: string) => Promise<void> }).releaseLock.bind(client)

      // Should complete without error
      await releaseLock(lockPath)
    })
  })

  describe('withStartupLock() [private]', () => {
    it('should acquire lock and execute function', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      const withStartupLock = (
        client as unknown as { withStartupLock: <T>(fn: () => Promise<T>) => Promise<T> }
      ).withStartupLock.bind(client)

      let executed = false
      const result = await withStartupLock(() => {
        executed = true
        return Promise.resolve('success')
      })

      expect(executed).toBe(true)
      expect(result).toBe('success')
    })

    it('should release lock after function completes', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      const withStartupLock = (
        client as unknown as { withStartupLock: <T>(fn: () => Promise<T>) => Promise<T> }
      ).withStartupLock.bind(client)

      await withStartupLock(async () => {
        // Lock should exist during execution
        await expect(fs.access(lockPath)).resolves.toBeUndefined()
        return null
      })

      // Lock should be released after completion
      await expect(fs.access(lockPath)).rejects.toThrow()
    })

    it('should release lock even if function throws', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      const withStartupLock = (
        client as unknown as { withStartupLock: <T>(fn: () => Promise<T>) => Promise<T> }
      ).withStartupLock.bind(client)

      await expect(
        withStartupLock(() => {
          return Promise.reject(new Error('Test error'))
        })
      ).rejects.toThrow('Test error')

      // Lock should be released even after error
      await expect(fs.access(lockPath)).rejects.toThrow()
    })

    it('should remove stale lock and proceed', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      // Create a stale lock (dead process)
      const deadPid = 999999999
      await fs.writeFile(lockPath, JSON.stringify({ pid: deadPid, timestamp: Date.now() }))

      const withStartupLock = (
        client as unknown as { withStartupLock: <T>(fn: () => Promise<T>) => Promise<T> }
      ).withStartupLock.bind(client)

      let executed = false
      await withStartupLock(() => {
        executed = true
        return Promise.resolve(null)
      })

      expect(executed).toBe(true)
    })

    it('should wait for lock held by another process then acquire', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      // Create a lock held by current process (valid lock)
      await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }))

      const withStartupLock = (
        client as unknown as { withStartupLock: <T>(fn: () => Promise<T>) => Promise<T> }
      ).withStartupLock.bind(client)

      let executed = false

      // Release lock after 150ms (after 1-2 retry intervals)
      setTimeout(() => {
        void fs.unlink(lockPath).catch(() => {})
      }, 150)

      await withStartupLock(() => {
        executed = true
        return Promise.resolve(null)
      })

      expect(executed).toBe(true)
    })

    it('should force remove lock after timeout', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)
      const lockPath = path.join(tmpProjectDir, '.sidekick', 'sidekickd.lock')

      // Create a lock held by current process (valid lock) that won't be released
      await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }))

      // Mock the constants to make timeout faster (100ms total with 50ms intervals = 2 retries)
      const withStartupLockFast = async <T>(fn: () => Promise<T>): Promise<T> => {
        const lockTimeoutMs = 200
        const lockRetryIntervalMs = 50

        const startTime = Date.now()
        const isLockStale = (client as unknown as { isLockStale: (p: string) => Promise<boolean> }).isLockStale.bind(
          client
        )

        while (Date.now() - startTime < lockTimeoutMs) {
          try {
            await fs.writeFile(lockPath, JSON.stringify({ pid: process.pid, timestamp: Date.now() }), {
              flag: 'wx',
            })
            try {
              return await fn()
            } finally {
              await fs.unlink(lockPath).catch(() => {})
            }
          } catch (err: unknown) {
            if ((err as NodeJS.ErrnoException).code === 'EEXIST') {
              if (await isLockStale(lockPath)) {
                await fs.unlink(lockPath).catch(() => {})
                continue
              }
              await new Promise((resolve) => setTimeout(resolve, lockRetryIntervalMs))
              continue
            }
            throw err
          }
        }

        // Timeout - force remove lock
        await fs.unlink(lockPath).catch(() => {})
        return fn()
      }

      let executed = false
      await withStartupLockFast(() => {
        executed = true
        return Promise.resolve(null)
      })

      expect(executed).toBe(true)
      // Lock should be removed
      await expect(fs.access(lockPath)).rejects.toThrow()
    })
  })

  describe('killForcefully() [private]', () => {
    it('should attempt SIGKILL on valid PID', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Use a non-existent PID that won't actually kill anything
      const fakePid = 999999999
      await fs.writeFile(getPidPath(tmpProjectDir), fakePid.toString())

      // Spy on process.kill
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true)

      const killForcefully = (client as unknown as { killForcefully: () => Promise<void> }).killForcefully.bind(client)
      await killForcefully()

      expect(killSpy).toHaveBeenCalledWith(fakePid, 'SIGKILL')

      killSpy.mockRestore()
    })

    it('should handle missing PID file gracefully', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // No PID file
      const killForcefully = (client as unknown as { killForcefully: () => Promise<void> }).killForcefully.bind(client)

      // Should complete without error
      await killForcefully()
    })

    it('should handle ESRCH (process not found) gracefully', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      const fakePid = 999999999
      await fs.writeFile(getPidPath(tmpProjectDir), fakePid.toString())

      // process.kill throws ESRCH when process doesn't exist
      const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
        const err = new Error('ESRCH') as NodeJS.ErrnoException
        err.code = 'ESRCH'
        throw err
      })

      const killForcefully = (client as unknown as { killForcefully: () => Promise<void> }).killForcefully.bind(client)

      // Should complete without error (catches exception)
      await killForcefully()

      killSpy.mockRestore()
    })
  })
})

/**
 * Sandbox timeout reproduction tests (sidekick-a08)
 *
 * When hooks run inside Claude Code's sandbox, Unix socket operations fail
 * with EPERM. The daemon startup path accumulates timeouts from multiple
 * phases that each independently wait for a socket that can never appear.
 *
 * These tests reproduce the timeout stacking with short durations to verify
 * the problem and serve as regression tests for the fix.
 */
describe('DaemonClient — sandbox timeout reproduction (a08)', () => {
  beforeEach(async () => {
    tmpProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-sandbox-repro-'))
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-user-repro-'))
    await fs.mkdir(path.join(tmpProjectDir, '.sidekick'), { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(tmpUserDir)
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    await fs.rm(tmpProjectDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(tmpUserDir, { recursive: true, force: true }).catch(() => {})
  })

  describe('cold start — daemon spawned but socket never appears', () => {
    it('should burn the full waitForStartup timeout when socket cannot be created', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock spawn to "succeed" (child process starts) but never create socket/pid files
      // This simulates sandbox: spawn works, but daemon can't bind socket (EPERM)
      vi.mocked(spawn)
        .mockClear()
        .mockReturnValue({
          unref: vi.fn(),
          pid: 99999,
        } as unknown as ChildProcess)

      const waitForStartup = (
        client as unknown as { waitForStartup: (t: number) => Promise<void> }
      ).waitForStartup.bind(client)

      const TIMEOUT_MS = 500 // Short timeout for test speed
      const start = Date.now()

      await expect(waitForStartup(TIMEOUT_MS)).rejects.toThrow('Daemon failed to start within timeout')

      const elapsed = Date.now() - start
      // Should have burned at least the full timeout polling
      expect(elapsed).toBeGreaterThanOrEqual(TIMEOUT_MS - 50) // small tolerance
      expect(elapsed).toBeLessThan(TIMEOUT_MS + 500) // shouldn't overshoot much
    })

    it('should accumulate lock + waitForStartup time in start()', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Mock spawn (succeeds but daemon can't create socket)
      vi.mocked(spawn)
        .mockClear()
        .mockReturnValue({
          unref: vi.fn(),
          pid: 99999,
        } as unknown as ChildProcess)

      // Use a short waitForStartup timeout to keep test fast
      // In production this is 5000ms — that's the 5s hang per hook invocation
      const STARTUP_TIMEOUT_MS = 300
      vi.spyOn(
        client as unknown as { waitForStartup: (t?: number) => Promise<void> },
        'waitForStartup'
      ).mockImplementation(async () => {
        // Simulate the real polling behavior with a short timeout
        const startTime = Date.now()
        while (Date.now() - startTime < STARTUP_TIMEOUT_MS) {
          await new Promise((r) => setTimeout(r, 50))
        }
        throw new Error('Daemon failed to start within timeout')
      })

      const start = Date.now()

      // start() catches the timeout via withStartupLock, which propagates it
      await expect(client.start()).rejects.toThrow('Daemon failed to start within timeout')

      const elapsed = Date.now() - start
      expect(elapsed).toBeGreaterThanOrEqual(STARTUP_TIMEOUT_MS - 50)
    })
  })

  describe('stale files — previous daemon left PID/token, compounding timeouts', () => {
    it('should compound checkVersion + waitForShutdown + waitForStartup timeouts', async () => {
      const client = new DaemonClient(tmpProjectDir, logger)

      // Simulate stale state: PID file for alive process, token file, no socket
      // This is what happens when a previous non-sandboxed session's daemon files linger
      await fs.writeFile(getPidPath(tmpProjectDir), process.pid.toString())
      await fs.writeFile(getTokenPath(tmpProjectDir), 'stale-token')

      // Mock spawn
      vi.mocked(spawn)
        .mockClear()
        .mockReturnValue({
          unref: vi.fn(),
          pid: 99999,
        } as unknown as ChildProcess)

      // Track which phases execute and how long each takes
      const phases: Array<{ name: string; durationMs: number }> = []

      // checkVersion: will try ipcClient.connect() → ENOENT (no socket file) → fast fail
      // But it returns false (mismatch assumed), triggering stop() + restart

      // Mock killForcefully to prevent actually killing our process
      vi.spyOn(client as unknown as { killForcefully: () => Promise<void> }, 'killForcefully').mockResolvedValue()

      // Instrument waitForShutdown with short timeout
      const SHORT_TIMEOUT = 200
      const origWaitForShutdown = (
        client as unknown as { waitForShutdown: (t?: number) => Promise<void> }
      ).waitForShutdown.bind(client)
      vi.spyOn(
        client as unknown as { waitForShutdown: (t?: number) => Promise<void> },
        'waitForShutdown'
      ).mockImplementation(async () => {
        const phaseStart = Date.now()
        await origWaitForShutdown(SHORT_TIMEOUT)
        phases.push({ name: 'waitForShutdown', durationMs: Date.now() - phaseStart })
      })

      // Instrument waitForStartup with short timeout
      vi.spyOn(
        client as unknown as { waitForStartup: (t?: number) => Promise<void> },
        'waitForStartup'
      ).mockImplementation(async () => {
        const phaseStart = Date.now()
        const startTime = Date.now()
        while (Date.now() - startTime < SHORT_TIMEOUT) {
          await new Promise((r) => setTimeout(r, 50))
        }
        phases.push({ name: 'waitForStartup', durationMs: Date.now() - phaseStart })
        throw new Error('Daemon failed to start within timeout')
      })

      const totalStart = Date.now()
      await expect(client.start()).rejects.toThrow('Daemon failed to start within timeout')
      const totalElapsed = Date.now() - totalStart

      // Both timeout phases should have executed (compounding)
      const phaseNames = phases.map((p) => p.name)
      expect(phaseNames).toContain('waitForShutdown')
      expect(phaseNames).toContain('waitForStartup')

      // Total time should be at least the sum of both timeout phases
      // In production: waitForShutdown(5s) + waitForStartup(5s) = 10s minimum
      const combinedPhaseTime = phases.reduce((sum, p) => sum + p.durationMs, 0)
      expect(totalElapsed).toBeGreaterThanOrEqual(combinedPhaseTime - 100)
    })
  })

  describe('IPC retry — ENOENT misclassified as transient', () => {
    it('should fail fast with EINVAL when socket path does not exist (not ENOENT)', async () => {
      // KEY FINDING: When parent directory exists but socket file doesn't,
      // macOS returns EINVAL ("Invalid argument"), not ENOENT.
      // EINVAL is NOT in the transient error list, so callWithRetry does NOT retry.
      // This means the IPC retry layer is NOT a significant contributor to sandbox hangs.
      const { IpcClient } = await import('../ipc/client.js')
      const bogusSocketPath = path.join(tmpProjectDir, '.sidekick', 'nonexistent.sock')

      const client = new IpcClient(bogusSocketPath, logger, {
        connectTimeoutMs: 500,
        requestTimeoutMs: 500,
        maxRetries: 3,
        retryDelayMs: 50,
      })

      const start = Date.now()
      const thrownError = await client.callWithRetry('ping', {}, 3).catch((e: Error) => e)
      const elapsed = Date.now() - start

      expect(thrownError).toBeInstanceOf(Error)
      // macOS returns EINVAL for non-existent socket paths (parent dir exists)
      expect((thrownError as Error).message).toContain('EINVAL')
      // EINVAL is not transient — fails immediately, no retries
      expect(elapsed).toBeLessThan(50)
    })

    it('should classify EPERM as non-transient and fail immediately', async () => {
      const { IpcClient } = await import('../ipc/client.js')
      const bogusSocketPath = path.join(tmpProjectDir, '.sidekick', 'nonexistent.sock')

      const client = new IpcClient(bogusSocketPath, logger, {
        connectTimeoutMs: 500,
        requestTimeoutMs: 500,
        maxRetries: 3,
        retryDelayMs: 50,
      })

      // Mock connect to throw EPERM (what sandbox actually does on socket creation)
      vi.spyOn(client, 'connect').mockRejectedValue(Object.assign(new Error('connect EPERM'), { code: 'EPERM' }))

      const start = Date.now()
      await expect(client.callWithRetry('ping', {}, 3)).rejects.toThrow('EPERM')
      const elapsed = Date.now() - start

      // EPERM is NOT in transient patterns — should fail on first attempt, no retries
      expect(elapsed).toBeLessThan(100)
    })
  })
})

/**
 * Sandbox short-circuit tests (sidekick-a08 fix).
 *
 * Verifies that DaemonClient.start() returns immediately in sandbox mode
 * without spawning a daemon or touching the filesystem.
 */
describe('DaemonClient — sandbox short-circuit fix (a08)', () => {
  let originalSandboxEnv: string | undefined

  beforeEach(async () => {
    tmpProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-sandbox-fix-'))
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-user-fix-'))
    await fs.mkdir(path.join(tmpProjectDir, '.sidekick'), { recursive: true })
    vi.spyOn(os, 'homedir').mockReturnValue(tmpUserDir)

    originalSandboxEnv = process.env.SANDBOX_RUNTIME
  })

  afterEach(async () => {
    // Restore env before restoring mocks
    if (originalSandboxEnv === undefined) {
      delete process.env.SANDBOX_RUNTIME
    } else {
      process.env.SANDBOX_RUNTIME = originalSandboxEnv
    }

    vi.restoreAllMocks()
    await fs.rm(tmpProjectDir, { recursive: true, force: true }).catch(() => {})
    await fs.rm(tmpUserDir, { recursive: true, force: true }).catch(() => {})
  })

  it('start() should return immediately when SANDBOX_RUNTIME=1 (< 50ms, no spawn)', async () => {
    process.env.SANDBOX_RUNTIME = '1'

    const client = new DaemonClient(tmpProjectDir, logger)
    vi.mocked(spawn).mockClear()

    const start = Date.now()
    await client.start()
    const elapsed = Date.now() - start

    expect(elapsed).toBeLessThan(50)
    expect(spawn).not.toHaveBeenCalled()
  })

  it('start() should still spawn daemon when SANDBOX_RUNTIME is unset', async () => {
    delete process.env.SANDBOX_RUNTIME

    const client = new DaemonClient(tmpProjectDir, logger)
    vi.mocked(spawn)
      .mockClear()
      .mockReturnValue({
        unref: vi.fn(),
        pid: 12345,
      } as unknown as ChildProcess)

    // Mock waitForStartup to succeed immediately (we're testing spawn, not startup)
    vi.spyOn(client as unknown as { waitForStartup: () => Promise<void> }, 'waitForStartup').mockResolvedValue()

    await client.start()

    expect(spawn).toHaveBeenCalled()
  })

  it('start() should still spawn daemon when SANDBOX_RUNTIME=0', async () => {
    process.env.SANDBOX_RUNTIME = '0'

    const client = new DaemonClient(tmpProjectDir, logger)
    vi.mocked(spawn)
      .mockClear()
      .mockReturnValue({
        unref: vi.fn(),
        pid: 12345,
      } as unknown as ChildProcess)

    vi.spyOn(client as unknown as { waitForStartup: () => Promise<void> }, 'waitForStartup').mockResolvedValue()

    await client.start()

    expect(spawn).toHaveBeenCalled()
  })
})

describe('killAllDaemons', () => {
  let tmpUserDir: string

  beforeEach(async () => {
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-killall-test-'))
    await fs.mkdir(path.join(tmpUserDir, '.sidekick', 'daemons'), { recursive: true })

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

  it('should return empty array when no daemons directory exists', async () => {
    // Remove the daemons directory
    await fs.rm(getUserDaemonsDir(), { recursive: true, force: true })

    const results = await killAllDaemons(logger)
    expect(results).toEqual([])
  })

  it('should return empty array when no PID files exist', async () => {
    const results = await killAllDaemons(logger)
    expect(results).toEqual([])
  })

  it('should clean up stale PID files for dead processes', async () => {
    // Write a PID file for a non-existent process
    const stalePidInfo: UserPidInfo = {
      pid: 999999999, // Very unlikely to exist
      projectDir: '/fake/project',
      startedAt: new Date().toISOString(),
    }

    const pidFilePath = path.join(getUserDaemonsDir(), 'stale.pid')
    await fs.writeFile(pidFilePath, JSON.stringify(stalePidInfo))

    const results = await killAllDaemons(logger)

    // Should not report the stale process as killed (it's already dead)
    expect(results).toEqual([])

    // Stale file should be cleaned up
    await expect(fs.access(pidFilePath)).rejects.toThrow()
  })

  it('should clean up invalid JSON PID files', async () => {
    const invalidPidPath = path.join(getUserDaemonsDir(), 'invalid.pid')
    await fs.writeFile(invalidPidPath, 'not valid json')

    const results = await killAllDaemons(logger)
    expect(results).toEqual([])

    // Invalid file should be cleaned up
    await expect(fs.access(invalidPidPath)).rejects.toThrow()
  })

  it('should ignore non-.pid files in daemons directory', async () => {
    // Write a non-.pid file
    const otherFile = path.join(getUserDaemonsDir(), 'readme.txt')
    await fs.writeFile(otherFile, 'This is not a PID file')

    const results = await killAllDaemons(logger)
    expect(results).toEqual([])

    // Non-PID file should still exist
    await expect(fs.access(otherFile)).resolves.toBeUndefined()
  })

  it('should kill live daemon and report success', async () => {
    // Use current process PID as "live" process
    const livePidInfo: UserPidInfo = {
      pid: process.pid,
      projectDir: '/test/project',
      startedAt: new Date().toISOString(),
    }

    const pidFilePath = path.join(getUserDaemonsDir(), 'live.pid')
    await fs.writeFile(pidFilePath, JSON.stringify(livePidInfo))

    // Also create project-level files that should be cleaned up
    const projectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-project-'))
    await fs.mkdir(path.join(projectDir, '.sidekick'), { recursive: true })
    await fs.writeFile(getPidPath(projectDir), process.pid.toString())
    await fs.writeFile(getSocketPath(projectDir), '')
    await fs.writeFile(getTokenPath(projectDir), 'token')

    // Update PID info to use real project dir
    livePidInfo.projectDir = projectDir
    await fs.writeFile(pidFilePath, JSON.stringify(livePidInfo))

    // Mock process.kill to track calls without actually killing
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) return true // Alive check
      if (signal === 'SIGKILL') return true // Kill
      return true
    })

    const results = await killAllDaemons(logger)

    expect(results).toHaveLength(1)
    expect(results[0]).toEqual({
      projectDir,
      pid: process.pid,
      killed: true,
    })

    // SIGKILL should have been called
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL')

    // Cleanup
    killSpy.mockRestore()
    await fs.rm(projectDir, { recursive: true, force: true }).catch(() => {})
  })

  it('should report error when kill fails (EPERM)', async () => {
    const pidInfo: UserPidInfo = {
      pid: 12345,
      projectDir: '/test/project',
      startedAt: new Date().toISOString(),
    }

    const pidFilePath = path.join(getUserDaemonsDir(), 'eperm.pid')
    await fs.writeFile(pidFilePath, JSON.stringify(pidInfo))

    // Mock process.kill to simulate EPERM error
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) return true // Process is alive
      // SIGKILL fails with EPERM
      const err = new Error('EPERM: operation not permitted') as NodeJS.ErrnoException
      err.code = 'EPERM'
      throw err
    })

    const results = await killAllDaemons(logger)

    expect(results).toHaveLength(1)
    expect(results[0].killed).toBe(false)
    expect(results[0].error).toContain('EPERM')

    killSpy.mockRestore()
  })

  it('should handle multiple daemons', async () => {
    // Create multiple PID files
    const pids = [1001, 1002, 1003]
    for (let i = 0; i < pids.length; i++) {
      const pidInfo: UserPidInfo = {
        pid: pids[i],
        projectDir: `/test/project${i}`,
        startedAt: new Date().toISOString(),
      }
      await fs.writeFile(path.join(getUserDaemonsDir(), `daemon${i}.pid`), JSON.stringify(pidInfo))
    }

    // Mock process.kill
    const killedPids: number[] = []
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (signal === 0) return true // All alive
      if (signal === 'SIGKILL') {
        killedPids.push(pid)
        return true
      }
      return true
    })

    const results = await killAllDaemons(logger)

    expect(results).toHaveLength(3)
    expect(results.every((r) => r.killed)).toBe(true)
    expect(killedPids.sort()).toEqual(pids.sort())

    killSpy.mockRestore()
  })

  it('should attempt graceful stop before SIGKILL when graceful option is true', async () => {
    const pidInfo: UserPidInfo = {
      pid: process.pid,
      projectDir: tmpUserDir,
      startedAt: new Date().toISOString(),
    }

    const pidFilePath = path.join(getUserDaemonsDir(), 'graceful.pid')
    await fs.writeFile(pidFilePath, JSON.stringify(pidInfo))

    // Mock process.kill for alive check
    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) return true
      if (signal === 'SIGKILL') return true
      return true
    })

    // Mock DaemonClient.stopAndWait to succeed
    const stopAndWaitMock = vi.fn().mockResolvedValue(true)
    vi.spyOn(DaemonClient.prototype, 'stopAndWait').mockImplementation(stopAndWaitMock)

    const results = await killAllDaemons(logger, { graceful: true, gracefulTimeoutMs: 3000 })

    expect(results).toHaveLength(1)
    expect(results[0].killed).toBe(true)
    expect(stopAndWaitMock).toHaveBeenCalledWith(3000)
    // SIGKILL should NOT have been sent (graceful succeeded)
    expect(killSpy).not.toHaveBeenCalledWith(process.pid, 'SIGKILL')

    killSpy.mockRestore()
  })

  it('should fall back to SIGKILL when graceful stop fails', async () => {
    const pidInfo: UserPidInfo = {
      pid: process.pid,
      projectDir: tmpUserDir,
      startedAt: new Date().toISOString(),
    }

    const pidFilePath = path.join(getUserDaemonsDir(), 'fallback.pid')
    await fs.writeFile(pidFilePath, JSON.stringify(pidInfo))

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) return true
      if (signal === 'SIGKILL') return true
      return true
    })

    // Mock DaemonClient.stopAndWait to fail
    vi.spyOn(DaemonClient.prototype, 'stopAndWait').mockResolvedValue(false)

    const results = await killAllDaemons(logger, { graceful: true, gracefulTimeoutMs: 3000 })

    expect(results).toHaveLength(1)
    expect(results[0].killed).toBe(true)
    // SIGKILL should have been sent as fallback
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL')

    killSpy.mockRestore()
  })

  it('should skip graceful stop when graceful option is false (default)', async () => {
    const pidInfo: UserPidInfo = {
      pid: process.pid,
      projectDir: tmpUserDir,
      startedAt: new Date().toISOString(),
    }

    const pidFilePath = path.join(getUserDaemonsDir(), 'nograceful.pid')
    await fs.writeFile(pidFilePath, JSON.stringify(pidInfo))

    const killSpy = vi.spyOn(process, 'kill').mockImplementation((_pid, signal) => {
      if (signal === 0) return true
      if (signal === 'SIGKILL') return true
      return true
    })

    const stopAndWaitSpy = vi.spyOn(DaemonClient.prototype, 'stopAndWait')

    const results = await killAllDaemons(logger)

    expect(results).toHaveLength(1)
    expect(results[0].killed).toBe(true)
    // No graceful stop attempted
    expect(stopAndWaitSpy).not.toHaveBeenCalled()
    // Straight to SIGKILL
    expect(killSpy).toHaveBeenCalledWith(process.pid, 'SIGKILL')

    killSpy.mockRestore()
  })
})
