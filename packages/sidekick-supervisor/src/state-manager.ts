import { Logger } from '@sidekick/core'
import fs from 'fs/promises'
import path from 'path'

/**
 * StateManager - Single-writer state persistence for the Supervisor.
 *
 * Manages `.sidekick/state/*.json` files with atomic writes (tmp + rename)
 * and in-memory caching. Handles corrupt state files on startup by moving
 * them to `.bak` and resetting to empty.
 *
 * @see LLD-SUPERVISOR.md §4.1
 */
export class StateManager {
  private stateDir: string
  private logger: Logger
  private cache = new Map<string, unknown>()

  constructor(stateDir: string, logger: Logger) {
    this.stateDir = stateDir
    this.logger = logger
  }

  /**
   * Initialize state directory and load existing state files into cache.
   * Corrupt JSON files are moved to `.bak` and reset to empty objects.
   */
  async initialize(): Promise<void> {
    // Create state directory if needed
    await fs.mkdir(this.stateDir, { recursive: true })

    // Load existing state files into cache, handling corrupt files
    await this.loadExistingState()
  }

  /**
   * Load all existing `.json` state files into cache.
   * Per LLD-SUPERVISOR §5: malformed JSON files are moved to `.bak` and reset to empty.
   */
  private async loadExistingState(): Promise<void> {
    let entries: string[]
    try {
      entries = await fs.readdir(this.stateDir)
    } catch {
      // Directory may not exist yet or be empty
      return
    }

    const jsonFiles = entries.filter((f) => f.endsWith('.json'))

    for (const file of jsonFiles) {
      const filePath = path.join(this.stateDir, file)
      try {
        const raw = await fs.readFile(filePath, 'utf-8')
        const data = JSON.parse(raw) as unknown
        this.cache.set(file, data)
        this.logger.debug('Loaded state file', { file })
      } catch (err) {
        // Malformed JSON - move to .bak and reset to empty
        await this.handleCorruptState(filePath, file, err)
      }
    }
  }

  /**
   * Handle corrupt state file: move original to .bak and reset to empty object.
   */
  private async handleCorruptState(filePath: string, file: string, error: unknown): Promise<void> {
    const bakPath = `${filePath}.bak`

    this.logger.warn('Corrupt state file detected, moving to .bak and resetting', {
      file,
      error: error instanceof Error ? error.message : String(error),
    })

    try {
      // Move corrupt file to .bak (overwrites existing .bak if present)
      await fs.rename(filePath, bakPath)

      // Reset to empty object and write
      const emptyState = {}
      this.cache.set(file, emptyState)
      await fs.writeFile(filePath, JSON.stringify(emptyState, null, 2), 'utf-8')

      this.logger.info('State file reset to empty', { file, backupPath: bakPath })
    } catch (moveErr) {
      this.logger.error('Failed to recover corrupt state file', {
        file,
        error: moveErr instanceof Error ? moveErr.message : String(moveErr),
      })
      // Initialize with empty cache entry anyway to prevent further errors
      this.cache.set(file, {})
    }
  }

  async update(file: string, data: Record<string, unknown>, merge = false): Promise<void> {
    if (!file.endsWith('.json')) {
      file += '.json'
    }

    const filePath = path.join(this.stateDir, file)

    let content: unknown = data
    if (merge) {
      // If merging, we need to know the current state.
      // We check our cache first, then disk.
      let current = this.cache.get(file) as Record<string, unknown> | undefined
      if (!current) {
        try {
          const raw = await fs.readFile(filePath, 'utf-8')
          current = JSON.parse(raw) as Record<string, unknown>
        } catch {
          current = {}
        }
      }
      content = { ...current, ...data }
    }

    this.cache.set(file, content)

    // Atomic write: write to .tmp then rename
    const tmpPath = `${filePath}.tmp`
    const json = JSON.stringify(content, null, 2)

    try {
      await fs.writeFile(tmpPath, json, 'utf-8')
      await fs.rename(tmpPath, filePath)
      this.logger.debug('State updated', { file })
    } catch (err) {
      this.logger.error('Failed to write state', { file, error: err })
      throw err
    }
  }

  get(file: string): unknown {
    if (!file.endsWith('.json')) {
      file += '.json'
    }
    return this.cache.get(file)
  }
}
