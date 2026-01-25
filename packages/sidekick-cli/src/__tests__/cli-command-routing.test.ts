/**
 * Tests for CLI command routing in runCli().
 *
 * Verifies BEHAVIOR of command routing:
 * - Exit codes (observable outcome)
 * - Stdout content (user-facing output)
 *
 * Does NOT verify implementation details like which handler was called
 * with what arguments - that's testing implementation, not behavior.
 *
 * @see cli.ts routeCommand function
 */
import { Writable } from 'node:stream'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest'

import { runCli } from '../cli'

class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

// Mock handlers - return observable exit codes
const { mockHandleDaemonCommand, mockHandleStatuslineCommand, mockHandleUiCommand } = vi.hoisted(() => ({
  mockHandleDaemonCommand: vi.fn(),
  mockHandleStatuslineCommand: vi.fn(),
  mockHandleUiCommand: vi.fn(),
}))

// Mock the command handler modules
vi.mock('../commands/daemon.js', () => ({
  handleDaemonCommand: mockHandleDaemonCommand,
}))

vi.mock('../commands/statusline.js', () => ({
  handleStatuslineCommand: mockHandleStatuslineCommand,
  parseStatuslineInput: vi.fn(() => undefined),
}))

vi.mock('../commands/ui.js', () => ({
  handleUiCommand: mockHandleUiCommand,
}))

// Mock @sidekick/core to prevent actual daemon operations
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    DaemonClient: vi.fn(() => ({
      start: vi.fn().mockResolvedValue(undefined),
    })),
  }
})

describe('CLI command routing', () => {
  let projectDir: string
  let stdout: CollectingWritable
  let stderr: CollectingWritable
  let originalSandboxEnv: string | undefined

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'sidekick-cli-routing-'))
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start'), '#!/usr/bin/env bash')

    stdout = new CollectingWritable()
    stderr = new CollectingWritable()

    // Save and clear sandbox mode for tests that need real daemon routing
    originalSandboxEnv = process.env.SANDBOX_RUNTIME
    delete process.env.SANDBOX_RUNTIME

    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    // Restore sandbox env
    if (originalSandboxEnv === undefined) {
      delete process.env.SANDBOX_RUNTIME
    } else {
      process.env.SANDBOX_RUNTIME = originalSandboxEnv
    }
    vi.clearAllMocks()
  })

  describe('daemon command', () => {
    test('returns success exit code on successful command', async () => {
      mockHandleDaemonCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['daemon'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
    })

    test('returns error exit code on failed command', async () => {
      mockHandleDaemonCommand.mockResolvedValue({ exitCode: 1 })

      const result = await runCli({
        argv: ['daemon', 'invalid'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(1)
    })

    test('propagates handler exit code for stop command', async () => {
      mockHandleDaemonCommand.mockResolvedValue({ exitCode: 1 })

      const result = await runCli({
        argv: ['daemon', 'stop', '--wait'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(1)
    })

    test('routes --kill flag to kill subcommand', async () => {
      mockHandleDaemonCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['daemon', '--kill'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
      // Verify the handler was called with 'kill' subcommand
      expect(mockHandleDaemonCommand).toHaveBeenCalledWith(
        'kill',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      )
    })

    test('fails fast with error in sandbox mode', async () => {
      // Simulate sandbox mode
      const originalEnv = process.env.SANDBOX_RUNTIME
      process.env.SANDBOX_RUNTIME = '1'

      try {
        const result = await runCli({
          argv: ['daemon', 'status'],
          stdout,
          stderr,
          cwd: projectDir,
          enableFileLogging: false,
        })

        expect(result.exitCode).toBe(1)
        expect(stdout.data).toContain('Daemon commands cannot run in sandbox mode')
        expect(stdout.data).toContain('dangerouslyDisableSandbox')
        // Handler should NOT be called
        expect(mockHandleDaemonCommand).not.toHaveBeenCalled()
      } finally {
        // Restore environment
        if (originalEnv === undefined) {
          delete process.env.SANDBOX_RUNTIME
        } else {
          process.env.SANDBOX_RUNTIME = originalEnv
        }
      }
    })

    test('allows --help in sandbox mode', async () => {
      // Simulate sandbox mode
      const originalEnv = process.env.SANDBOX_RUNTIME
      process.env.SANDBOX_RUNTIME = '1'

      try {
        mockHandleDaemonCommand.mockResolvedValue({ exitCode: 0 })

        const result = await runCli({
          argv: ['daemon', '--help'],
          stdout,
          stderr,
          cwd: projectDir,
          enableFileLogging: false,
        })

        expect(result.exitCode).toBe(0)
        // Handler should be called with --help
        expect(mockHandleDaemonCommand).toHaveBeenCalledWith(
          '--help',
          expect.any(String),
          expect.any(Object),
          expect.any(Object),
          expect.any(Object)
        )
      } finally {
        // Restore environment
        if (originalEnv === undefined) {
          delete process.env.SANDBOX_RUNTIME
        } else {
          process.env.SANDBOX_RUNTIME = originalEnv
        }
      }
    })
  })

  describe('statusline command', () => {
    test('returns success exit code on successful render', async () => {
      mockHandleStatuslineCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['statusline'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
    })

    test('returns handler exit code on error', async () => {
      mockHandleStatuslineCommand.mockResolvedValue({ exitCode: 1 })

      const result = await runCli({
        argv: ['statusline'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(1)
    })

    test('propagates handler exit code with options', async () => {
      mockHandleStatuslineCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['statusline', '--format', 'json', '--session-id', 'xyz789'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('ui command', () => {
    test('returns success exit code on successful command', async () => {
      mockHandleUiCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['ui'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
    })

    test('returns error exit code on failed command', async () => {
      mockHandleUiCommand.mockResolvedValue({ exitCode: 1 })

      const result = await runCli({
        argv: ['ui'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(1)
    })

    test('propagates handler exit code with options', async () => {
      mockHandleUiCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['ui', '--port', '8080', '--host', '0.0.0.0', '--no-open'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
    })
  })

  describe('unknown command', () => {
    test('returns error for unknown command', async () => {
      const result = await runCli({
        argv: ['unknown-command'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
        interactive: true,
      })

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('Unknown command: unknown-command')
      expect(stdout.data).toContain("Run 'sidekick help'")
    })
  })
})
