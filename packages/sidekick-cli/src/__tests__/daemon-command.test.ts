/**
 * Tests for daemon command handler.
 *
 * Tests the CLI daemon subcommands (start, stop, status, kill, kill-all)
 * and their various options (e.g., --wait flag for stop).
 *
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
 */
import { Writable } from 'node:stream'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import type { Logger } from '@sidekick/core'
import { handleDaemonCommand } from '../commands/daemon.js'

class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Use vi.hoisted to declare mocks that are used in vi.mock factory
const { mockDaemonClient, mockKillAllDaemons } = vi.hoisted(() => ({
  mockDaemonClient: {
    start: vi.fn(),
    stop: vi.fn(),
    stopAndWait: vi.fn(),
    getStatus: vi.fn(),
    kill: vi.fn(),
  },
  mockKillAllDaemons: vi.fn(),
}))

// Mock @sidekick/core module
vi.mock('@sidekick/core', () => ({
  DaemonClient: vi.fn(function () { return mockDaemonClient }),
  killAllDaemons: mockKillAllDaemons,
}))

// Mock logger
const mockLogger: Logger = {
  trace: vi.fn() as any,
  debug: vi.fn() as any,
  info: vi.fn() as any,
  warn: vi.fn() as any,
  error: vi.fn() as any,
  fatal: vi.fn() as any,
  child: vi.fn(() => mockLogger),
  flush: vi.fn().mockResolvedValue(undefined),
}

describe('handleDaemonCommand', () => {
  let stdout: CollectingWritable

  beforeEach(() => {
    stdout = new CollectingWritable()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('start subcommand', () => {
    test('starts the daemon', async () => {
      mockDaemonClient.start.mockResolvedValue(undefined)

      const result = await handleDaemonCommand('start', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockDaemonClient.start).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('Daemon started')
    })
  })

  describe('stop subcommand', () => {
    test('stops daemon without --wait flag', async () => {
      mockDaemonClient.stop.mockResolvedValue(undefined)

      const result = await handleDaemonCommand('stop', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockDaemonClient.stop).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('Daemon stopping')
    })

    test('stops daemon with --wait flag and successful shutdown', async () => {
      mockDaemonClient.stopAndWait.mockResolvedValue(true)

      const result = await handleDaemonCommand('stop', '/tmp/project', mockLogger, stdout, { wait: true })

      expect(result.exitCode).toBe(0)
      expect(mockDaemonClient.stopAndWait).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('Daemon stopped')
    })

    test('returns error when --wait flag times out', async () => {
      mockDaemonClient.stopAndWait.mockResolvedValue(false)

      const result = await handleDaemonCommand('stop', '/tmp/project', mockLogger, stdout, { wait: true })

      expect(result.exitCode).toBe(1)
      expect(mockDaemonClient.stopAndWait).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('did not stop within timeout')
      expect(stdout.data).toContain('sidekick daemon kill')
    })
  })

  describe('status subcommand', () => {
    test('returns daemon status as JSON', async () => {
      const statusResult = {
        status: 'running',
        ping: { timestamp: Date.now() },
      }
      mockDaemonClient.getStatus.mockResolvedValue(statusResult)

      const result = await handleDaemonCommand('status', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockDaemonClient.getStatus).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('"status": "running"')
      expect(stdout.data).toContain('"ping"')
    })
  })

  describe('kill subcommand', () => {
    test('kills daemon when running', async () => {
      mockDaemonClient.kill.mockResolvedValue({ killed: true, pid: 12345 })

      const result = await handleDaemonCommand('kill', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockDaemonClient.kill).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('Killed daemon')
      expect(stdout.data).toContain('12345')
    })

    test('reports when no daemon running', async () => {
      mockDaemonClient.kill.mockResolvedValue({ killed: false })

      const result = await handleDaemonCommand('kill', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockDaemonClient.kill).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('No daemon running')
    })
  })

  describe('kill-all subcommand', () => {
    test('kills all daemons', async () => {
      mockKillAllDaemons.mockResolvedValue([
        { projectDir: '/project1', pid: 111, killed: true },
        { projectDir: '/project2', pid: 222, killed: true },
      ])

      const result = await handleDaemonCommand('kill-all', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockKillAllDaemons).toHaveBeenCalledWith(mockLogger)
      expect(stdout.data).toContain('Killed: PID 111')
      expect(stdout.data).toContain('Killed: PID 222')
      expect(stdout.data).toContain('Killed 2 of 2 daemons')
    })

    test('reports when no daemons found', async () => {
      mockKillAllDaemons.mockResolvedValue([])

      const result = await handleDaemonCommand('kill-all', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockKillAllDaemons).toHaveBeenCalledWith(mockLogger)
      expect(stdout.data).toContain('No daemons found')
    })

    test('reports failures when some kills fail', async () => {
      mockKillAllDaemons.mockResolvedValue([
        { projectDir: '/project1', pid: 111, killed: true },
        { projectDir: '/project2', pid: 222, killed: false, error: 'EPERM' },
      ])

      const result = await handleDaemonCommand('kill-all', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Killed: PID 111')
      expect(stdout.data).toContain('Failed: PID 222')
      expect(stdout.data).toContain('EPERM')
      expect(stdout.data).toContain('Killed 1 of 2 daemons')
    })
  })

  describe('help subcommand', () => {
    test('shows usage for --help', async () => {
      const result = await handleDaemonCommand('--help', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick daemon')
      expect(stdout.data).toContain('start')
      expect(stdout.data).toContain('stop')
      expect(stdout.data).toContain('status')
      expect(stdout.data).toContain('kill')
    })

    test('shows usage for -h', async () => {
      const result = await handleDaemonCommand('-h', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick daemon')
    })

    test('shows usage for help', async () => {
      const result = await handleDaemonCommand('help', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick daemon')
    })
  })

  describe('unknown subcommand', () => {
    test('returns error and shows usage', async () => {
      const result = await handleDaemonCommand('invalid', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Unknown daemon subcommand')
      expect(stdout.data).toContain('invalid')
      expect(stdout.data).toContain('Usage: sidekick daemon')
    })
  })
})
