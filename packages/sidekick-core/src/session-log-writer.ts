/**
 * SessionLogWriter — manages per-session log file handles with LRU eviction.
 *
 * Writes NDJSON lines to .sidekick/sessions/{sessionId}/logs/{logFile}.
 * File handles are lazy-opened and evicted when maxHandles is exceeded.
 *
 * @see docs/plans/2026-04-03-per-session-logging-design.md
 */

import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { createWriteStream, type WriteStream } from 'node:fs'
import { isValidPathSegment } from './staging-paths.js'

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
  /** Sentinel map to prevent duplicate handle creation on concurrent writes */
  private readonly pendingCreation = new Map<string, Promise<HandleEntry>>()

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

    // Validate path segments to prevent path traversal (defense-in-depth)
    if (!isValidPathSegment(sessionId) || !isValidPathSegment(logFile)) return

    const key = `${sessionId}/${logFile}`

    // Wait for any in-progress handle creation for this key before checking the map.
    // This prevents concurrent callers from each spawning their own WriteStream.
    const pending = this.pendingCreation.get(key)
    if (pending) {
      await pending
    }

    let entry = this.handles.get(key)

    if (!entry) {
      // Evict LRU if at capacity
      if (this.handles.size >= this.maxHandles) {
        this.evictLRU()
      }

      const creationPromise = this.createHandle(sessionId, logFile)
      this.pendingCreation.set(key, creationPromise)
      try {
        entry = await creationPromise
        this.handles.set(key, entry)
      } finally {
        this.pendingCreation.delete(key)
      }
    }

    // Wait for stream to be ready (may reject if open failed — handle evicted above)
    await entry.ready

    // Update LRU timestamp and reset idle timer
    entry.lastUsed = Date.now()
    this.resetIdleTimer(key, entry)

    // Write the line — evict handle on error so next write can retry
    return new Promise<void>((resolve, reject) => {
      entry.stream.write(line, (err) => {
        if (err) {
          void this.closeHandle(key)
          reject(err)
        } else {
          resolve()
        }
      })
    })
  }

  private async createHandle(sessionId: string, logFile: string): Promise<HandleEntry> {
    const logDir = join(this.sessionsDir, sessionId, 'logs')
    await mkdir(logDir, { recursive: true })

    const filePath = join(logDir, logFile)
    const stream = createWriteStream(filePath, { flags: 'a' })

    const ready = new Promise<void>((resolve, reject) => {
      stream.once('open', () => resolve())
      stream.once('error', (err) => {
        // Evict broken handle so next write can retry — the entry is not yet in
        // handles (it's still in pendingCreation), so nothing to delete here.
        stream.destroy()
        reject(err)
      })
    })

    return {
      stream,
      lastUsed: Date.now(),
      timer: null,
      ready,
    }
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
    // Called only when size >= maxHandles (> 0), so handles is guaranteed non-empty
    let oldestKey = ''
    let oldestTime = Infinity

    for (const [key, entry] of this.handles) {
      if (entry.lastUsed < oldestTime) {
        oldestTime = entry.lastUsed
        oldestKey = key
      }
    }

    // Fire and forget — eviction is best-effort
    void this.closeHandle(oldestKey)
  }

  private resetIdleTimer(key: string, entry: HandleEntry): void {
    if (entry.timer) clearTimeout(entry.timer)
    entry.timer = setTimeout(() => {
      void this.closeHandle(key)
    }, this.idleTimeoutMs)
    // Don't keep the process alive for idle timers (unref is always present in Node.js)
    entry.timer.unref()
  }
}
