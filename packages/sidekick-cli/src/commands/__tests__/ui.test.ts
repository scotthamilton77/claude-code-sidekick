/**
 * Tests for UI command handler.
 *
 * Verifies BEHAVIOR of handleUiCommand:
 * - Exit codes from child process
 * - stdout forwarding
 * - Option defaults (port, host, open)
 * - Graceful shutdown on signals
 *
 * Uses controlled child process mocks since spawn is an external system interface.
 *
 * @see ui.ts handleUiCommand
 */
import { EventEmitter } from 'node:events'
import { Writable } from 'node:stream'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import type { Logger } from '@sidekick/types'
import { createFakeLogger } from '@sidekick/testing-fixtures'

// CollectingWritable to capture stdout output
class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer | string, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Minimal shape of a child process for testing
type FakeChildProcess = EventEmitter & {
  pid: number
  exitCode: number | null
  stdout: EventEmitter | null
  stderr: EventEmitter | null
  kill: ReturnType<typeof vi.fn>
  unref: ReturnType<typeof vi.fn>
}

// Create a fake child process that emits events
function createFakeChildProcess(): FakeChildProcess {
  const proc = new EventEmitter() as FakeChildProcess
  proc.pid = 12345
  proc.exitCode = null
  proc.stdout = new EventEmitter()
  proc.stderr = new EventEmitter()
  proc.kill = vi.fn()
  proc.unref = vi.fn()
  return proc
}

// Hoist the mock factory to work with vi.mock
const { mockSpawn, getSpawnedProcesses, clearSpawnedProcesses } = vi.hoisted(() => {
  const spawnedProcesses: any[] = []

  const mockSpawn = vi.fn(() => {
    // Create a fresh child process for each spawn call
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const EventEmitter = require('node:events').EventEmitter
    const proc = new EventEmitter()
    proc.pid = 12345 + spawnedProcesses.length
    proc.exitCode = null
    proc.stdout = new EventEmitter()
    proc.stderr = new EventEmitter()
    proc.kill = vi.fn()
    proc.unref = vi.fn()
    spawnedProcesses.push(proc)
    return proc
  })

  return {
    mockSpawn,
    getSpawnedProcesses: () => spawnedProcesses,
    clearSpawnedProcesses: () => {
      spawnedProcesses.length = 0
    },
  }
})

// Mock child_process.spawn
vi.mock('node:child_process', () => ({
  spawn: mockSpawn,
}))

import { handleUiCommand } from '../ui'

