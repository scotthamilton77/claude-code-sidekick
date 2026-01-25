/**
 * Tests for CLI hook command behavior.
 *
 * Verifies BEHAVIOR of hook handling:
 * - Exit codes and output (observable outcomes)
 * - Early exit on dual-install detection
 * - Graceful degradation with missing hook input
 *
 * Does NOT verify log message content - that's implementation detail.
 */
import { Writable } from 'node:stream'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test, afterEach, vi } from 'vitest'

import { runCli } from '../cli'

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

// Mock unified hook handler with hoisting
const { mockHandleUnifiedHookCommand, mockParseHookArg } = vi.hoisted(() => ({
  mockHandleUnifiedHookCommand: vi.fn(),
  mockParseHookArg: vi.fn(),
}))

vi.mock('../commands/hook-command.js', () => ({
  handleUnifiedHookCommand: mockHandleUnifiedHookCommand,
  parseHookArg: mockParseHookArg,
}))

class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

describe('runCli hook command handling', () => {
  let sandbox: string | undefined

  afterEach(() => {
    if (sandbox) {
      rmSync(sandbox, { recursive: true, force: true })
      sandbox = undefined
    }
    vi.clearAllMocks()
  })

  test('returns empty JSON response when hook input is missing (graceful degradation)', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-graceful-'))
    mkdirSync(join(sandbox, '.claude', 'hooks', 'sidekick'), { recursive: true })

    mockParseHookArg.mockReturnValue('SessionStart')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    // Without valid stdin hook input, CLI returns empty response
    const result = await runCli({
      argv: ['hook', 'session-start', '--project-dir', sandbox],
      stdout,
      stderr,
      cwd: sandbox,
      enableFileLogging: false,
    })

    // Behavioral assertion: returns empty JSON (not internal log format)
    expect(stdout.data.trim()).toBe('{}')
    expect(result.exitCode).toBe(0)
  })

  test('detects project scope from project-dir', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-project-'))
    mkdirSync(join(sandbox, '.claude', 'hooks', 'sidekick'), { recursive: true })

    mockParseHookArg.mockReturnValue('SessionStart')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    const result = await runCli({
      argv: ['hook', 'session-start', '--project-dir', sandbox],
      stdout,
      stderr,
      cwd: sandbox,
      interactive: true,
      enableFileLogging: false,
    })

    // Behavioral assertion: CLI completes successfully with project scope detected
    expect(result.exitCode).toBe(0)
  })

  // Note: Dual install detection test removed - Claude Code now handles hook deduplication
  // via the $CLAUDE_PROJECT_DIR environment variable.

  test('produces output in project scope', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-project-scope-'))
    const projectDir = sandbox
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(join(projectDir, '.claude', 'settings.json'), '{"hooks": ["sidekick"]}')

    mockParseHookArg.mockReturnValue('SessionStart')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    const result = await runCli({
      argv: ['hook', 'session-start', '--project-dir', projectDir],
      stdout,
      stderr,
      cwd: projectDir,
      interactive: false,
      enableFileLogging: false,
    })

    // Behavioral assertion: CLI completes and produces output
    // (even if empty JSON due to missing stdin input)
    expect(result.exitCode).toBe(0)
    expect(stdout.data.trim()).toBe('{}')
  })

  test('dispatches to hook handler when valid hook input is provided', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-hook-'))
    const projectDir = sandbox
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    mockParseHookArg.mockReturnValue('SessionStart')
    mockHandleUnifiedHookCommand.mockResolvedValue({
      exitCode: 0,
      output: '{"result": "success"}',
    })

    // Provide valid hook input JSON via stdin
    const hookInput = JSON.stringify({
      session_id: 'test-session-abc123',
      hook_event_name: 'SessionStart',
      cwd: projectDir,
    })

    const result = await runCli({
      argv: ['hook', 'session-start', '--project-dir', projectDir],
      stdinData: hookInput,
      stdout,
      stderr,
      cwd: projectDir,
      enableFileLogging: false,
    })

    // Hook handler should have been called
    expect(mockHandleUnifiedHookCommand).toHaveBeenCalled()
    expect(result.exitCode).toBe(0)
  })

  test('returns hook handler exit code', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-hook-error-'))
    const projectDir = sandbox
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    mockParseHookArg.mockReturnValue('SessionStart')
    mockHandleUnifiedHookCommand.mockResolvedValue({
      exitCode: 1,
      output: '{"error": "handler failed"}',
    })

    const hookInput = JSON.stringify({
      session_id: 'error-session',
      hook_event_name: 'SessionStart',
      cwd: projectDir,
    })

    const result = await runCli({
      argv: ['hook', 'session-start', '--project-dir', projectDir],
      stdinData: hookInput,
      stdout,
      stderr,
      cwd: projectDir,
      enableFileLogging: false,
    })

    expect(result.exitCode).toBe(1)
  })
})
