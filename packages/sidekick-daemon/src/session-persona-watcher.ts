/**
 * SessionPersonaWatcher - Watches for session-persona.json changes.
 *
 * Watches `.sidekick/sessions/` directory and filters for
 * `session-persona.json` file events. Used to trigger snarky/resume
 * message regeneration when CLI writes persona changes directly
 * (bypassing IPC for sandbox compatibility).
 *
 * Note: chokidar v4+ removed glob support, so we watch the sessions
 * directory and filter events by filename instead.
 *
 * @see docs/design/DAEMON.md
 */

import { Logger } from '@sidekick/core'
import { watch, type FSWatcher } from 'chokidar'
import path from 'path'

const PERSONA_FILENAME = 'session-persona.json'

/**
 * Session persona change event.
 */
export interface PersonaChangeEvent {
  /** Session ID extracted from path */
  sessionId: string
  /** Type of change */
  eventType: 'add' | 'change' | 'unlink'
  /** Full path to the file */
  fullPath: string
}

/**
 * Callback invoked when a session persona changes.
 */
export type PersonaChangeHandler = (event: PersonaChangeEvent) => void

/**
 * Options for SessionPersonaWatcher.
 */
export interface SessionPersonaWatcherOptions {
  /** Project-level .sidekick directory */
  sidekickDir: string
}

/**
 * Extract session ID from a session-persona.json file path.
 *
 * Parses paths like `.sidekick/sessions/abc123/state/session-persona.json`
 * and extracts `abc123`.
 *
 * @param filePath - Full path to the session-persona.json file
 * @returns Session ID or null if path doesn't match expected format
 */
export function extractSessionIdFromPath(filePath: string): string | null {
  const normalizedPath = filePath.replace(/\\/g, '/')
  const sessionsIndex = normalizedPath.lastIndexOf('/sessions/')
  if (sessionsIndex === -1) return null

  const afterSessions = normalizedPath.substring(sessionsIndex + '/sessions/'.length)
  const slashIndex = afterSessions.indexOf('/')
  if (slashIndex === -1) return null

  return afterSessions.substring(0, slashIndex)
}

/**
 * Check if a file path is a session-persona.json file.
 */
function isPersonaFile(filePath: string): boolean {
  return path.basename(filePath) === PERSONA_FILENAME
}

/**
 * Watches for session-persona.json file changes.
 *
 * Watches the sessions/ directory recursively and filters for
 * session-persona.json events. When the CLI writes directly to
 * session-persona.json (bypassing IPC), this watcher detects
 * the change and allows the daemon to react.
 */
export class SessionPersonaWatcher {
  private sidekickDir: string
  private logger: Logger
  private watcher: FSWatcher | null = null
  private onChange: PersonaChangeHandler
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null

  /** Debounce interval to coalesce rapid file changes */
  private readonly debounceMs = 100

  /**
   * Create a SessionPersonaWatcher.
   * @param options - Configuration options
   * @param logger - Logger instance
   * @param onChange - Callback for persona changes
   */
  constructor(options: SessionPersonaWatcherOptions, logger: Logger, onChange: PersonaChangeHandler) {
    this.sidekickDir = options.sidekickDir
    this.logger = logger
    this.onChange = onChange
  }

  /**
   * Start watching for session persona changes.
   *
   * Watches the sessions/ directory and filters for session-persona.json files.
   */
  start(): void {
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve
    })

    const sessionsDir = path.join(this.sidekickDir, 'sessions')

    this.watcher = watch(sessionsDir, {
      ignoreInitial: true,
      ignored: (filePath: string, stats) => {
        // When stats is undefined (e.g. root path on initial call),
        // don't ignore — we can't determine if it's a directory
        if (!stats) return false
        // Allow directories to be traversed
        if (stats.isDirectory()) return false
        // Only watch session-persona.json files
        return !isPersonaFile(filePath)
      },
    })

    this.watcher
      .on('add', (filePath) => this.handleEvent('add', filePath))
      .on('change', (filePath) => this.handleEvent('change', filePath))
      .on('unlink', (filePath) => this.handleEvent('unlink', filePath))
      .on('error', (err) => {
        this.logger.error('SessionPersonaWatcher error', { error: err })
      })
      .on('ready', () => {
        this.logger.debug('SessionPersonaWatcher ready')
        this.readyResolve?.()
      })

    this.logger.info('SessionPersonaWatcher started', {
      sidekickDir: this.sidekickDir,
      sessionsDir,
    })
  }

  /**
   * Wait for the watcher to be ready.
   */
  async ready(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise
    }
  }

  /**
   * Stop watching session persona files.
   */
  stop(): void {
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()

    this.logger.info('SessionPersonaWatcher stopped')
  }

  /**
   * Handle file system event with debouncing.
   */
  private handleEvent(eventType: 'add' | 'change' | 'unlink', filePath: string): void {
    const sessionId = extractSessionIdFromPath(filePath)
    if (!sessionId) {
      this.logger.warn('Could not extract session ID from persona file path', { filePath })
      return
    }

    const existingTimer = this.debounceTimers.get(filePath)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath)
      this.logger.info('[persona-lifecycle] PersonaWatcher: debounce fired, dispatching change event', {
        sessionId,
        eventType,
        timestamp: new Date().toISOString(),
      })

      try {
        this.onChange({
          sessionId,
          eventType,
          fullPath: filePath,
        })
      } catch (err) {
        this.logger.error('Error in persona change handler', {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }, this.debounceMs)

    this.debounceTimers.set(filePath, timer)
  }
}
