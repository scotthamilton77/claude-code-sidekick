import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { SessionLogWriter } from '../session-log-writer.js'
import { logEvent, LogEvents, setSessionLogWriter } from '../log-events.js'
import type { Logger } from '@sidekick/types'

/** Poll a file until it has non-empty content, or throw after timeoutMs. */
async function waitForFileContent(filePath: string, timeoutMs = 500): Promise<string> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const content = await readFile(filePath, 'utf-8')
      if (content.trim().length > 0) return content
    } catch {
      // file not yet created
    }
    await new Promise((r) => setTimeout(r, 10))
  }
  throw new Error(`File ${filePath} did not have content within ${timeoutMs}ms`)
}

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
    const ndjsonLine = JSON.stringify({ time: 1000, type: 'reminder:staged', context: { sessionId: 'sess-1' } }) + '\n'
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

  it('rejects path traversal in sessionId', async () => {
    await writer.write('../etc', 'sidekickd.log', '{"traversal":true}\n')
    expect(writer.handleCount).toBe(0)
  })

  it('rejects path traversal in logFile', async () => {
    await writer.write('sess-1', '../../etc/passwd', '{"traversal":true}\n')
    expect(writer.handleCount).toBe(0)
  })

  it('rejects sessionId with slashes', async () => {
    await writer.write('foo/bar', 'sidekickd.log', '{"traversal":true}\n')
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

    const daemonContent = await readFile(join(tempDir, 'sessions', 'sess-1', 'logs', 'sidekickd.log'), 'utf-8')
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

  it('concurrent writes for same key create only one handle and persist both lines', async () => {
    const line1 = '{"seq":1}\n'
    const line2 = '{"seq":2}\n'

    // Simulate fire-and-forget usage (like logEvent does): kick off both writes
    // without awaiting, so they race on handle creation.
    const p1 = writer.write('sess-race', 'sidekickd.log', line1)
    const p2 = writer.write('sess-race', 'sidekickd.log', line2)
    await Promise.all([p1, p2])

    // Only one stream handle should exist for this key
    expect(writer.handleCount).toBe(1)

    // Both lines must be present in the file
    const content = await readFile(
      join(tempDir, 'sessions', 'sess-race', 'logs', 'sidekickd.log'),
      'utf-8'
    )
    expect(content).toContain(line1.trim())
    expect(content).toContain(line2.trim())
  })
})

describe('logEvent with SessionLogWriter', () => {
  let tempDir: string
  let writer: SessionLogWriter

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'logevent-test-'))
    writer = new SessionLogWriter({
      sessionsDir: join(tempDir, 'sessions'),
    })
    setSessionLogWriter(writer)
  })

  afterEach(async () => {
    setSessionLogWriter(null)
    await writer.closeAll()
    await rm(tempDir, { recursive: true, force: true })
  })

  it('logEvent writes to per-session file when writer is set', async () => {
    const fakeLogger: Logger = {
      trace: vi.fn() as any,
      debug: vi.fn() as any,
      info: vi.fn() as any,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      child: () => fakeLogger,
      flush: () => Promise.resolve(),
    }

    const event = LogEvents.hookReceived(
      { sessionId: 'test-session', hook: 'UserPromptSubmit' },
      { cwd: '/tmp', mode: 'hook' }
    )
    logEvent(fakeLogger, event)

    const content = await waitForFileContent(join(tempDir, 'sessions', 'test-session', 'logs', 'sidekick.log'))
    const parsed = JSON.parse(content.trim())
    expect(parsed.type).toBe('hook:received')
    expect(parsed.context.sessionId).toBe('test-session')
  })

  it('logEvent routes daemon events to sidekickd.log', async () => {
    const fakeLogger: Logger = {
      trace: vi.fn() as any,
      debug: vi.fn() as any,
      info: vi.fn() as any,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      child: () => fakeLogger,
      flush: () => Promise.resolve(),
    }

    const event = LogEvents.reminderStaged(
      { sessionId: 'test-session', hook: 'PostToolUse' },
      { reminderName: 'vc-build', hookName: 'PostToolUse', blocking: true, priority: 10, persistent: false }
    )
    logEvent(fakeLogger, event)

    const content = await waitForFileContent(join(tempDir, 'sessions', 'test-session', 'logs', 'sidekickd.log'))
    const parsed = JSON.parse(content.trim())
    expect(parsed.type).toBe('reminder:staged')
    expect(parsed.source).toBe('daemon')
  })

  it('logEvent skips per-session write when sessionId is empty', async () => {
    const fakeLogger: Logger = {
      trace: vi.fn() as any,
      debug: vi.fn() as any,
      info: vi.fn() as any,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      child: () => fakeLogger,
      flush: () => Promise.resolve(),
    }

    const event = LogEvents.daemonStarting({ projectDir: '/tmp', pid: 123 })
    logEvent(fakeLogger, event)

    // Small wait — we're checking absence, not presence; 50ms is fine here
    await new Promise((r) => setTimeout(r, 50))

    // Writer should not have opened any handles (sessionId is '')
    expect(writer.handleCount).toBe(0)
  })

  it('logEvent still calls logger.info even when writer is set', () => {
    const infoFn = vi.fn() as any
    const fakeLogger: Logger = {
      trace: vi.fn() as any,
      debug: vi.fn() as any,
      info: infoFn,
      warn: vi.fn() as any,
      error: vi.fn() as any,
      fatal: vi.fn() as any,
      child: () => fakeLogger,
      flush: () => Promise.resolve(),
    }

    const event = LogEvents.hookReceived(
      { sessionId: 'test-session', hook: 'UserPromptSubmit' },
      { cwd: '/tmp', mode: 'hook' }
    )
    logEvent(fakeLogger, event)

    // logger.info should still be called (aggregate log path unchanged)
    expect(infoFn).toHaveBeenCalledOnce()
  })
})
