import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createLogManager } from '@sidekick/core'
import { EventEmitter } from 'node:events'
import { spawnClaudeCli, AuthError, ProviderError } from '../index'

/** Mock ChildProcess with guaranteed stdout/stderr (never null like real ChildProcess) */
interface MockChildProcess extends EventEmitter {
  stdout: EventEmitter
  stderr: EventEmitter
  stdin: { write: ReturnType<typeof vi.fn>; end: ReturnType<typeof vi.fn> }
  kill: ReturnType<typeof vi.fn>
}

// Mock child_process
vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}))

const logger = createLogManager({
  destinations: { console: { enabled: false } },
}).getLogger()

describe('spawnClaudeCli', () => {
  let mockSpawn: ReturnType<typeof vi.fn>

  beforeEach(async () => {
    vi.clearAllMocks()
    const { spawn } = await import('node:child_process')
    mockSpawn = spawn as ReturnType<typeof vi.fn>
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  const createMockProcess = (): MockChildProcess => {
    const proc = new EventEmitter() as MockChildProcess
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.stdin = {
      write: vi.fn(),
      end: vi.fn(),
    }
    proc.kill = vi.fn()
    return proc
  }

  describe('successful execution', () => {
    it('returns stdout and stderr on success', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        logger,
      })

      setTimeout(() => {
        mockProc.stdout.emit('data', Buffer.from('Response'))
        mockProc.stderr.emit('data', Buffer.from('Warning'))
        mockProc.emit('close', 0)
      }, 10)

      const result = await resultPromise

      expect(result.stdout).toBe('Response')
      expect(result.stderr).toBe('Warning')
      expect(result.exitCode).toBe(0)
    })

    it('sends stdin when provided', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p'],
        stdin: 'Input text',
        logger,
      })

      setTimeout(() => {
        mockProc.stdout.emit('data', Buffer.from('OK'))
        mockProc.emit('close', 0)
      }, 10)

      await resultPromise

      expect(mockProc.stdin.write).toHaveBeenCalledWith('Input text')
      expect(mockProc.stdin.end).toHaveBeenCalled()
    })

    it('uses custom CLI path when provided', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['--version'],
        cliPath: '/custom/path/claude',
        logger,
      })

      setTimeout(() => {
        mockProc.stdout.emit('data', Buffer.from('1.0.0'))
        mockProc.emit('close', 0)
      }, 10)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith('/custom/path/claude', ['--version'], expect.any(Object))
    })

    it('uses custom working directory when provided', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['--version'],
        cwd: '/custom/cwd',
        logger,
      })

      setTimeout(() => {
        mockProc.stdout.emit('data', Buffer.from('1.0.0'))
        mockProc.emit('close', 0)
      }, 10)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith('claude', ['--version'], expect.objectContaining({ cwd: '/custom/cwd' }))
    })
  })

  describe('error handling', () => {
    it('throws TimeoutError on exit code 124', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 1,
        logger,
      })

      setTimeout(() => {
        mockProc.emit('close', 124)
      }, 10)

      await expect(resultPromise).rejects.toThrow('Request timeout')
    })

    it('throws TimeoutError when process is killed due to timeout', async () => {
      vi.useFakeTimers()
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        timeout: 100,
        maxRetries: 1,
        logger,
      })

      // Advance past timeout
      await vi.advanceTimersByTimeAsync(150)

      // Process is killed
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')

      // Emit close after kill
      mockProc.emit('close', null)

      await expect(resultPromise).rejects.toThrow('Request timeout')
    })

    it('throws AuthError on exit code 401', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 1,
        logger,
      })

      setTimeout(() => {
        mockProc.stderr.emit('data', Buffer.from('unauthorized'))
        mockProc.emit('close', 401)
      }, 10)

      await expect(resultPromise).rejects.toThrow(AuthError)
    })

    it('throws AuthError when stderr contains authentication error', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 1,
        logger,
      })

      setTimeout(() => {
        mockProc.stderr.emit('data', Buffer.from('authentication failed'))
        mockProc.emit('close', 1)
      }, 10)

      await expect(resultPromise).rejects.toThrow(AuthError)
    })

    it('throws ProviderError when CLI not found (ENOENT)', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        cliPath: 'nonexistent-cli',
        maxRetries: 1,
        logger,
      })

      setTimeout(() => {
        const err = new Error('spawn nonexistent-cli ENOENT')
        ;(err as NodeJS.ErrnoException).code = 'ENOENT'
        mockProc.emit('error', err)
      }, 10)

      await expect(resultPromise).rejects.toThrow('Claude CLI not found')
    })

    it('throws ProviderError on non-zero exit code', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 1,
        logger,
      })

      setTimeout(() => {
        mockProc.stderr.emit('data', Buffer.from('Error message'))
        mockProc.emit('close', 1)
      }, 10)

      await expect(resultPromise).rejects.toThrow(ProviderError)
      await expect(resultPromise).rejects.toThrow('CLI exited with code 1')
    })
  })

  describe('retry behavior', () => {
    it('retries on transient failures', async () => {
      vi.useFakeTimers()

      const mockProc1 = createMockProcess()
      const mockProc2 = createMockProcess()
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 2,
        logger,
      })

      // First attempt fails with retryable error (exit code >= 500)
      await vi.advanceTimersByTimeAsync(5)
      mockProc1.stderr.emit('data', Buffer.from('Server error'))
      mockProc1.emit('close', 500)

      // Advance through retry delay (exponential backoff: 1000ms)
      await vi.advanceTimersByTimeAsync(1000)

      // Second attempt succeeds
      await vi.advanceTimersByTimeAsync(5)
      mockProc2.stdout.emit('data', Buffer.from('Success'))
      mockProc2.emit('close', 0)

      const result = await resultPromise

      expect(result.stdout).toBe('Success')
      expect(mockSpawn).toHaveBeenCalledTimes(2)
    })

    it('does not retry AuthError', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 3,
        logger,
      })

      setTimeout(() => {
        mockProc.stderr.emit('data', Buffer.from('unauthorized'))
        mockProc.emit('close', 401)
      }, 10)

      await expect(resultPromise).rejects.toThrow(AuthError)
      expect(mockSpawn).toHaveBeenCalledTimes(1) // No retries
    })

    it('does not retry when CLI not found', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 3,
        logger,
      })

      setTimeout(() => {
        const err = new Error('spawn claude ENOENT')
        ;(err as NodeJS.ErrnoException).code = 'ENOENT'
        mockProc.emit('error', err)
      }, 10)

      await expect(resultPromise).rejects.toThrow('Claude CLI not found')
      expect(mockSpawn).toHaveBeenCalledTimes(1) // No retries
    })

    it('exhausts retries and throws final error', async () => {
      vi.useFakeTimers()

      const mockProc1 = createMockProcess()
      const mockProc2 = createMockProcess()
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 2,
        logger,
      })

      // First attempt fails
      await vi.advanceTimersByTimeAsync(5)
      mockProc1.stderr.emit('data', Buffer.from('Server error 1'))
      mockProc1.emit('close', 500)

      // Advance through retry delay
      await vi.advanceTimersByTimeAsync(1000)

      // Second attempt fails
      await vi.advanceTimersByTimeAsync(5)
      mockProc2.stderr.emit('data', Buffer.from('Server error 2'))
      mockProc2.emit('close', 500)

      await expect(resultPromise).rejects.toThrow('failed after 2 retries')
      expect(mockSpawn).toHaveBeenCalledTimes(2)
    })

    it('uses exponential backoff for retries', async () => {
      vi.useFakeTimers()

      const mockProc1 = createMockProcess()
      const mockProc2 = createMockProcess()
      const mockProc3 = createMockProcess()
      mockSpawn.mockReturnValueOnce(mockProc1).mockReturnValueOnce(mockProc2).mockReturnValueOnce(mockProc3)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 3,
        logger,
      })

      // First attempt fails immediately
      await vi.advanceTimersByTimeAsync(5)
      mockProc1.emit('close', 500)

      // Wait for first retry (exponential backoff)
      await vi.advanceTimersByTimeAsync(1500) // Allow some tolerance
      expect(mockSpawn).toHaveBeenCalledTimes(2)

      // Second attempt fails
      await vi.advanceTimersByTimeAsync(5)
      mockProc2.emit('close', 500)

      // Wait for second retry (should be longer than first)
      await vi.advanceTimersByTimeAsync(3000) // Allow tolerance for 2^1 * 1000ms
      expect(mockSpawn).toHaveBeenCalledTimes(3)

      // Third attempt succeeds
      await vi.advanceTimersByTimeAsync(5)
      mockProc3.stdout.emit('data', Buffer.from('OK'))
      mockProc3.emit('close', 0)

      const result = await resultPromise
      expect(result.stdout).toBe('OK')
    })
  })

  describe('default values', () => {
    it('uses default CLI path of "claude"', async () => {
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['--version'],
        logger,
      })

      setTimeout(() => {
        mockProc.stdout.emit('data', Buffer.from('1.0.0'))
        mockProc.emit('close', 0)
      }, 10)

      await resultPromise

      expect(mockSpawn).toHaveBeenCalledWith('claude', ['--version'], expect.any(Object))
    })

    it('uses default maxRetries of 3', async () => {
      vi.useFakeTimers()

      const procs = Array.from({ length: 3 }, () => createMockProcess())
      procs.forEach((p) => mockSpawn.mockReturnValueOnce(p))

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        // No maxRetries specified
        logger,
      })

      // All 3 attempts fail
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(5)
        procs[i].emit('close', 500)
        if (i < 2) {
          await vi.advanceTimersByTimeAsync(10000) // Max delay is 10s
        }
      }

      await expect(resultPromise).rejects.toThrow('failed after 3 retries')
      expect(mockSpawn).toHaveBeenCalledTimes(3)
    })

    it('uses default timeout of 60000ms', async () => {
      vi.useFakeTimers()
      const mockProc = createMockProcess()
      mockSpawn.mockReturnValue(mockProc)

      const resultPromise = spawnClaudeCli({
        args: ['-p', 'Hello'],
        maxRetries: 1,
        // No timeout specified - should use 60s default
        logger,
      })

      // Advance time less than default timeout
      await vi.advanceTimersByTimeAsync(55000)
      expect(mockProc.kill).not.toHaveBeenCalled()

      // Advance past the default timeout
      await vi.advanceTimersByTimeAsync(10000)
      expect(mockProc.kill).toHaveBeenCalledWith('SIGTERM')

      mockProc.emit('close', null)
      await expect(resultPromise).rejects.toThrow('Request timeout')
    })
  })
})
