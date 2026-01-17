/**
 * ConfigWatcher - Watches configuration files for hot-reload.
 *
 * Per design/DAEMON.md §4.3: Watches config files for changes.
 * On change, triggers a callback for config reload.
 *
 * Watches all config files used by the config system:
 * - sidekick.config (unified config)
 * - config.yaml, llm.yaml, transcript.yaml, features.yaml (domain configs)
 * - *.yaml.local (local overrides)
 * - .env, .env.local (environment files)
 *
 * Uses Node's built-in fs.watch for simplicity. For production use with many files
 * or cross-platform reliability, consider chokidar.
 *
 * @see docs/design/DAEMON.md §4.3
 * @see docs/design/CONFIG-SYSTEM.md
 */

import { Logger } from '@sidekick/core'
import fs from 'fs'
import path from 'path'

/**
 * Configuration change event.
 */
export interface ConfigChangeEvent {
  /** The file that changed */
  file: string
  /** Type of change: 'rename' or 'change' */
  eventType: 'rename' | 'change'
}

/**
 * Callback invoked when a watched config file changes.
 */
export type ConfigChangeHandler = (event: ConfigChangeEvent) => void

/**
 * Watches configuration files for changes and triggers hot-reload.
 */
export class ConfigWatcher {
  private sidekickDir: string
  private logger: Logger
  private watchers: fs.FSWatcher[] = []
  private onChange: ConfigChangeHandler
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>()

  /** Debounce interval to coalesce rapid file changes (e.g., editor save) */
  private readonly debounceMs = 100

  /**
   * Create a ConfigWatcher.
   * @param sidekickDir - The .sidekick directory path (from StateService.rootDir())
   * @param logger - Logger instance
   * @param onChange - Callback for config changes
   */
  constructor(sidekickDir: string, logger: Logger, onChange: ConfigChangeHandler) {
    this.sidekickDir = sidekickDir
    this.logger = logger
    this.onChange = onChange
  }

  /**
   * Start watching configuration files.
   * Watches:
   * - .sidekick/sidekick.config (unified config)
   * - .sidekick/config.yaml (core domain config)
   * - .sidekick/llm.yaml (llm domain config)
   * - .sidekick/transcript.yaml (transcript domain config)
   * - .sidekick/features.yaml (features domain config)
   * - .sidekick/*.yaml.local (local overrides)
   * - .sidekick/.env (environment variables)
   * - .sidekick/.env.local (local environment overrides)
   */
  start(): void {
    const filesToWatch = [
      'sidekick.config',
      'config.yaml',
      'llm.yaml',
      'transcript.yaml',
      'features.yaml',
      'config.yaml.local',
      'llm.yaml.local',
      'transcript.yaml.local',
      'features.yaml.local',
      '.env',
      '.env.local',
    ]

    for (const filename of filesToWatch) {
      const filePath = path.join(this.sidekickDir, filename)
      this.watchFile(filePath, filename)
    }

    this.logger.info('ConfigWatcher started', {
      sidekickDir: this.sidekickDir,
      watching: filesToWatch,
    })
  }

  /**
   * Stop watching all configuration files.
   */
  stop(): void {
    for (const watcher of this.watchers) {
      watcher.close()
    }
    this.watchers = []

    // Clear any pending debounce timers
    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer)
    }
    this.debounceTimers.clear()

    this.logger.info('ConfigWatcher stopped')
  }

  private watchFile(filePath: string, filename: string): void {
    try {
      // Check if file exists first
      if (!fs.existsSync(filePath)) {
        this.logger.debug('Config file does not exist, skipping watch', { file: filename })
        return
      }

      const watcher = fs.watch(filePath, (eventType) => {
        this.handleChange(filename, eventType as 'rename' | 'change')
      })

      watcher.on('error', (err) => {
        this.logger.error('Watcher error', { file: filename, error: err })
      })

      this.watchers.push(watcher)
      this.logger.debug('Watching config file', { file: filename })
    } catch (err) {
      // File may not exist yet, that's OK
      this.logger.debug('Could not watch config file', {
        file: filename,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  /**
   * Handle file change event with debouncing.
   * Editors often trigger multiple events for a single save.
   */
  private handleChange(filename: string, eventType: 'rename' | 'change'): void {
    // Clear existing debounce timer for this file
    const existingTimer = this.debounceTimers.get(filename)
    if (existingTimer) {
      clearTimeout(existingTimer)
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      this.debounceTimers.delete(filename)

      this.logger.info('Config file changed', { file: filename, eventType })

      try {
        this.onChange({ file: filename, eventType })
      } catch (err) {
        this.logger.error('Error in config change handler', {
          file: filename,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }, this.debounceMs)

    this.debounceTimers.set(filename, timer)
  }
}
