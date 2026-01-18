/**
 * ConfigWatcher - Watches configuration directories for hot-reload.
 *
 * Per design/DAEMON.md §4.3: Watches config directories for changes.
 * On any file change, triggers a callback for config reload.
 *
 * Watches both levels:
 * - Project-level: .sidekick/ (higher priority in cascade)
 * - User-level: ~/.sidekick/ (lower priority in cascade)
 *
 * Does NOT filter by filename - any change in these directories triggers
 * a reload. This keeps the watcher decoupled from config file knowledge.
 *
 * Uses chokidar for reliable cross-platform file watching, handling:
 * - Atomic writes (editor save patterns)
 * - File creation/deletion
 * - Platform-specific quirks (macOS FSEvents, Linux inotify)
 *
 * @see docs/design/DAEMON.md §4.3
 * @see docs/design/CONFIG-SYSTEM.md
 */

import { Logger } from '@sidekick/core'
import { watch, type FSWatcher } from 'chokidar'
import { homedir } from 'os'
import path from 'path'

/**
 * Configuration change event.
 */
export interface ConfigChangeEvent {
  /** The file that changed (basename) */
  file: string
  /** Type of change */
  eventType: 'add' | 'change' | 'unlink'
  /** Full path to the file */
  fullPath: string
  /** Whether this is a user-level or project-level config */
  scope: 'user' | 'project'
}

/**
 * Callback invoked when a watched config file changes.
 */
export type ConfigChangeHandler = (event: ConfigChangeEvent) => void

/**
 * Watches configuration files for changes and triggers hot-reload.
 */
export class ConfigWatcher {
  private projectDir: string
  private userDir: string
  private logger: Logger
  private watcher: FSWatcher | null = null
  private onChange: ConfigChangeHandler
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null

  /** Debounce interval to coalesce rapid file changes (e.g., editor save) */
  private readonly debounceMs = 100

  /**
   * Create a ConfigWatcher.
   * @param projectSidekickDir - The project's .sidekick directory path
   * @param logger - Logger instance
   * @param onChange - Callback for config changes
   */
  constructor(projectSidekickDir: string, logger: Logger, onChange: ConfigChangeHandler) {
    this.projectDir = projectSidekickDir
    this.userDir = path.join(homedir(), '.sidekick')
    this.logger = logger
    this.onChange = onChange
  }

  /**
   * Start watching configuration files.
   *
   * Watches both project-level (.sidekick/) and user-level (~/.sidekick/)
   * config directories for changes to recognized config files.
   */
  start(): void {
    // Create ready promise for async initialization
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve
    })

    // Watch both directories
    const dirsToWatch = [this.projectDir, this.userDir]

    this.watcher = watch(dirsToWatch, {
      // Only watch the directories themselves, not subdirectories
      depth: 0,
      // Ignore initial scan - we only care about changes
      ignoreInitial: true,
      // Use polling as fallback for network filesystems
      usePolling: false,
      // Don't use awaitWriteFinish - we have our own debouncing,
      // and awaitWriteFinish can delay/skip 'add' events
    })

    this.watcher
      .on('add', (filePath) => this.handleEvent('add', filePath))
      .on('change', (filePath) => this.handleEvent('change', filePath))
      .on('unlink', (filePath) => this.handleEvent('unlink', filePath))
      .on('error', (err) => {
        this.logger.error('ConfigWatcher error', { error: err })
      })
      .on('ready', () => {
        this.logger.debug('ConfigWatcher ready')
        this.readyResolve?.()
      })

    this.logger.info('ConfigWatcher started', {
      projectDir: this.projectDir,
      userDir: this.userDir,
    })
  }

  /**
   * Wait for the watcher to be ready.
   * Resolves when chokidar has finished its initial scan.
   */
  async ready(): Promise<void> {
    if (this.readyPromise) {
      await this.readyPromise
    }
  }

  /**
   * Stop watching all configuration files.
   */
  stop(): void {
    if (this.watcher) {
      void this.watcher.close()
      this.watcher = null
    }

    // Clear any pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()

    this.logger.info('ConfigWatcher stopped')
  }

  /**
   * Handle file system event with debouncing.
   * No filtering - any file change in the watched directories triggers the callback.
   */
  private handleEvent(eventType: 'add' | 'change' | 'unlink', filePath: string): void {
    const filename = path.basename(filePath)

    // Determine scope
    const scope = filePath.startsWith(this.userDir) ? 'user' : 'project'

    // Debounce by full path (not just filename, since same name in different dirs)
    const existingTimer = this.debounceTimers.get(filePath)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    const timer = setTimeout(() => {
      this.debounceTimers.delete(filePath)

      this.logger.info('Config file changed', { file: filename, eventType, scope })

      try {
        this.onChange({
          file: filename,
          eventType,
          fullPath: filePath,
          scope,
        })
      } catch (err) {
        this.logger.error('Error in config change handler', {
          file: filename,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }, this.debounceMs)

    this.debounceTimers.set(filePath, timer)
  }
}
