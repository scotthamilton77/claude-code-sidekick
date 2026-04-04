# Per-Session Logging Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route log events to per-session files (`.sidekick/sessions/{sessionId}/logs/`) as the source of truth, demote aggregate logs to an ephemeral debug window, and update the timeline API to read per-session files with fallback.

**Architecture:** A new `SessionLogWriter` class in `@sidekick/core` manages per-session file handles with LRU eviction. Both daemon and CLI call `logEvent()` which already has `context.sessionId` — the writer intercepts events at write time. The timeline API reads per-session files first, falling back to aggregate scan for pre-migration sessions.

**Tech Stack:** TypeScript, Node.js `fs/promises`, Pino NDJSON format, Vitest

**Design spec:** `docs/plans/2026-04-03-per-session-logging-design.md`

---

## File Map

| Action | File | Responsibility |
|--------|------|---------------|
| Create | `packages/sidekick-core/src/session-log-writer.ts` | SessionLogWriter class — manages per-session file handles, LRU eviction, NDJSON append |
| Create | `packages/sidekick-core/src/__tests__/session-log-writer.test.ts` | Unit tests for SessionLogWriter |
| Modify | `packages/sidekick-core/src/state/path-resolver.ts:54-56` | Add `sessionLogsDir(sessionId)` method |
| Modify | `packages/sidekick-core/src/structured-logging.ts:49` | Re-export SessionLogWriter |
| Modify | `packages/sidekick-core/src/log-events.ts:604-613` | Update `logEvent()` to also write to SessionLogWriter when available |
| Modify | `packages/sidekick-daemon/src/daemon.ts:147-160` | Initialize SessionLogWriter, reduce aggregate rotation, wire to logEvent |
| Modify | `packages/sidekick-cli/src/runtime.ts:150-158` | Reduce aggregate rotation config |
| Modify | `packages/sidekick-ui/server/timeline-api.ts:253-296` | Read per-session logs first, fall back to aggregate |
| Modify | `packages/sidekick-ui/server/__tests__/timeline-api.test.ts` | Add tests for per-session read path and fallback |

---

### Task 1: Add `sessionLogsDir()` to PathResolver

**Files:**
- Modify: `packages/sidekick-core/src/state/path-resolver.ts:54-56`
- Test: `packages/sidekick-core/src/__tests__/path-resolver.test.ts` (create if needed)

- [ ] **Step 1: Write the failing test**

Check if a path-resolver test file exists. If not, create it:

```typescript
import { describe, it, expect } from 'vitest'
import { PathResolver } from '../state/path-resolver.js'

describe('PathResolver', () => {
  const resolver = new PathResolver('/projects/myapp')

  it('sessionLogsDir returns correct path for a session', () => {
    expect(resolver.sessionLogsDir('abc-123')).toBe(
      '/projects/myapp/.sidekick/sessions/abc-123/logs'
    )
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/path-resolver.test.ts`
Expected: FAIL — `sessionLogsDir is not a function`

- [ ] **Step 3: Add sessionLogsDir method**

In `packages/sidekick-core/src/state/path-resolver.ts`, add after the existing `sessionStagingDir` method (line ~48):

```typescript
  sessionLogsDir(sessionId: string): string {
    return join(this.sessionRootDir(sessionId), 'logs')
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/path-resolver.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-core/src/state/path-resolver.ts packages/sidekick-core/src/__tests__/path-resolver.test.ts
git commit -m "feat(core): add sessionLogsDir to PathResolver"
```

---

### Task 2: Create SessionLogWriter

**Files:**
- Create: `packages/sidekick-core/src/session-log-writer.ts`
- Create: `packages/sidekick-core/src/__tests__/session-log-writer.test.ts`

This is the core new component. It manages per-session file handles with LRU eviction.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

// Import after creating the file in step 3
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
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/session-log-writer.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement SessionLogWriter**

Create `packages/sidekick-core/src/session-log-writer.ts`:

