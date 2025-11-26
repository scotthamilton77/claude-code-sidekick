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
let originalHomedir: () => string

describe('SupervisorClient', () => {
  beforeEach(async () => {
    tmpProjectDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-supervisor-test-'))
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-user-test-'))

    // Create .sidekick directories
    await fs.mkdir(path.join(tmpProjectDir, '.sidekick'), { recursive: true })
    await fs.mkdir(path.join(tmpUserDir, '.sidekick', 'supervisors'), { recursive: true })

    // Mock os.homedir() for user-level PID paths
    originalHomedir = os.homedir
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
})

describe('killAllSupervisors', () => {
  let tmpUserDir: string
  let originalHomedir: () => string

  beforeEach(async () => {
    tmpUserDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-killall-test-'))
    await fs.mkdir(path.join(tmpUserDir, '.sidekick', 'supervisors'), { recursive: true })

    originalHomedir = os.homedir
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