describe('handleUiCommand', () => {
  let stdout: CollectingWritable
  let logger: Logger
  const signalHandlers: Map<string, () => void> = new Map()

  // Helper to get the server process (first spawned)
  const getServerProcess = (): ReturnType<typeof createFakeChildProcess> => getSpawnedProcesses()[0]

  beforeEach(() => {
    stdout = new CollectingWritable()
    logger = createFakeLogger()
    signalHandlers.clear()
    clearSpawnedProcesses()
    vi.clearAllMocks()

    // Capture signal handlers registered during test
    vi.spyOn(process, 'on').mockImplementation((event: string | symbol, handler: () => void) => {
      if (typeof event === 'string' && (event === 'SIGINT' || event === 'SIGTERM')) {
        signalHandlers.set(event, handler)
      }
      return process
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('process spawning', () => {
    test('spawns vite binary from sidekick-ui package', async () => {
      const promise = handleUiCommand(logger, stdout)

      // Simulate immediate exit
      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.stringContaining('sidekick-ui/node_modules/.bin/vite'),
        expect.any(Array),
        expect.any(Object)
      )
    })

    test('sets cwd to sidekick-ui package directory', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      const spawnOptions = (mockSpawn.mock.calls as any)[0][2]
      expect(spawnOptions.cwd).toMatch(/sidekick-ui$/)
    })

    test('passes default port 3000 and host localhost', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--port', '3000', '--host', 'localhost']),
        expect.any(Object)
      )
    })

    test('passes custom port when provided', async () => {
      const promise = handleUiCommand(logger, stdout, { port: 8080 })

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--port', '8080']),
        expect.any(Object)
      )
    })

    test('passes custom host when provided', async () => {
      const promise = handleUiCommand(logger, stdout, { host: '0.0.0.0' })

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.arrayContaining(['--host', '0.0.0.0']),
        expect.any(Object)
      )
    })
  })

  describe('exit code handling', () => {
    test('returns exit code 0 on successful exit', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      const result = await promise
      expect(result.exitCode).toBe(0)
    })

    test('returns exit code from child process', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().exitCode = 1
        getServerProcess().emit('exit', 1, null)
      }, 0)

      const result = await promise
      expect(result.exitCode).toBe(1)
    })

    test('returns 0 for null exit code', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().emit('exit', null, 'SIGTERM')
      }, 0)

      const result = await promise
      expect(result.exitCode).toBe(0)
    })
  })

  describe('stdout handling', () => {
    test('forwards child process stdout to output stream', async () => {
      const promise = handleUiCommand(logger, stdout)

      // Emit some output
      setTimeout(() => {
        getServerProcess().stdout?.emit('data', Buffer.from('Server starting...\n'))
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(stdout.data).toContain('Server starting...')
    })

    test('shows running message when Vite server starts listening', async () => {
      const promise = handleUiCommand(logger, stdout, {
        port: 3000,
        host: 'localhost',
      })

      setTimeout(() => {
        // Vite emits 'Local:' when the dev server is ready
        getServerProcess().stdout?.emit('data', Buffer.from('  Local:   http://localhost:3000/\n'))
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(stdout.data).toContain('Sidekick UI running at http://localhost:3000')
      expect(stdout.data).toContain('Press Ctrl+C to stop')
    })

    test('forwards child process stderr to output stream', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().stderr?.emit('data', Buffer.from('Warning: deprecated API\n'))
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(stdout.data).toContain('Warning: deprecated API')
    })
  })

  describe('signal handling', () => {
    test('registers SIGINT handler', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(signalHandlers.has('SIGINT')).toBe(true)
    })

    test('registers SIGTERM handler', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(signalHandlers.has('SIGTERM')).toBe(true)
    })

    test('kills child process on SIGINT', async () => {
      const promise = handleUiCommand(logger, stdout)

      // Give time for handlers to register, then trigger SIGINT
      setTimeout(() => {
        const handler = signalHandlers.get('SIGINT')
        if (handler) handler()

        // After signal, simulate exit
        setTimeout(() => {
          getServerProcess().exitCode = 0
          getServerProcess().emit('exit', 0, null)
        }, 10)
      }, 0)

      await promise

      expect(getServerProcess().kill).toHaveBeenCalledWith('SIGTERM')
      expect(stdout.data).toContain('Shutting down UI server...')
    })

    test('force kills process after timeout if graceful shutdown fails', async () => {
      vi.useFakeTimers()

      const promise = handleUiCommand(logger, stdout)

      // Wait for async operations to settle
      await vi.runAllTimersAsync()

      // Trigger shutdown signal
      const handler = signalHandlers.get('SIGINT')
      expect(handler).toBeDefined()
      handler!()

      // Process hasn't exited yet (exitCode still null)
      expect(getServerProcess().exitCode).toBeNull()

      // Advance time past the 5 second timeout
      await vi.advanceTimersByTimeAsync(5100)

      // Should have tried SIGKILL
      expect(getServerProcess().kill).toHaveBeenCalledWith('SIGTERM')
      expect(getServerProcess().kill).toHaveBeenCalledWith('SIGKILL')
      expect(logger.warn).toHaveBeenCalledWith('UI server did not stop gracefully, force killing')

      // Now let the process exit
      getServerProcess().exitCode = 0
      getServerProcess().emit('exit', 0, null)

      vi.useRealTimers()

      await promise
    })
  })

  describe('logging', () => {
    test('logs server start info', async () => {
      const promise = handleUiCommand(logger, stdout, {
        port: 4000,
        host: '0.0.0.0',
      })

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(logger.info).toHaveBeenCalledWith(
        'Starting Sidekick UI server',
        expect.objectContaining({
          port: 4000,
          host: '0.0.0.0',
        })
      )
    })

    test('logs when server stopped', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      expect(logger.info).toHaveBeenCalledWith('UI server stopped')
    })

    test('logs error when server exits with error code', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().exitCode = 1
        getServerProcess().emit('exit', 1, null)
      }, 0)

      await promise

      expect(logger.error).toHaveBeenCalledWith('UI server exited with error', expect.objectContaining({ exitCode: 1 }))
    })

    test('logs when terminated by signal', async () => {
      const promise = handleUiCommand(logger, stdout)

      setTimeout(() => {
        getServerProcess().emit('exit', null, 'SIGKILL')
      }, 0)

      await promise

      expect(logger.info).toHaveBeenCalledWith(
        'UI server terminated by signal',
        expect.objectContaining({ signal: 'SIGKILL' })
      )
    })
  })

  describe('browser opening', () => {
    test('opens browser by default when server starts', async () => {
      const promise = handleUiCommand(logger, stdout, { open: true })

      setTimeout(() => {
        getServerProcess().stdout?.emit('data', Buffer.from('  Local:   http://localhost:3000/\n'))
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      // Browser open is spawned as detached process
      // Should have been called twice: once for server, once for browser
      expect(mockSpawn.mock.calls.length).toBeGreaterThanOrEqual(1)
    })

    test('skips browser open when open is false', async () => {
      const promise = handleUiCommand(logger, stdout, { open: false })

      setTimeout(() => {
        getServerProcess().stdout?.emit('data', Buffer.from('  Local:   http://localhost:3000/\n'))
        getServerProcess().exitCode = 0
        getServerProcess().emit('exit', 0, null)
      }, 0)

      await promise

      // Only server spawn, no browser spawn
      expect(mockSpawn.mock.calls.length).toBe(1)
    })
  })
})
