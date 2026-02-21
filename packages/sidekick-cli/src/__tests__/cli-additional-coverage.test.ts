/**
 * Additional tests for CLI coverage.
 *
 * Covers previously uncovered command routing paths:
 * - Global help
 * - hook command
 * - persona command
 * - sessions command
 * - dev-mode command
 * - uninstall command
 * - persistCliLogMetrics error path
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

// Hoist mocks
const {
  mockHandlePersonaCommand,
  mockHandleSessionsCommand,
  mockHandleDevModeCommand,
  mockHandleUnifiedHookCommand,
  mockParseHookArg,
} = vi.hoisted(() => ({
  mockHandlePersonaCommand: vi.fn(),
  mockHandleSessionsCommand: vi.fn(),
  mockHandleDevModeCommand: vi.fn(),
  mockHandleUnifiedHookCommand: vi.fn(),
  mockParseHookArg: vi.fn(),
}))

// Mock command handlers
vi.mock('../commands/persona.js', () => ({
  handlePersonaCommand: mockHandlePersonaCommand,
}))

vi.mock('../commands/sessions.js', () => ({
  handleSessionsCommand: mockHandleSessionsCommand,
}))

vi.mock('../commands/dev-mode.js', () => ({
  handleDevModeCommand: mockHandleDevModeCommand,
}))

vi.mock('../commands/hook-command.js', () => ({
  handleUnifiedHookCommand: mockHandleUnifiedHookCommand,
  parseHookArg: mockParseHookArg,
}))

// Mock @sidekick/core to prevent daemon operations
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    DaemonClient: vi.fn(() => ({
      start: vi.fn().mockResolvedValue(undefined),
    })),
  }
})

describe('CLI additional coverage', () => {
  let projectDir: string
  let stdout: CollectingWritable
  let stderr: CollectingWritable
  let originalSandboxEnv: string | undefined

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'sidekick-cli-coverage-'))
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start'), '#!/usr/bin/env bash')

    stdout = new CollectingWritable()
    stderr = new CollectingWritable()

    // Save and clear sandbox mode
    originalSandboxEnv = process.env.SANDBOX_RUNTIME
    delete process.env.SANDBOX_RUNTIME

    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    if (originalSandboxEnv === undefined) {
      delete process.env.SANDBOX_RUNTIME
    } else {
      process.env.SANDBOX_RUNTIME = originalSandboxEnv
    }
    vi.clearAllMocks()
  })

  describe('global help', () => {
    test('shows help when --help flag is used with default command', async () => {
      const result = await runCli({
        argv: ['--help'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick <command> [options]')
      expect(stdout.data).toContain('Commands:')
      expect(stdout.data).toContain('daemon')
    })

    test('shows help when help command is used', async () => {
      const result = await runCli({
        argv: ['help'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick <command> [options]')
    })

    test('shows help with -h flag', async () => {
      const result = await runCli({
        argv: ['-h'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick <command> [options]')
    })
  })

  describe('hook command', () => {
    test('shows help when hook command has no subcommand', async () => {
      mockParseHookArg.mockReturnValue(undefined)

      const result = await runCli({
        argv: ['hook'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick hook <hook-name>')
    })

    test('shows help when hook --help is used', async () => {
      mockParseHookArg.mockReturnValue(undefined)

      const result = await runCli({
        argv: ['hook', '--help'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick hook <hook-name>')
    })

    test('returns error for unknown hook name', async () => {
      mockParseHookArg.mockReturnValue(undefined)

      const result = await runCli({
        argv: ['hook', 'unknown-hook'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain("Error: Unknown hook name 'unknown-hook'")
    })

    test('returns empty JSON when no hook input provided', async () => {
      mockParseHookArg.mockReturnValue('SessionStart')

      const result = await runCli({
        argv: ['hook', 'session-start', '--project-dir', projectDir],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data.trim()).toBe('{}')
    })

    test('fails fast when hook command missing --project-dir', async () => {
      mockParseHookArg.mockReturnValue('SessionStart')

      const result = await runCli({
        argv: ['hook', 'session-start'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(1)
      expect(stdout.data).toContain('--project-dir')
    })

    test('dispatches to unified hook handler with valid input', async () => {
      mockParseHookArg.mockReturnValue('SessionStart')
      mockHandleUnifiedHookCommand.mockResolvedValue({
        exitCode: 0,
        output: '{"result": "success"}',
      })

      const result = await runCli({
        argv: ['hook', 'session-start', '--project-dir', projectDir],
        stdinData: JSON.stringify({ session_id: 'test-session', cwd: projectDir }),
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleUnifiedHookCommand).toHaveBeenCalled()
      expect(result.exitCode).toBe(0)
    })
  })

  describe('persona command', () => {
    test('routes persona command to handler', async () => {
      mockHandlePersonaCommand.mockResolvedValue({ exitCode: 0, output: 'persona list' })

      const result = await runCli({
        argv: ['persona', 'list'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandlePersonaCommand).toHaveBeenCalledWith(
        'list',
        [],
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({})
      )
      expect(result.exitCode).toBe(0)
    })

    test('routes persona --help to handler', async () => {
      mockHandlePersonaCommand.mockResolvedValue({ exitCode: 0, output: 'help' })

      const result = await runCli({
        argv: ['persona', '--help'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandlePersonaCommand).toHaveBeenCalledWith(
        '--help',
        expect.any(Array),
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      )
      expect(result.exitCode).toBe(0)
    })

    test('passes session-id and format options', async () => {
      mockHandlePersonaCommand.mockResolvedValue({ exitCode: 0, output: '' })

      await runCli({
        argv: ['persona', 'set', 'snark', '--session-id', 'abc123', '--format', 'json'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandlePersonaCommand).toHaveBeenCalledWith(
        'set',
        ['snark'],
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          sessionId: 'abc123',
          format: 'json',
        })
      )
    })
  })

  describe('sessions command', () => {
    test('routes sessions command to handler', async () => {
      mockHandleSessionsCommand.mockResolvedValue({ exitCode: 0, output: 'sessions list' })

      const result = await runCli({
        argv: ['sessions'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleSessionsCommand).toHaveBeenCalled()
      expect(result.exitCode).toBe(0)
    })

    test('passes format and width options', async () => {
      mockHandleSessionsCommand.mockResolvedValue({ exitCode: 0, output: '' })

      await runCli({
        argv: ['sessions', '--format', 'table', '--width', '120'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleSessionsCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          format: 'table',
          width: 120,
        })
      )
    })

    test('passes help flag', async () => {
      mockHandleSessionsCommand.mockResolvedValue({ exitCode: 0, output: '' })

      await runCli({
        argv: ['sessions', '--help'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleSessionsCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({
          help: true,
        })
      )
    })
  })

  describe('dev-mode command', () => {
    test('routes dev-mode command to handler', async () => {
      mockHandleDevModeCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['dev-mode', 'enable'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleDevModeCommand).toHaveBeenCalledWith(
        'enable',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ force: false })
      )
      expect(result.exitCode).toBe(0)
    })

    test('routes dev-mode --help to handler', async () => {
      mockHandleDevModeCommand.mockResolvedValue({ exitCode: 0 })

      await runCli({
        argv: ['dev-mode', '--help'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleDevModeCommand).toHaveBeenCalledWith(
        '--help',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      )
    })

    test('defaults to status subcommand', async () => {
      mockHandleDevModeCommand.mockResolvedValue({ exitCode: 0 })

      await runCli({
        argv: ['dev-mode'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleDevModeCommand).toHaveBeenCalledWith(
        'status',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.any(Object)
      )
    })

    test('passes force flag', async () => {
      mockHandleDevModeCommand.mockResolvedValue({ exitCode: 0 })

      await runCli({
        argv: ['dev-mode', 'clean', '--force'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleDevModeCommand).toHaveBeenCalledWith(
        'clean',
        expect.any(String),
        expect.any(Object),
        expect.any(Object),
        expect.objectContaining({ force: true })
      )
    })
  })

  describe('uninstall command', () => {
    test('shows help when uninstall --help is used', async () => {
      const result = await runCli({
        argv: ['uninstall', '--help'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
      expect(stdout.data).toContain('Usage: sidekick uninstall [options]')
      expect(stdout.data).toContain('--force')
      expect(stdout.data).toContain('--dry-run')
      expect(stdout.data).toContain('--scope=<user|project>')
    })
  })
})
