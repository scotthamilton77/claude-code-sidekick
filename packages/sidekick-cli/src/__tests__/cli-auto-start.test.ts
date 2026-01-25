/**
 * Tests for daemon auto-start behavior in CLI.
 *
 * Tests that:
 * - Daemon auto-starts in hook mode
 * - Auto-start failure doesn't crash CLI (graceful degradation)
 * - Interactive mode doesn't auto-start daemon
 *
 * @see docs/design/CLI.md §7 Daemon Lifecycle Management
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

// Mock DaemonClient
const mockStart = vi.fn()
const mockDaemonClient = { start: mockStart }

// Mock @sidekick/core module
vi.mock('@sidekick/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sidekick/core')>()
  return {
    ...actual,
    DaemonClient: vi.fn(() => mockDaemonClient),
  }
})

describe('CLI daemon auto-start', () => {
  let projectDir: string
  let stdout: CollectingWritable
  let stderr: CollectingWritable

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'sidekick-auto-start-'))
    const hookScriptPath = join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')

    stdout = new CollectingWritable()
    stderr = new CollectingWritable()
    vi.clearAllMocks()
  })

  afterEach(() => {
    rmSync(projectDir, { recursive: true, force: true })
    vi.clearAllMocks()
  })

  test('auto-starts daemon in hook mode', async () => {
    mockStart.mockResolvedValue(undefined)

    await runCli({
      argv: ['session-start', '--hook', '--project-dir', projectDir],
      stdout,
      stderr,
      cwd: projectDir,
      interactive: false,
      enableFileLogging: false,
    })

    // Daemon should be started
    expect(mockStart).toHaveBeenCalledOnce()
  })

  test('does not auto-start daemon in interactive mode', async () => {
    mockStart.mockResolvedValue(undefined)

    await runCli({
      argv: ['session-start', '--project-dir', projectDir],
      stdout,
      stderr,
      cwd: projectDir,
      interactive: true,
      enableFileLogging: false,
    })

    // Daemon should NOT be started (no --hook flag)
    expect(mockStart).not.toHaveBeenCalled()
  })

  test('gracefully handles auto-start failure', async () => {
    // Simulate startup failure
    mockStart.mockRejectedValue(new Error('Daemon failed to start within timeout'))

    const result = await runCli({
      argv: ['session-start', '--hook', '--project-dir', projectDir],
      stdout,
      stderr,
      cwd: projectDir,
      interactive: false,
      enableFileLogging: false,
    })

    // Daemon start should have been attempted
    expect(mockStart).toHaveBeenCalledOnce()

    // CLI should not crash - exit code should be 0
    expect(result.exitCode).toBe(0)
  })

  test('fails fast when no project-dir provided in hook mode', async () => {
    mockStart.mockResolvedValue(undefined)

    // Hook mode without --project-dir should fail fast
    await expect(
      runCli({
        argv: ['session-start', '--hook'],
        stdout,
        stderr,
        cwd: '/tmp',
        interactive: false,
        enableFileLogging: false,
      })
    ).rejects.toThrow('Hook mode requires --project-dir parameter')

    // Daemon should NOT be started (error thrown before reaching that point)
    expect(mockStart).not.toHaveBeenCalled()
  })
})
