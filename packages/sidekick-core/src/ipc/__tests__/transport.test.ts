import crypto from 'crypto'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  getProjectHash,
  getSocketPath,
  validateSocketPath,
  getTokenPath,
  getPidPath,
  getLockPath,
  getUserDaemonsDir,
  getUserPidPath,
  UNIX_PATH_MAX,
} from '../transport.js'

describe('transport', () => {
  describe('getProjectHash', () => {
    it('returns a 16-character hex string', () => {
      const hash = getProjectHash('/Users/test/project')
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
    })

    it('is deterministic for the same input', () => {
      const hash1 = getProjectHash('/Users/test/project')
      const hash2 = getProjectHash('/Users/test/project')
      expect(hash1).toBe(hash2)
    })

    it('produces different hashes for different inputs', () => {
      const hash1 = getProjectHash('/Users/test/project1')
      const hash2 = getProjectHash('/Users/test/project2')
      expect(hash1).not.toBe(hash2)
    })

    it('matches expected SHA256 prefix', () => {
      const projectDir = '/test/path'
      const expectedHash = crypto.createHash('sha256').update(projectDir).digest('hex').substring(0, 16)
      expect(getProjectHash(projectDir)).toBe(expectedHash)
    })

    it('handles empty string', () => {
      const hash = getProjectHash('')
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
    })

    it('handles special characters in path', () => {
      const hash = getProjectHash('/path/with spaces/and-dashes/and_underscores')
      expect(hash).toMatch(/^[0-9a-f]{16}$/)
    })
  })

  describe('UNIX_PATH_MAX', () => {
    it('is 107 bytes (per POSIX sockaddr_un limit)', () => {
      expect(UNIX_PATH_MAX).toBe(107)
    })
  })

  describe('getSocketPath', () => {
    const originalPlatform = process.platform

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
      vi.unstubAllEnvs()
    })

    it('returns a named pipe path on Windows', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const socketPath = getSocketPath('/C:/Users/test/project')
      expect(socketPath).toMatch(/^\\\\.\\pipe\\sidekick-[0-9a-f]{16}-sock$/)
    })

    it('returns a Unix domain socket path on macOS', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const socketPath = getSocketPath('/Users/test/project')
      expect(socketPath).toMatch(/sidekick-[0-9a-f]{16}\.sock$/)
      expect(socketPath).not.toContain('pipe')
    })

    it('returns a Unix domain socket path on Linux', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      vi.stubEnv('XDG_RUNTIME_DIR', '')
      const socketPath = getSocketPath('/home/test/project')
      expect(socketPath).toMatch(/sidekick-[0-9a-f]{16}\.sock$/)
    })

    it('uses XDG_RUNTIME_DIR on Linux when set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      vi.stubEnv('XDG_RUNTIME_DIR', '/run/user/1000')
      const socketPath = getSocketPath('/home/test/project')
      expect(socketPath).toMatch(/^\/run\/user\/1000\/sidekick-[0-9a-f]{16}\.sock$/)
    })

    it('uses tmpdir on Linux when XDG_RUNTIME_DIR is not set', () => {
      Object.defineProperty(process, 'platform', { value: 'linux' })
      vi.stubEnv('XDG_RUNTIME_DIR', '')
      const socketPath = getSocketPath('/home/test/project')
      expect(socketPath).toContain(os.tmpdir())
    })

    it('ignores XDG_RUNTIME_DIR on non-Linux platforms', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      vi.stubEnv('XDG_RUNTIME_DIR', '/run/user/1000')
      const socketPath = getSocketPath('/Users/test/project')
      expect(socketPath).not.toContain('/run/user/1000')
      expect(socketPath).toContain(os.tmpdir())
    })

    it('includes project hash in socket name', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const projectDir = '/Users/test/project'
      const hash = getProjectHash(projectDir)
      const socketPath = getSocketPath(projectDir)
      expect(socketPath).toContain(hash)
    })
  })

  describe('validateSocketPath', () => {
    const originalPlatform = process.platform

    afterEach(() => {
      Object.defineProperty(process, 'platform', { value: originalPlatform })
    })

    it('does not throw for valid short paths on Unix', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      expect(() => validateSocketPath('/tmp/test.sock')).not.toThrow()
    })

    it('throws for paths exceeding UNIX_PATH_MAX on Unix', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const longPath = '/tmp/' + 'a'.repeat(150) + '.sock'
      expect(() => validateSocketPath(longPath)).toThrow(/exceeds Unix limit/)
    })

    it('includes path length in error message', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const longPath = '/tmp/' + 'a'.repeat(150) + '.sock'
      expect(() => validateSocketPath(longPath)).toThrow(new RegExp(`got ${longPath.length}`))
    })

    it('includes the actual path in error message', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const longPath = '/tmp/' + 'a'.repeat(150) + '.sock'
      expect(() => validateSocketPath(longPath)).toThrow(new RegExp(longPath.substring(0, 50)))
    })

    it('does not throw on Windows regardless of path length', () => {
      Object.defineProperty(process, 'platform', { value: 'win32' })
      const longPath = '\\\\.\\pipe\\' + 'a'.repeat(200)
      expect(() => validateSocketPath(longPath)).not.toThrow()
    })

    it('allows paths exactly at UNIX_PATH_MAX', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const exactPath = 'a'.repeat(UNIX_PATH_MAX)
      expect(() => validateSocketPath(exactPath)).not.toThrow()
    })

    it('throws for paths one character over UNIX_PATH_MAX', () => {
      Object.defineProperty(process, 'platform', { value: 'darwin' })
      const overPath = 'a'.repeat(UNIX_PATH_MAX + 1)
      expect(() => validateSocketPath(overPath)).toThrow(/exceeds Unix limit/)
    })
  })

  describe('getTokenPath', () => {
    it('returns correct token path', () => {
      const tokenPath = getTokenPath('/Users/test/project')
      expect(tokenPath).toBe(path.join('/Users/test/project', '.sidekick', 'sidekickd.token'))
    })

    it('handles trailing slash in project dir', () => {
      const tokenPath = getTokenPath('/Users/test/project/')
      expect(tokenPath).toBe(path.join('/Users/test/project/', '.sidekick', 'sidekickd.token'))
    })

    it('uses .sidekick subdirectory', () => {
      const tokenPath = getTokenPath('/any/path')
      expect(tokenPath).toContain('.sidekick')
      expect(tokenPath).toContain('sidekickd.token')
    })
  })

  describe('getPidPath', () => {
    it('returns correct PID path', () => {
      const pidPath = getPidPath('/Users/test/project')
      expect(pidPath).toBe(path.join('/Users/test/project', '.sidekick', 'sidekickd.pid'))
    })

    it('uses .sidekick subdirectory', () => {
      const pidPath = getPidPath('/any/path')
      expect(pidPath).toContain('.sidekick')
      expect(pidPath).toContain('sidekickd.pid')
    })
  })

  describe('getLockPath', () => {
    it('returns correct lock path', () => {
      const lockPath = getLockPath('/Users/test/project')
      expect(lockPath).toBe(path.join('/Users/test/project', '.sidekick', 'sidekickd.lock'))
    })

    it('uses .sidekick subdirectory', () => {
      const lockPath = getLockPath('/any/path')
      expect(lockPath).toContain('.sidekick')
      expect(lockPath).toContain('sidekickd.lock')
    })
  })

  describe('getUserDaemonsDir', () => {
    it('returns path under home directory', () => {
      const daemonsDir = getUserDaemonsDir()
      expect(daemonsDir).toBe(path.join(os.homedir(), '.sidekick', 'daemons'))
    })

    it('uses .sidekick/daemons path', () => {
      const daemonsDir = getUserDaemonsDir()
      expect(daemonsDir).toContain('.sidekick')
      expect(daemonsDir).toContain('daemons')
    })
  })

  describe('getUserPidPath', () => {
    it('returns path in daemons directory with project hash', () => {
      const projectDir = '/Users/test/project'
      const hash = getProjectHash(projectDir)
      const pidPath = getUserPidPath(projectDir)
      expect(pidPath).toBe(path.join(os.homedir(), '.sidekick', 'daemons', `${hash}.pid`))
    })

    it('uses same hash as getProjectHash', () => {
      const projectDir = '/some/project/path'
      const hash = getProjectHash(projectDir)
      const pidPath = getUserPidPath(projectDir)
      expect(pidPath).toContain(hash)
    })

    it('produces unique paths for different projects', () => {
      const pidPath1 = getUserPidPath('/project1')
      const pidPath2 = getUserPidPath('/project2')
      expect(pidPath1).not.toBe(pidPath2)
    })
  })
})
