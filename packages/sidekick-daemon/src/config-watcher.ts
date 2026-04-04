/**
 * ConfigWatcher - Watches configuration directories for hot-reload.
 *
 * Per design/DAEMON.md §4.3: Watches config directories for changes.
 * On any config file change, triggers a callback for config reload.
 *
 * Watches cascade layers in priority order:
 * - Project-level: .sidekick/ (higher priority, depth 0)
 * - User-level: ~/.sidekick/ (lower priority, depth 0)
 * - Dev mode: assets/sidekick/ (source defaults, lowest priority, depth 2)
 *
 * Config directories (.sidekick/) are watched at depth 0 because config files
 * live directly at the root. The assets directory needs depth 2 to reach
 * subdirectories like defaults/, prompts/, personas/.
 *
 * Daemon runtime files (sidekickd.lock, .pid, .token) are ignored to prevent
 * unnecessary config reload churn from IPC operations.
 *
 * Uses chokidar for reliable cross-platform file watching, handling:
 * - Atomic writes (editor save patterns)
 * - File creation/deletion
 * - Platform-specific quirks (macOS FSEvents, Linux inotify)
 *
 * @see docs/design/DAEMON.md §4.3
 * @see docs/design/CONFIG-SYSTEM.md
 */

import { Logger, toErrorMessage } from '@sidekick/core'
import { watch, type FSWatcher } from 'chokidar'
import { homedir } from 'os'
import path from 'path'

/** Daemon runtime files that should never trigger config reloads */
const IGNORED_RUNTIME_FILES = new Set(['sidekickd.lock', 'sidekickd.pid', 'sidekickd.token'])

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
  /** Scope of the change based on which cascade layer it came from */
  scope: 'user' | 'project' | 'assets'
}

/**
 * Callback invoked when a watched config file changes.
 */
export type ConfigChangeHandler = (event: ConfigChangeEvent) => void

/**
 * Options for ConfigWatcher.
 */
export interface ConfigWatcherOptions {
  /** Project-level config directory (e.g., .sidekick/) */
  projectDir: string
  /** User-level config directory (defaults to ~/.sidekick/) */
  userDir?: string
  /** Source assets directory to watch in dev mode (e.g., assets/sidekick/) */
  devAssetsDir?: string
}

/**
 * Watches configuration files for changes and triggers hot-reload.
 */
export class ConfigWatcher {
  private projectDir: string
  private userDir: string
  private devAssetsDir: string | undefined
  private logger: Logger
  private configWatcher: FSWatcher | null = null
  private assetsWatcher: FSWatcher | null = null
  private onChange: ConfigChangeHandler
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readyPromise: Promise<void> | null = null
  private readyResolve: (() => void) | null = null

  /** Debounce interval to coalesce rapid file changes (e.g., editor save) */
  private readonly debounceMs = 100

  /**
   * Create a ConfigWatcher.
   * @param options - Configuration options
   * @param logger - Logger instance
   * @param onChange - Callback for config changes
   */
  constructor(options: ConfigWatcherOptions, logger: Logger, onChange: ConfigChangeHandler) {
    this.projectDir = options.projectDir
    this.userDir = options.userDir ?? path.join(homedir(), '.sidekick')
    this.devAssetsDir = options.devAssetsDir
    this.logger = logger
    this.onChange = onChange
  }

  /**
   * Start watching configuration files.
   *
   * Creates separate watchers for config dirs (depth 0) and assets dir (depth 2)
   * to avoid watching unnecessary subdirectories in .sidekick/.
   */
  start(): void {
    // Create ready promise for async initialization
    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve
    })

    // Track readiness of all watchers
    let configReady = false
    let assetsReady = !this.devAssetsDir // Already "ready" if not watching assets
    const checkAllReady = (): void => {
      if (configReady && assetsReady) {
        this.logger.debug('ConfigWatcher ready')
        this.readyResolve?.()
      }
    }

    // Config dirs watcher: depth 0 (config files live at root of .sidekick/)
    // Ignores daemon runtime files to prevent reload churn from IPC operations
    const configDirs = [this.projectDir, this.userDir]
    this.configWatcher = watch(configDirs, {
      depth: 0,
      ignoreInitial: true,
      usePolling: false,
      ignored: (filePath: string) => IGNORED_RUNTIME_FILES.has(path.basename(filePath)),
    })

    this.configWatcher
      .on('add', (filePath) => this.handleEvent('add', filePath))
      .on('change', (filePath) => this.handleEvent('change', filePath))
      .on('unlink', (filePath) => this.handleEvent('unlink', filePath))
      .on('error', (err) => {
        this.logger.error('ConfigWatcher error (config dirs)', { error: err })
      })
      .on('ready', () => {
        configReady = true
        checkAllReady()
      })

    // Assets watcher: depth 2 (assets has subdirectories: defaults/, prompts/, personas/)
    // Only created in dev mode
    if (this.devAssetsDir) {
      this.assetsWatcher = watch([this.devAssetsDir], {
        depth: 2,
        ignoreInitial: true,
        usePolling: false,
      })

      this.assetsWatcher
        .on('add', (filePath) => this.handleEvent('add', filePath))
        .on('change', (filePath) => this.handleEvent('change', filePath))
        .on('unlink', (filePath) => this.handleEvent('unlink', filePath))
        .on('error', (err) => {
          this.logger.error('ConfigWatcher error (assets dir)', { error: err })
        })
        .on('ready', () => {
          assetsReady = true
          checkAllReady()
        })
    }

    this.logger.info('ConfigWatcher started', {
      projectDir: this.projectDir,
      userDir: this.userDir,
      devAssetsDir: this.devAssetsDir ?? '(not watching)',
    })
  }

  /**
   * Wait for the watcher to be ready.
   * Resolves when all chokidar watchers have finished their initial scan.
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
    if (this.configWatcher) {
      void this.configWatcher.close()
      this.configWatcher = null
    }
    if (this.assetsWatcher) {
      void this.assetsWatcher.close()
      this.assetsWatcher = null
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
   */
  private handleEvent(eventType: 'add' | 'change' | 'unlink', filePath: string): void {
    const filename = path.basename(filePath)

    // Determine scope based on which directory the file is in
    const scope = this.determineScope(filePath)

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
          error: toErrorMessage(err),
        })
      }
    }, this.debounceMs)

    this.debounceTimers.set(filePath, timer)
  }

  /**
   * Determine the scope of a file change based on its path.
   */
  private determineScope(filePath: string): 'user' | 'project' | 'assets' {
    if (this.devAssetsDir && filePath.startsWith(this.devAssetsDir)) {
      return 'assets'
    }
    if (filePath.startsWith(this.userDir)) {
      return 'user'
    }
    return 'project'
  }
}