```typescript
/**
 * SessionLogWriter — manages per-session log file handles with LRU eviction.
 *
 * Writes NDJSON lines to .sidekick/sessions/{sessionId}/logs/{logFile}.
 * File handles are lazy-opened and evicted when maxHandles is exceeded.
 *
 * @see docs/plans/2026-04-03-per-session-logging-design.md
 */

import { appendFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createWriteStream, type WriteStream } from 'node:fs'

export interface SessionLogWriterOptions {
  /** Base sessions directory (e.g., .sidekick/sessions) */
  sessionsDir: string
  /** Max concurrent file handles before LRU eviction (default: 10) */
  maxHandles?: number
  /** Idle timeout in ms before auto-closing a handle (default: 30 min) */
  idleTimeoutMs?: number
}

interface HandleEntry {
  stream: WriteStream
  lastUsed: number
  timer: ReturnType<typeof setTimeout> | null
  ready: Promise<void>
}

export class SessionLogWriter {
  private readonly sessionsDir: string
  private readonly maxHandles: number
  private readonly idleTimeoutMs: number
  /** Map key: `${sessionId}/${logFile}` */
  private readonly handles = new Map<string, HandleEntry>()

  constructor(options: SessionLogWriterOptions) {
    this.sessionsDir = options.sessionsDir
    this.maxHandles = options.maxHandles ?? 10
    this.idleTimeoutMs = options.idleTimeoutMs ?? 30 * 60 * 1000
  }

  get handleCount(): number {
    return this.handles.size
  }

  /**
   * Write an NDJSON line to a per-session log file.
   * Creates the directory and file handle lazily.
   * Skips if sessionId is empty (daemon lifecycle events before session exists).
   */
  async write(sessionId: string, logFile: string, line: string): Promise<void> {
    if (!sessionId) return

    const key = `${sessionId}/${logFile}`
    let entry = this.handles.get(key)

    if (!entry) {
      // Evict LRU if at capacity
      if (this.handles.size >= this.maxHandles) {
        this.evictLRU()
      }

      const logDir = join(this.sessionsDir, sessionId, 'logs')
      await mkdir(logDir, { recursive: true })

      const filePath = join(logDir, logFile)
      const stream = createWriteStream(filePath, { flags: 'a' })

      const ready = new Promise<void>((resolve, reject) => {
        stream.once('open', () => resolve())
        stream.once('error', (err) => reject(err))
      })

      entry = {
        stream,
        lastUsed: Date.now(),
        timer: null,
        ready,
      }
      this.handles.set(key, entry)
    }

    // Wait for stream to be ready
    await entry.ready

    // Update LRU timestamp and reset idle timer
    entry.lastUsed = Date.now()
    this.resetIdleTimer(key, entry)

    // Write the line
    return new Promise<void>((resolve, reject) => {
      const ok = entry.stream.write(line, (err) => {
        if (err) reject(err)
        else resolve()
      })
      if (!ok) {
        entry.stream.once('drain', () => resolve())
      }
    })
  }

  /** Close all handles for a specific session. */
  async closeSession(sessionId: string): Promise<void> {
    const prefix = `${sessionId}/`
    const toClose: string[] = []
    for (const key of this.handles.keys()) {
      if (key.startsWith(prefix)) {
        toClose.push(key)
      }
    }
    await Promise.all(toClose.map((key) => this.closeHandle(key)))
  }

  /** Close all open handles. */
  async closeAll(): Promise<void> {
    const keys = [...this.handles.keys()]
    await Promise.all(keys.map((key) => this.closeHandle(key)))
  }

  private async closeHandle(key: string): Promise<void> {
    const entry = this.handles.get(key)
    if (!entry) return

    if (entry.timer) clearTimeout(entry.timer)
    this.handles.delete(key)

    return new Promise<void>((resolve) => {
      entry.stream.end(() => resolve())
    })
  }

  private evictLRU(): void {
    let oldestKey: string | null = null
    let oldestTime = Infinity

    for (const [key, entry] of this.handles) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed
        oldestKey = key
      }
    }

    if (oldestKey) {
      // Fire and forget — eviction is best-effort
      void this.closeHandle(oldestKey)
    }
  }

  private resetIdleTimer(key: string, entry: HandleEntry): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      void this.closeHandle(key)
    }, this.idleTimeoutMs)
    // Don't keep the process alive for idle timers
    if (entry.timer && typeof entry.timer === 'object' && 'unref' in entry.timer) {
      entry.timer.unref()
    }
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/session-log-writer.test.ts`
Expected: PASS (all 7 tests)

