/**
 * Tests for I/O operations extracted from Daemon class:
 * PID files, auth tokens, file cleanup, and process-level error handlers.
 *
 * @see daemon-io.ts
 */
import fs from 'fs/promises'
import os from 'os'
import path from 'path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Logger } from '@sidekick/core'

// ── Mocks ───────────────────────────────────────────────────────────────────

// Mock @sidekick/core path functions to return predictable paths based on projectDir
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal()
  return {
    ...actual,
    getPidPath: (dir: string) => path.join(dir, '.sidekick', 'daemon.pid'),
    getTokenPath: (dir: string) => path.join(dir, '.sidekick', 'daemon.token'),
    getUserPidPath: (dir: string) => path.join(dir, '.sidekick', 'daemons', 'user.pid'),
    getUserDaemonsDir: () => path.join(tmpDir, '.sidekick', 'daemons'),
  }
})

let tmpDir: string

function createMockLogger(): Logger {
  return {
    trace: vi.fn() as any,
    debug: vi.fn() as any,
    info: vi.fn() as any,
    warn: vi.fn() as any,
    error: vi.fn() as any,
    fatal: vi.fn() as any,
    child: vi.fn() as any,
  } as Logger
}

// ── Setup ───────────────────────────────────────────────────────────────────

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sidekick-daemon-io-test-'))
  await fs.mkdir(path.join(tmpDir, '.sidekick', 'daemons'), { recursive: true })
})

afterEach(async () => {
  vi.restoreAllMocks()
  try {
    await fs.rm(tmpDir, { recursive: true, force: true })
  } catch {
    // cleanup may fail
  }
})

// ── writePid ────────────────────────────────────────────────────────────────

describe('writePid', () => {
  it('should create project-level PID file with process.pid', async () => {
    const { writePid } = await import('../daemon-io.js')
    await writePid(tmpDir)

    const pidContent = await fs.readFile(path.join(tmpDir, '.sidekick', 'daemon.pid'), 'utf-8')
    expect(pidContent).toBe(process.pid.toString())
  })

  it('should create user-level PID file with JSON data', async () => {
    const { writePid } = await import('../daemon-io.js')
    await writePid(tmpDir)

    const userPidContent = await fs.readFile(path.join(tmpDir, '.sidekick', 'daemons', 'user.pid'), 'utf-8')
    const parsed = JSON.parse(userPidContent) as { pid: number; projectDir: string; startedAt: string }
    expect(parsed.pid).toBe(process.pid)
    expect(parsed.projectDir).toBe(tmpDir)
    expect(parsed.startedAt).toBeTruthy()
  })
})

// ── writeToken ──────────────────────────────────────────────────────────────

