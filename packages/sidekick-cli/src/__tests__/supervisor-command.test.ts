/**
 * Tests for supervisor command handler.
 *
 * Tests the CLI supervisor subcommands (start, stop, status, kill, kill-all)
 * and their various options (e.g., --wait flag for stop).
 *
 * @see docs/design/CLI.md §7 Supervisor Lifecycle Management
 */
import { Writable } from 'node:stream'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'
import type { Logger } from '@sidekick/core'
import { handleSupervisorCommand } from '../commands/supervisor.js'

class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Use vi.hoisted to declare mocks that are used in vi.mock factory
const { mockSupervisorClient, mockKillAllSupervisors } = vi.hoisted(() => ({
  mockSupervisorClient: {
    start: vi.fn(),
    stop: vi.fn(),
    stopAndWait: vi.fn(),
    getStatus: vi.fn(),
    kill: vi.fn(),
  },
  mockKillAllSupervisors: vi.fn(),
}))

// Mock @sidekick/core module
vi.mock('@sidekick/core', () => ({
  SupervisorClient: vi.fn(() => mockSupervisorClient),
  killAllSupervisors: mockKillAllSupervisors,
}))

// Mock logger
const mockLogger: Logger = {
  trace: vi.fn(),
  debug: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  fatal: vi.fn(),
  child: vi.fn(() => mockLogger),
  flush: vi.fn().mockResolvedValue(undefined),
}

describe('handleSupervisorCommand', () => {
  let stdout: CollectingWritable

  beforeEach(() => {
    stdout = new CollectingWritable()
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('start subcommand', () => {
    test('starts the supervisor', async () => {
      mockSupervisorClient.start.mockResolvedValue(undefined)

      const result = await handleSupervisorCommand('start', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockSupervisorClient.start).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('Supervisor started')
    })
  })

  describe('stop subcommand', () => {
    test('stops supervisor without --wait flag', async () => {
      mockSupervisorClient.stop.mockResolvedValue(undefined)

      const result = await handleSupervisorCommand('stop', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockSupervisorClient.stop).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('Supervisor stopping')
    })

    test('stops supervisor with --wait flag and successful shutdown', async () => {
      mockSupervisorClient.stopAndWait.mockResolvedValue(true)

      const result = await handleSupervisorCommand('stop', '/tmp/project', mockLogger, stdout, { wait: true })

      expect(result.exitCode).toBe(0)
      expect(mockSupervisorClient.stopAndWait).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('Supervisor stopped')
    })

    test('returns error when --wait flag times out', async () => {
      mockSupervisorClient.stopAndWait.mockResolvedValue(false)

      const result = await handleSupervisorCommand('stop', '/tmp/project', mockLogger, stdout, { wait: true })

      expect(result.exitCode).toBe(1)
      expect(mockSupervisorClient.stopAndWait).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('did not stop within timeout')
      expect(stdout.data).toContain('sidekick supervisor kill')
    })
  })

  describe('status subcommand', () => {
    test('returns supervisor status as JSON', async () => {
      const statusResult = {
        status: 'running',
        ping: { timestamp: Date.now() },
      }
      mockSupervisorClient.getStatus.mockResolvedValue(statusResult)

      const result = await handleSupervisorCommand('status', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockSupervisorClient.getStatus).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('"status": "running"')
      expect(stdout.data).toContain('"ping"')
    })
  })

  describe('kill subcommand', () => {
    test('kills supervisor when running', async () => {
      mockSupervisorClient.kill.mockResolvedValue({ killed: true, pid: 12345 })

      const result = await handleSupervisorCommand('kill', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockSupervisorClient.kill).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('Killed supervisor')
      expect(stdout.data).toContain('12345')
    })

    test('reports when no supervisor running', async () => {
      mockSupervisorClient.kill.mockResolvedValue({ killed: false })

      const result = await handleSupervisorCommand('kill', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockSupervisorClient.kill).toHaveBeenCalledOnce()
      expect(stdout.data).toContain('No supervisor running')
    })
  })

  describe('kill-all subcommand', () => {
    test('kills all supervisors', async () => {
      mockKillAllSupervisors.mockResolvedValue([
        { projectDir: '/project1', pid: 111, killed: true },
        { projectDir: '/project2', pid: 222, killed: true },
      ])

      const result = await handleSupervisorCommand('kill-all', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockKillAllSupervisors).toHaveBeenCalledWith(mockLogger)
      expect(stdout.data).toContain('Killed: PID 111')
      expect(stdout.data).toContain('Killed: PID 222')
      expect(stdout.data).toContain('Killed 2 of 2 supervisors')
    })

    test('reports when no supervisors found', async () => {
      mockKillAllSupervisors.mockResolvedValue([])

      const result = await handleSupervisorCommand('kill-all', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(mockKillAllSupervisors).toHaveBeenCalledWith(mockLogger)
      expect(stdout.data).toContain('No supervisors found')
    })

    test('reports failures when some kills fail', async () => {
      mockKillAllSupervisors.mockResolvedValue([
        { projectDir: '/project1', pid: 111, killed: true },
        { projectDir: '/project2', pid: 222, killed: false, error: 'EPERM' },
      ])

      const result = await handleSupervisorCommand('kill-all', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Killed: PID 111')
      expect(stdout.data).toContain('Failed: PID 222')
      expect(stdout.data).toContain('EPERM')
      expect(stdout.data).toContain('Killed 1 of 2 supervisors')
    })
  })

  describe('unknown subcommand', () => {
    test('returns error and shows available commands', async () => {
      const result = await handleSupervisorCommand('invalid', '/tmp/project', mockLogger, stdout)

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Unknown supervisor subcommand')
      expect(stdout.data).toContain('invalid')
      expect(stdout.data).toContain('Available commands')
    })
  })
})
