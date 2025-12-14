import { Writable } from 'node:stream'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, test } from 'vitest'

import { runCli } from '../cli'

class CollectingWritable extends Writable {
  data = ''

  _write(chunk: Buffer, _encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
    this.data += chunk.toString()
    callback()
  }
}

describe('runCli', () => {
  test('returns empty response when hook input missing', async () => {
    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    // Without valid stdin hook input, CLI returns empty response (graceful degradation)
    await runCli({
      argv: ['session-start', '--hook', '--hook-script-path', '/tmp/project/.claude/hooks/sidekick/session-start'],
      stdout,
      stderr,
    })

    // Per Phase 8: Without hook input, returns empty JSON response
    expect(stdout.data.trim()).toBe('{}')
  })

  test('detects project scope from hook wrapper path', async () => {
    const projectDir = mkdtempSync(join(tmpdir(), 'sidekick-cli-project-'))
    const hookScriptPath = join(projectDir, '.claude', 'hooks', 'sidekick', 'session-start')
    mkdirSync(join(projectDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    await runCli({
      argv: ['session-start', '--hook', '--hook-script-path', hookScriptPath],
      stdout,
      stderr,
      cwd: projectDir,
      interactive: true,
      enableFileLogging: false,
    })

    // Now using structured JSON logs
    expect(stderr.data).toContain('Runtime bootstrap complete')
    expect(stderr.data).toContain('"scope":"project"')
  })

  test('exits early when dual install detected in user scope', async () => {
    const sandbox = mkdtempSync(join(tmpdir(), 'sidekick-cli-dual-'))
    const homeDir = join(sandbox, 'home')
    const projectDir = join(sandbox, 'project')
    const hookScriptPath = [homeDir, '.claude', 'hooks', 'sidekick', 'session-start'].join(sep)
    mkdirSync(join(homeDir, '.claude', 'hooks', 'sidekick'), { recursive: true })
    mkdirSync(join(projectDir, '.claude'), { recursive: true })
    writeFileSync(hookScriptPath, '#!/usr/bin/env bash')
    writeFileSync(join(projectDir, '.claude', 'settings.json'), '{"hooks": ["sidekick"]}')

    const stdout = new CollectingWritable()
    const stderr = new CollectingWritable()

    await runCli({
      argv: ['session-start', '--hook', '--hook-script-path', hookScriptPath, '--project-dir', projectDir],
      stdout,
      stderr,
      cwd: sandbox,
      env: { HOME: homeDir },
      homeDir,
      interactive: true,
      enableFileLogging: false,
    })

    // Now using structured JSON logs
    expect(stderr.data).toContain('Deferring to project scope')

    rmSync(sandbox, { recursive: true, force: true })
  })
})