describe('writeToken', () => {
  it('should return a 64-char hex string', async () => {
    const { writeToken } = await import('../daemon-io.js')
    const token = await writeToken(tmpDir)

    expect(token).toHaveLength(64)
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('should write token to the token path', async () => {
    const { writeToken } = await import('../daemon-io.js')
    const token = await writeToken(tmpDir)

    const fileContent = await fs.readFile(path.join(tmpDir, '.sidekick', 'daemon.token'), 'utf-8')
    expect(fileContent).toBe(token)
  })

  it('should write token with mode 0600', async () => {
    const { writeToken } = await import('../daemon-io.js')
    await writeToken(tmpDir)

    const stat = await fs.stat(path.join(tmpDir, '.sidekick', 'daemon.token'))
    const mode = stat.mode & 0o777
    expect(mode).toBe(0o600)
  })
})

// ── cleanup ─────────────────────────────────────────────────────────────────

describe('cleanup', () => {
  it('should remove PID, token, and user PID files', async () => {
    const { writePid, writeToken, cleanup } = await import('../daemon-io.js')

    // Create files first
    await writePid(tmpDir)
    await writeToken(tmpDir)

    // Verify they exist
    const pidPath = path.join(tmpDir, '.sidekick', 'daemon.pid')
    const tokenPath = path.join(tmpDir, '.sidekick', 'daemon.token')
    const userPidPath = path.join(tmpDir, '.sidekick', 'daemons', 'user.pid')
    await expect(fs.access(pidPath)).resolves.toBeUndefined()
    await expect(fs.access(tokenPath)).resolves.toBeUndefined()
    await expect(fs.access(userPidPath)).resolves.toBeUndefined()

    // Cleanup
    await cleanup(tmpDir)

    // Verify they're gone
    await expect(fs.access(pidPath)).rejects.toThrow()
    await expect(fs.access(tokenPath)).rejects.toThrow()
    await expect(fs.access(userPidPath)).rejects.toThrow()
  })

  it('should not crash if files do not exist', async () => {
    const { cleanup } = await import('../daemon-io.js')
    // Should not throw even though no files exist
    await expect(cleanup(tmpDir)).resolves.toBeUndefined()
  })
})

// ── setupErrorHandlers ──────────────────────────────────────────────────────

describe('setupErrorHandlers', () => {
  let processExitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    // Mock process.exit to prevent test from actually exiting
    processExitSpy = vi.spyOn(process, 'exit').mockImplementation(() => undefined as never)
  })

  afterEach(() => {
    processExitSpy.mockRestore()
  })

  it('should install uncaughtException and unhandledRejection handlers', async () => {
    const { setupErrorHandlers } = await import('../daemon-io.js')
    const logger = createMockLogger()
    const cleanupFn = vi.fn().mockResolvedValue(undefined)

    const processOnSpy = vi.spyOn(process, 'on')

    setupErrorHandlers(logger, '/fake/project', cleanupFn)

    // Verify handlers were installed
    const calls = processOnSpy.mock.calls.map((c) => c[0])
    expect(calls).toContain('uncaughtException')
    expect(calls).toContain('unhandledRejection')

    // Verify debug log was emitted
    expect(logger.debug).toHaveBeenCalledWith('Process error handlers installed')
  })

  it('should log fatal error and call cleanup on uncaughtException', async () => {
    const { setupErrorHandlers } = await import('../daemon-io.js')
    const logger = createMockLogger()
    const cleanupFn = vi.fn().mockResolvedValue(undefined)

    // Capture the registered handler
    const handlers = new Map<string, (...args: unknown[]) => void>()
    vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
      return process
    })

    setupErrorHandlers(logger, '/fake/project', cleanupFn)

    // Invoke the uncaughtException handler
    const error = new Error('test crash')
    const handler = handlers.get('uncaughtException')!
    handler(error)

    // Should have logged fatal
    expect(logger.fatal).toHaveBeenCalledWith(
      'Fatal uncaughtException',
      expect.objectContaining({
        error: expect.objectContaining({ message: 'test crash' }),
        projectDir: '/fake/project',
      })
    )

    // Should have called cleanup
    expect(cleanupFn).toHaveBeenCalled()

    // Wait for cleanup promise to settle
    await vi.waitFor(() => {
      expect(processExitSpy).toHaveBeenCalledWith(1)
    })
  })

  it('should log fatal error on unhandledRejection', async () => {
    const { setupErrorHandlers } = await import('../daemon-io.js')
    const logger = createMockLogger()
    const cleanupFn = vi.fn().mockResolvedValue(undefined)

    const handlers = new Map<string, (...args: unknown[]) => void>()
    vi.spyOn(process, 'on').mockImplementation((event: string, handler: (...args: unknown[]) => void) => {
      handlers.set(event, handler)
      return process
    })

    setupErrorHandlers(logger, '/fake/project', cleanupFn)

    // Invoke the unhandledRejection handler with a string reason
    const handler = handlers.get('unhandledRejection')!
    handler('some string reason')

    expect(logger.fatal).toHaveBeenCalledWith(
      'Fatal unhandledRejection',
      expect.objectContaining({
        error: 'some string reason',
      })
    )
  })
})
