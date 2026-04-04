import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionLogWriter } from '../session-log-writer.js'

describe('SessionLogWriter', () => {
  let tempDir: string
  let writer: SessionLogWriter

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'session-log-test-'))
    writer = new SessionLogWriter({
      sessionsDir: join(tempDir, 'sessions'),
      maxHandles: 3,
      idleTimeoutMs: 60_000,
    })
  })

  afterEach(async () => {
    await writer.closeAll()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('writes NDJSON line to per-session log file', async () => {
    const ndjsonLine =
      JSON.stringify({ time: 1000, type: 'reminder:staged', context: { sessionId: 'sess-1' } }) + '\n'
    await writer.write('sess-1', 'sidekickd.log', ndjsonLine)

    const content = await readFile(join(tempDir, 'sessions', 'sess-1', 'logs', 'sidekickd.log'), 'utf-8')
    expect(content).toBe(ndjsonLine)
  })

  it('appends multiple lines to same session file', async () => {
    const line1 = JSON.stringify({ time: 1000, type: 'a' }) + '\n'
    const line2 = JSON.stringify({ time: 2000, type: 'b' }) + '\n'
    await writer.write('sess-1', 'sidekickd.log', line1)
    await writer.write('sess-1', 'sidekickd.log', line2)

    const content = await readFile(join(tempDir, 'sessions', 'sess-1', 'logs', 'sidekickd.log'), 'utf-8')
    expect(content).toBe(line1 + line2)
  })

  it('writes to separate files for different sessions', async () => {
    const line1 = JSON.stringify({ time: 1000, type: 'a' }) + '\n'
    const line2 = JSON.stringify({ time: 2000, type: 'b' }) + '\n'
    await writer.write('sess-1', 'sidekickd.log', line1)
    await writer.write('sess-2', 'sidekickd.log', line2)

    const content1 = await readFile(join(tempDir, 'sessions', 'sess-1', 'logs', 'sidekickd.log'), 'utf-8')
    const content2 = await readFile(join(tempDir, 'sessions', 'sess-2', 'logs', 'sidekickd.log'), 'utf-8')
    expect(content1).toBe(line1)
    expect(content2).toBe(line2)
  })

  it('evicts LRU handle when maxHandles exceeded', async () => {
    // Write to 4 sessions with maxHandles=3
    for (let i = 1; i <= 4; i++) {
      await writer.write(`sess-${i}`, 'sidekickd.log', `{"n":${i}}\n`)
    }

    // All 4 files should exist (eviction closes handle, doesn't delete file)
    for (let i = 1; i <= 4; i++) {
      const content = await readFile(join(tempDir, 'sessions', `sess-${i}`, 'logs', 'sidekickd.log'), 'utf-8')
      expect(content).toBe(`{"n":${i}}\n`)
    }

    // Handle count should be at maxHandles
    expect(writer.handleCount).toBeLessThanOrEqual(3)
  })

  it('creates session logs directory if it does not exist', async () => {
    await writer.write('new-sess', 'sidekickd.log', '{"test":true}\n')
    const content = await readFile(join(tempDir, 'sessions', 'new-sess', 'logs', 'sidekickd.log'), 'utf-8')
    expect(content).toBe('{"test":true}\n')
  })

  it('closeSession closes handle for specific session', async () => {
    await writer.write('sess-1', 'sidekickd.log', '{"a":1}\n')
    expect(writer.handleCount).toBe(1)

    await writer.closeSession('sess-1')
    expect(writer.handleCount).toBe(0)

    // Can still write after close (reopens handle)
    await writer.write('sess-1', 'sidekickd.log', '{"b":2}\n')
    const content = await readFile(join(tempDir, 'sessions', 'sess-1', 'logs', 'sidekickd.log'), 'utf-8')
    expect(content).toBe('{"a":1}\n{"b":2}\n')
  })

  it('skips write when sessionId is empty', async () => {
    await writer.write('', 'sidekickd.log', '{"skip":true}\n')
    expect(writer.handleCount).toBe(0)
  })

  it('auto-closes handle after idle timeout', async () => {
    vi.useFakeTimers()
    const shortWriter = new SessionLogWriter({
      sessionsDir: join(tempDir, 'sessions'),
      maxHandles: 3,
      idleTimeoutMs: 100,
    })

    try {
      await shortWriter.write('sess-idle', 'sidekickd.log', '{"idle":true}\n')
      expect(shortWriter.handleCount).toBe(1)

      // Advance time past the idle timeout
      await vi.advanceTimersByTimeAsync(200)

      expect(shortWriter.handleCount).toBe(0)
    } finally {
      await shortWriter.closeAll()
      vi.useRealTimers()
    }
  })

  it('writes to different log files within same session', async () => {
    await writer.write('sess-1', 'sidekickd.log', '{"src":"daemon"}\n')
    await writer.write('sess-1', 'cli.log', '{"src":"cli"}\n')

    const daemonContent = await readFile(
      join(tempDir, 'sessions', 'sess-1', 'logs', 'sidekickd.log'),
      'utf-8',
    )
    const cliContent = await readFile(join(tempDir, 'sessions', 'sess-1', 'logs', 'cli.log'), 'utf-8')
    expect(daemonContent).toBe('{"src":"daemon"}\n')
    expect(cliContent).toBe('{"src":"cli"}\n')
    expect(writer.handleCount).toBe(2)
  })

  it('uses default maxHandles and idleTimeoutMs when not specified', async () => {
    const defaultWriter = new SessionLogWriter({
      sessionsDir: join(tempDir, 'sessions-default'),
    })
    try {
      await defaultWriter.write('sess-1', 'sidekickd.log', '{"default":true}\n')
      expect(defaultWriter.handleCount).toBe(1)
    } finally {
      await defaultWriter.closeAll()
    }
  })

  it('closeSession is a no-op when session has no handles', async () => {
    // Should not throw when closing a session with no open handles
    await expect(writer.closeSession('nonexistent-session')).resolves.toBeUndefined()
    expect(writer.handleCount).toBe(0)
  })

  it('closeHandle is idempotent — second close is a no-op', async () => {
    await writer.write('sess-1', 'sidekickd.log', '{"a":1}\n')
    await writer.closeSession('sess-1')
    // Second close should not throw
    await expect(writer.closeSession('sess-1')).resolves.toBeUndefined()
    expect(writer.handleCount).toBe(0)
  })
})
