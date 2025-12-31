/**
 * Tests for CLI command routing in runCli().
 *
 * Covers the routing branches for 'supervisor' and 'statusline' commands
 * that delegate to their respective handlers.
 *
 * @see cli.ts lines 139-159
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

// Mock handlers - declared with vi.hoisted for use in vi.mock factory
const { mockHandleSupervisorCommand, mockHandleStatuslineCommand } = vi.hoisted(() => ({
  mockHandleSupervisorCommand: vi.fn(),
  mockHandleStatuslineCommand: vi.fn(),
}))

// Mock the command handler modules
vi.mock('../commands/supervisor.js', () => ({
  handleSupervisorCommand: mockHandleSupervisorCommand,
}))

vi.mock('../commands/statusline.js', () => ({
  handleStatuslineCommand: mockHandleStatuslineCommand,
  parseStatuslineInput: vi.fn(() => undefined),
}))

// Mock @sidekick/core to prevent actual supervisor operations
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    SupervisorClient: vi.fn(() => ({
      start: vi.fn().mockResolvedValue(undefined),
    })),
  }
})

describe('CLI command routing', () => {
  let projectDir: string
  let stdout: CollectingWritable
  let stderr: CollectingWritable

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'sidekick-cli-routing-'))
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start'), '#!/usr/bin/env bash')

    stdout = new CollectingWritable()
    stderr = new CollectingWritable()
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  describe('supervisor command', () => {
    test('routes to handleSupervisorCommand with default subcommand', async () => {
      mockHandleSupervisorCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['supervisor'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleSupervisorCommand).toHaveBeenCalledOnce()
      expect(mockHandleSupervisorCommand).toHaveBeenCalledWith(
        'status', // default subcommand
        expect.any(String), // projectRoot or cwd
        expect.any(Object), // logger
        stdout,
        { wait: false }
      )
      expect(result.exitCode).toBe(0)
    })

    test('routes to handleSupervisorCommand with explicit subcommand', async () => {
      mockHandleSupervisorCommand.mockResolvedValue({ exitCode: 0 })

      await runCli({
        argv: ['supervisor', 'start'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleSupervisorCommand).toHaveBeenCalledWith(
        'start',
        expect.any(String),
        expect.any(Object),
        stdout,
        { wait: false }
      )
    })

    test('passes --wait flag to handler', async () => {
      mockHandleSupervisorCommand.mockResolvedValue({ exitCode: 0 })

      await runCli({
        argv: ['supervisor', 'stop', '--wait'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleSupervisorCommand).toHaveBeenCalledWith('stop', expect.any(String), expect.any(Object), stdout, {
        wait: true,
      })
    })

    test('returns handler exit code', async () => {
      mockHandleSupervisorCommand.mockResolvedValue({ exitCode: 1 })

      const result = await runCli({
        argv: ['supervisor', 'invalid'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(1)
    })
  })

  describe('statusline command', () => {
    test('routes to handleStatuslineCommand with defaults', async () => {
      mockHandleStatuslineCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['statusline'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleStatuslineCommand).toHaveBeenCalledOnce()
      expect(mockHandleStatuslineCommand).toHaveBeenCalledWith(
        expect.any(String), // projectRoot or cwd
        expect.any(Object), // logger
        stdout,
        expect.objectContaining({ format: undefined, sessionId: undefined })
      )
      expect(result.exitCode).toBe(0)
    })

    test('passes --format option to handler', async () => {
      mockHandleStatuslineCommand.mockResolvedValue({ exitCode: 0 })

      await runCli({
        argv: ['statusline', '--format', 'json'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleStatuslineCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        stdout,
        expect.objectContaining({
          format: 'json',
          sessionId: undefined,
        })
      )
    })

    test('passes --session-id option to handler', async () => {
      mockHandleStatuslineCommand.mockResolvedValue({ exitCode: 0 })

      await runCli({
        argv: ['statusline', '--session-id', 'abc123'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleStatuslineCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        stdout,
        expect.objectContaining({
          format: undefined,
          sessionId: 'abc123',
        })
      )
    })

    test('passes all options to handler', async () => {
      mockHandleStatuslineCommand.mockResolvedValue({ exitCode: 0 })

      await runCli({
        argv: ['statusline', '--format', 'text', '--session-id', 'xyz789'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(mockHandleStatuslineCommand).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Object),
        stdout,
        expect.objectContaining({
          format: 'text',
          sessionId: 'xyz789',
        })
      )
    })

    test('returns handler exit code', async () => {
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
  })
})
