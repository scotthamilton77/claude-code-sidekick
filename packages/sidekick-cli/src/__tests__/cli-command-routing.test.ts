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
    test('returns success exit code on successful command', async () => {
      mockHandleSupervisorCommand.mockResolvedValue({ exitCode: 0 })

      const result = await runCli({
        argv: ['supervisor'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(0)
    })

    test('returns error exit code on failed command', async () => {
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

    test('propagates handler exit code for stop command', async () => {
      mockHandleSupervisorCommand.mockResolvedValue({ exitCode: 1 })

      const result = await runCli({
        argv: ['supervisor', 'stop', '--wait'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
      })

      expect(result.exitCode).toBe(1)
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

  describe('unknown command', () => {
    test('returns success and shows informational message in interactive mode', async () => {
      const result = await runCli({
        argv: ['unknown-command'],
        stdout,
        stderr,
        cwd: projectDir,
        enableFileLogging: false,
        interactive: true,
      })

      expect(result.exitCode).toBe(0)
      // Verify user-facing output (behavior), not internal structure
      expect(stdout.data).toContain('Sidekick CLI executed unknown-command')
    })
  })
})
