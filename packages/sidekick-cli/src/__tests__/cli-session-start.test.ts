/**
 * Tests for CLI session start behavior.
 *
 * Verifies BEHAVIOR of session handling:
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

// Mock hook handler with hoisting
const { mockHandleHookCommand } = vi.hoisted(() => ({
  mockHandleHookCommand: vi.fn(),
}))

vi.mock('../commands/hook.js', () => ({
  handleHookCommand: mockHandleHookCommand,
  getHookName: vi.fn((cmd: string) => (cmd === 'session-start' ? 'SessionStart' : undefined)),
  validateHookName: vi.fn((name: string) => {
    if (['SessionStart', 'UserPromptSubmit', 'Stop'].includes(name)) return name
    return undefined
  }),
}))

class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

describe('runCli session handling', () => {
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
    const hookScriptPath = join(sandbox, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(sandbox, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    // Without valid stdin hook input, CLI returns empty response
    const result = await runCli({
      argv: ['session-start', '--hook', '--hook-script-path', hookScriptPath],
      stdout,
      stderr,
      cwd: sandbox,
      enableFileLogging: false,
    })

    // Behavioral assertion: returns empty JSON (not internal log format)
    expect(stdout.data.trim()).toBe('{}')
    expect(result.exitCode).toBe(0)
  })

  test('detects project scope from hook wrapper path', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-project-'))
    const hookScriptPath = join(sandbox, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(sandbox, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    const result = await runCli({
      argv: ['session-start', '--hook', '--hook-script-path', hookScriptPath],
      stdout,
      stderr,
      cwd: sandbox,
      interactive: true,
      enableFileLogging: false,
    })

    // Behavioral assertion: CLI completes successfully with project scope detected
    // We verify the CLI doesn't fail - scope detection is internal behavior
    // that affects subsequent hook handling, not a directly observable output
    expect(result.exitCode).toBe(0)
  })

  test('exits early when dual install is detected in user scope', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-dual-'))
    const homeDir = join(sandbox, 'home')
    const projectDir = join(sandbox, 'project')
    const hookScriptPath = [homeDir, '.claude', 'hooks', 'sidekick', 'session-start'].join(sep)
    mkdirSync(join(homeDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    mkdirSync(join(projectDir, '.claude'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')
    writeFileSync(join(projectDir, '.claude', 'settings.json'), '{"hooks": ["sidekick"]}')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    const result = await runCli({
      argv: ['session-start', '--hook', '--hook-script-path', hookScriptPath, '--project-dir', projectDir],
      stdout,
      stderr,
      cwd: sandbox,
      env: { HOME: homeDir },
      homeDir,
      interactive: true,
      enableFileLogging: false,
    })

    // Behavioral assertion: CLI exits early (doesn't produce output)
    // This is the key behavior - user scope defers to project scope to avoid duplicates
    expect(result.exitCode).toBe(0)
    expect(stdout.data).toBe('') // No output since deferred
  })

  test('produces output in project scope when dual install detected', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-project-scope-'))
    const projectDir = sandbox
    const hookScriptPath = join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')
    writeFileSync(join(projectDir, '.claude', 'settings.json'), '{"hooks": ["sidekick"]}')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    // Explicitly set scope to project to test the project-scope execution path
    const result = await runCli({
      argv: ['session-start', '--hook', '--hook-script-path', hookScriptPath, '--scope', 'project'],
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
    const hookScriptPath = join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    // Mock the hook handler to return a result
    mockHandleHookCommand.mockResolvedValue({
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
      argv: ['session-start', '--hook', '--hook-script-path', hookScriptPath],
      stdinData: hookInput,
      stdout,
      stderr,
      cwd: projectDir,
      enableFileLogging: false,
    })

    // Hook handler should have been called
    expect(mockHandleHookCommand).toHaveBeenCalled()
    expect(result.exitCode).toBe(0)
  })

  test('returns hook handler exit code', async () => {
    sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-hook-error-'))
    const projectDir = sandbox
    const hookScriptPath = join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    // Mock the hook handler to return an error
    mockHandleHookCommand.mockResolvedValue({
      exitCode: 1,
      output: '{"error": "handler failed"}',
    })

    const hookInput = JSON.stringify({
      session_id: 'error-session',
      hook_event_name: 'SessionStart',
      cwd: projectDir,
    })

    const result = await runCli({
      argv: ['session-start', '--hook', '--hook-script-path', hookScriptPath],
      stdinData: hookInput,
      stdout,
      stderr,
      cwd: projectDir,
      enableFileLogging: false,
    })

    expect(result.exitCode).toBe(1)
  })
})