- [ ] **Step 5: Export from structured-logging.ts**

In `packages/sidekick-core/src/structured-logging.ts`, add to the re-exports near line 49:

```typescript
export { SessionLogWriter, type SessionLogWriterOptions } from './session-log-writer'
```

Also add to the package's main index (check `packages/sidekick-core/src/index.ts`).

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-core/src/session-log-writer.ts packages/sidekick-core/src/__tests__/session-log-writer.test.ts packages/sidekick-core/src/structured-logging.ts packages/sidekick-core/src/index.ts
git commit -m "feat(core): add SessionLogWriter for per-session log files"
```

---

### Task 3: Wire `logEvent()` to SessionLogWriter

**Files:**
- Modify: `packages/sidekick-core/src/log-events.ts:604-613`
- Modify: `packages/sidekick-core/src/__tests__/session-log-writer.test.ts` (add integration test)

The `logEvent()` function is the single chokepoint through which all structured events pass. We add an optional `SessionLogWriter` binding so events are dual-written.

- [ ] **Step 1: Write the failing test**

Add to `session-log-writer.test.ts`:

```typescript
import { logEvent, LogEvents, setSessionLogWriter } from '../log-events.js'
import type { Logger } from '@sidekick/types'

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
    const logged: Array<{ msg: string; meta?: Record<string, unknown> }> = []
    const fakeLogger: Logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: (msg, meta) => { logged.push({ msg, meta }) },
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: () => fakeLogger,
      flush: () => Promise.resolve(),
    }

    const event = LogEvents.hookReceived(
      { sessionId: 'test-session', hook: 'UserPromptSubmit' },
      { cwd: '/tmp', mode: 'hook' }
    )
    logEvent(fakeLogger, event)

    // Give async write time to complete
    await new Promise((r) => setTimeout(r, 50))

    const content = await readFile(
      join(tempDir, 'sessions', 'test-session', 'logs', 'sidekick.log'),
      'utf-8'
    )
    const parsed = JSON.parse(content.trim())
    expect(parsed.type).toBe('hook:received')
    expect(parsed.context.sessionId).toBe('test-session')
  })

  it('logEvent skips per-session write when sessionId is empty', async () => {
    const fakeLogger: Logger = {
      trace: vi.fn(),
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
      child: () => fakeLogger,
      flush: () => Promise.resolve(),
    }

    const event = LogEvents.daemonStarting({ projectDir: '/tmp', pid: 123 })
    logEvent(fakeLogger, event)

    // Writer should not have opened any handles (sessionId is '')
    expect(writer.handleCount).toBe(0)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/session-log-writer.test.ts`
Expected: FAIL — `setSessionLogWriter is not exported`

- [ ] **Step 3: Modify logEvent() to support SessionLogWriter**

In `packages/sidekick-core/src/log-events.ts`, add at the top of the file (after imports):

```typescript
import type { SessionLogWriter } from './session-log-writer'

/** Module-level reference to the session log writer. Set by daemon/CLI during init. */
let sessionLogWriter: SessionLogWriter | null = null

/**
 * Set the SessionLogWriter instance for per-session log routing.
 * Call with null to disable.
 */
export function setSessionLogWriter(writer: SessionLogWriter | null): void {
  sessionLogWriter = writer
}
```

Modify the existing `logEvent()` function at line 604:

```typescript
export function logEvent(logger: Logger, event: LoggingEventBase): void {
  const payload = event.payload
  const meta = payload != null && typeof payload === 'object' ? (payload as Record<string, unknown>) : {}
  const reason = 'reason' in meta ? String(meta.reason) : undefined
  logger.info(reason ?? `${event.type}`, {
    type: event.type,
    source: event.source,
    ...meta,
  })

  // Write to per-session log file (fire-and-forget)
  if (sessionLogWriter && event.context.sessionId) {
    // cli → sidekick.log, daemon/transcript → sidekickd.log
    const logFile = event.source === 'cli' ? 'sidekick.log' : 'sidekickd.log'
    const line = JSON.stringify({
      time: event.time,
      type: event.type,
      source: event.source,
      context: event.context,
      ...meta,
    }) + '\n'
    sessionLogWriter.write(event.context.sessionId, logFile, line).catch(() => {
      // Silently ignore per-session write failures — aggregate log is the fallback
    })
  }
}
```

- [ ] **Step 4: Update re-exports**

In `packages/sidekick-core/src/structured-logging.ts` line 49, update the re-export:

```typescript
export { LogEvents, logEvent, setSessionLogWriter, type EventLogContext } from './log-events'
```

And in `packages/sidekick-core/src/index.ts`, ensure `setSessionLogWriter` is exported.

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm --filter @sidekick/core test -- --run packages/sidekick-core/src/__tests__/session-log-writer.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-core/src/log-events.ts packages/sidekick-core/src/structured-logging.ts packages/sidekick-core/src/index.ts packages/sidekick-core/src/__tests__/session-log-writer.test.ts
git commit -m "feat(core): wire logEvent to SessionLogWriter for per-session writes"
```

---

### Task 4: Initialize SessionLogWriter in the Daemon

**Files:**
- Modify: `packages/sidekick-daemon/src/daemon.ts:147-168`

- [ ] **Step 1: Add SessionLogWriter initialization to Daemon constructor**

In `packages/sidekick-daemon/src/daemon.ts`, add import at the top:

```typescript
import { SessionLogWriter, setSessionLogWriter } from '@sidekick/core'
```

Add a private field to the Daemon class (around line 98):

```typescript
private sessionLogWriter: SessionLogWriter
```

In the constructor, after the logManager initialization (after line 160), add:

```typescript
    // Initialize per-session log writer for session-scoped log files
    const sessionsDir = path.join(projectDir, '.sidekick', 'sessions')
    this.sessionLogWriter = new SessionLogWriter({
      sessionsDir,
      maxHandles: 10,
      idleTimeoutMs: 30 * 60 * 1000,
    })
    setSessionLogWriter(this.sessionLogWriter)
```

- [ ] **Step 2: Reduce aggregate rotation config**

In the daemon constructor, change the aggregate log rotation (around line 153-155):

```typescript
          maxSizeBytes: this.configService.core.logging.rotation?.maxSizeBytes ?? 2_097_152, // 2MB (ephemeral debug window)
          maxFiles: this.configService.core.logging.rotation?.maxFiles ?? 2,
```

- [ ] **Step 3: Close per-session handles on SessionEnd**

In `handleSessionEnd()` (around line 742), after existing cleanup logic, add:

```typescript
      // Close per-session log handles
      await this.sessionLogWriter.closeSession(sessionId)
```

- [ ] **Step 4: Clean up writer on daemon stop**

In the `stop()` method, add before existing cleanup:

```typescript
    // Close all per-session log handles
    setSessionLogWriter(null)
    await this.sessionLogWriter.closeAll()
```

- [ ] **Step 5: Build to verify compilation**

Run: `pnpm --filter @sidekick/daemon build`
Expected: PASS (no type errors)

- [ ] **Step 6: Commit**

```bash
git add packages/sidekick-daemon/src/daemon.ts
git commit -m "feat(daemon): initialize SessionLogWriter and reduce aggregate rotation"
```

---

### Task 5: Reduce CLI Aggregate Rotation

**Files:**
- Modify: `packages/sidekick-cli/src/runtime.ts:150-158`

- [ ] **Step 1: Reduce CLI aggregate rotation to match daemon**

In `packages/sidekick-cli/src/runtime.ts`, change the fileDestination (around line 152-155):

```typescript
  const fileDestination = enableFileLogging
    ? {
        path: logFilePath,
        maxSizeBytes: rotation?.maxSizeBytes ?? 2_097_152, // 2MB (ephemeral debug window)
        maxFiles: rotation?.maxFiles ?? 2,
      }
    : undefined
```

- [ ] **Step 2: Initialize SessionLogWriter in CLI bootstrap**

Add import at top of `runtime.ts`:

```typescript
import { SessionLogWriter, setSessionLogWriter } from '@sidekick/core'
```

In `bootstrapRuntime()`, after the logManager creation (around line 173), add:

```typescript
  // Initialize per-session log writer (activated when sessionId is bound)
  const sessionsDir = projectRoot ? join(projectRoot, '.sidekick', 'sessions') : join(homedir(), '.sidekick', 'sessions')
  const sessionLogWriter = new SessionLogWriter({
    sessionsDir,
    maxHandles: 2, // CLI typically has 1 session
    idleTimeoutMs: 10 * 60 * 1000,
  })
  setSessionLogWriter(sessionLogWriter)
```

Add cleanup in the cleanup function (around line 238):

```typescript
    cleanup: () => {
      setSessionLogWriter(null)
      void sessionLogWriter.closeAll()
      cleanupErrorHandlers()
    },
```

- [ ] **Step 3: Build to verify compilation**

Run: `pnpm --filter @sidekick/cli build`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/sidekick-cli/src/runtime.ts
git commit -m "feat(cli): reduce aggregate rotation, initialize SessionLogWriter"
```

---

### Task 6: Update Timeline API to Read Per-Session Logs

**Files:**
- Modify: `packages/sidekick-ui/server/timeline-api.ts:253-296`
- Modify: `packages/sidekick-ui/server/__tests__/timeline-api.test.ts`

- [ ] **Step 1: Write the failing test for per-session read path**

Add to `packages/sidekick-ui/server/__tests__/timeline-api.test.ts`:

```typescript
describe('parseTimelineEvents — per-session logs', () => {
  it('reads from per-session logs when they exist', async () => {
    // Per-session log file at .sidekick/sessions/session-1/logs/
    const sessionLine = makeLogLine({
      time: 1000,
      type: 'reminder:staged',
      context: { sessionId: 'session-1' },
    })

    mockReaddir.mockImplementation((dir: string) => {
      if (dir.includes('sessions/session-1/logs')) {
        return Promise.resolve(['sidekickd.1.log', 'sidekick.1.log'])
      }
      // Aggregate dir — should NOT be read
      return Promise.resolve(['sidekick.1.log', 'sidekickd.1.log'])
    })

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sessions/session-1/logs')) {
        return Promise.resolve(sessionLine)
      }
      // Aggregate file — should NOT be read when per-session exists
      return Promise.resolve(makeLogLine({ time: 9999, type: 'error:occurred', errorMessage: 'should not appear' }))
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    expect(events).toHaveLength(1)
    expect(events[0].timestamp).toBe(1000)
    expect(events[0].type).toBe('reminder:staged')
  })

  it('falls back to aggregate logs when per-session logs do not exist', async () => {
    const aggregateLine = makeLogLine({
      time: 2000,
      type: 'decision:recorded',
      decision: 'old-session',
      reason: 'fallback',
    })

    mockReaddir.mockImplementation((dir: string) => {
      if (dir.includes('sessions/old-session/logs')) {
        // No per-session logs
        return Promise.reject(new Error('ENOENT'))
      }
      // Aggregate dir
      return Promise.resolve(['sidekick.1.log', 'sidekickd.1.log'])
    })

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sessions/')) {
        return Promise.reject(new Error('ENOENT'))
      }
      return Promise.resolve(aggregateLine)
    })

    const events = await parseTimelineEvents('/fake/project', 'old-session')
    expect(events).toHaveLength(1)
    expect(events[0].timestamp).toBe(2000)
  })

  it('does not filter by sessionId when reading per-session logs', async () => {
    // Per-session files only contain events for that session,
    // so sessionId filtering is unnecessary (but type filtering still applies)
    const lines = [
      makeLogLine({ time: 1000, type: 'reminder:staged', context: { sessionId: 'session-1' } }),
      makeLogLine({ time: 2000, type: 'daemon:started', context: { sessionId: 'session-1' } }),
    ].join('\n')

    mockReaddir.mockImplementation((dir: string) => {
      if (dir.includes('sessions/session-1/logs')) {
        return Promise.resolve(['sidekickd.1.log'])
      }
      return Promise.resolve([])
    })

    mockReadFile.mockImplementation((path: string) => {
      if (path.includes('sessions/session-1/logs')) return Promise.resolve(lines)
      return Promise.resolve('')
    })

    const events = await parseTimelineEvents('/fake/project', 'session-1')
    // daemon:started is not in TIMELINE_EVENT_TYPES, so filtered by type
    expect(events).toHaveLength(1)
    expect(events[0].type).toBe('reminder:staged')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm --filter sidekick-ui test -- --run server/__tests__/timeline-api.test.ts`
Expected: FAIL — still reads from aggregate

- [ ] **Step 3: Update parseTimelineEvents to read per-session first**

Replace `parseTimelineEvents` in `packages/sidekick-ui/server/timeline-api.ts`:

```typescript
/**
 * Parse timeline events from sidekick log files for a given session.
 *
 * Reads per-session logs first (.sidekick/sessions/{sessionId}/logs/).
 * Falls back to aggregate logs (.sidekick/logs/) for pre-migration sessions
 * that don't have per-session log files.
 */
export async function parseTimelineEvents(
  projectDir: string,
  sessionId: string
): Promise<TimelineEvent[]> {
  // Try per-session logs first (source of truth for new sessions)
  const sessionLogsDir = join(projectDir, '.sidekick', 'sessions', sessionId, 'logs')
  const [sessionCliFiles, sessionDaemonFiles] = await Promise.all([
    findLogFiles(sessionLogsDir, 'sidekick.'),
    findLogFiles(sessionLogsDir, 'sidekickd.'),
  ])

  const hasSessionLogs = sessionCliFiles.length > 0 || sessionDaemonFiles.length > 0

  let allEntries: RawLogEntry[]

  if (hasSessionLogs) {
    // Per-session path: read only this session's files (no sessionId filter needed)
    const allFiles = [...sessionCliFiles, ...sessionDaemonFiles]
    const fileResults = await Promise.all(allFiles.map(readLogFile))
    allEntries = fileResults.flat()
  } else {
    // Fallback: scan aggregate logs and filter by sessionId (pre-migration sessions)
    const aggregateLogsDir = join(projectDir, '.sidekick', 'logs')
    const [cliFiles, daemonFiles] = await Promise.all([
      findLogFiles(aggregateLogsDir, 'sidekick.'),
      findLogFiles(aggregateLogsDir, 'sidekickd.'),
    ])
    const allFiles = [...cliFiles, ...daemonFiles]
    const fileResults = await Promise.all(allFiles.map(readLogFile))
    allEntries = fileResults.flat().filter(
      (entry) => entry.context?.sessionId === sessionId
    )
  }

  // Filter by timeline-visible event types
  const filtered = allEntries.filter(
    (entry) => TIMELINE_EVENT_TYPES.has(entry.type)
  )

  // Sort by timestamp ascending
  filtered.sort((a, b) => a.time - b.time)

  // Convert to TimelineEvent[], deduplicating transcriptLineId for same-timestamp
  // same-type events (mirrors the dedup scheme in readSidekickEvents).
  const seen = new Map<string, number>()
  return filtered.map((entry) => {
    const { label, detail } = generateLabel(entry.type, entry.payload || {})
    const baseId = `sidekick-${entry.time}-${entry.type}`
    const count = (seen.get(baseId) ?? 0) + 1
    seen.set(baseId, count)
    const stableId = count > 1 ? `${baseId}-${count}` : baseId
    return {
      id: randomUUID(),
      timestamp: entry.time,
      type: entry.type as TimelineSidekickEventType,
      label,
      ...(detail !== undefined ? { detail } : {}),
      transcriptLineId: stableId,
    }
  })
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm --filter sidekick-ui test -- --run server/__tests__/timeline-api.test.ts`
Expected: ALL PASS (existing tests + new per-session tests)

- [ ] **Step 5: Commit**

```bash
git add packages/sidekick-ui/server/timeline-api.ts packages/sidekick-ui/server/__tests__/timeline-api.test.ts
git commit -m "feat(ui): read per-session logs in timeline API with aggregate fallback"
```

---

### Task 7: Verify End-to-End Build and Tests

**Files:** None (verification only)

- [ ] **Step 1: Run full build**

Run: `pnpm build`
Expected: PASS across all packages

- [ ] **Step 2: Run typecheck**

Run: `pnpm typecheck`
Expected: PASS

- [ ] **Step 3: Run lint**

Run: `pnpm lint`
Expected: PASS (or only pre-existing warnings)

- [ ] **Step 4: Run relevant tests**

Run: `pnpm --filter @sidekick/core test -- --run --exclude '**/{ipc,ipc-service,daemon-client}.test.ts'`
Run: `pnpm --filter sidekick-ui test -- --run`
Expected: ALL PASS

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add -A
git commit -m "chore: fixups from per-session logging verification"
```
