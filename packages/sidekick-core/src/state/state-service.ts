/**
 * StateService - Unified state management with atomic writes and Zod validation.
 *
 * Provides centralized access to all state files in .sidekick/ with:
 * - Atomic writes (tmp + rename pattern)
 * - Zod schema validation on read and write
 * - Corrupt file recovery (move to .bak)
 * - Optional caching (for daemon single-writer scenario)
 * - Staleness detection
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

import * as fs from 'node:fs/promises'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join } from 'node:path'
import type { ZodType } from 'zod'
import type { Logger } from '@sidekick/types'
import { PathResolver } from './path-resolver.js'
import { StateNotFoundError, StateCorruptError } from './errors.js'
import { toErrorMessage } from '../error-utils.js'

/**
 * Minimal config interface for StateService.
 * Only requires the development.enabled flag for backup behavior.
 * Structurally compatible with MinimalConfigService and ConfigService.
 */
export interface StateServiceConfig {
  readonly core: {
    readonly development: { readonly enabled: boolean }
  }
}

// Re-export errors for convenience
export { StateNotFoundError, StateCorruptError } from './errors.js'

// ============================================================================
// Types
// ============================================================================

export interface StateReadResult<T> {
  data: T
  source: 'fresh' | 'stale' | 'default' | 'recovered'
  mtime?: number
}

export interface StateServiceOptions {
  /** Enable in-memory caching (daemon only - single-writer guarantee) */
  cache?: boolean
  /** Threshold in ms for staleness detection (default: 60000) */
  staleThresholdMs?: number
  /** Logger instance */
  logger?: Logger
  /**
   * Config for dev mode backup behavior.
   * Can be a static config object or a getter function for hot-reload support.
   * When using a getter, dev mode changes are picked up without daemon restart.
   */
  config?: StateServiceConfig | (() => StateServiceConfig)
  /**
   * State directory name relative to projectRoot.
   * Default: '.sidekick' (standard project-level state)
   * Set to '' for user-level state where projectRoot is already ~/.sidekick/
   */
  stateDir?: string
}

/** Default can be a value, null, or a factory function */
type DefaultValue<T> = T | null | (() => T | null)

/** Options for write operations */
export interface WriteOptions {
  /**
   * Track history of changes in dev mode.
   * When true and dev mode is enabled, creates timestamped backup before write.
   * Use for LLM-generated content and reminder consumption state.
   */
  trackHistory?: boolean
}

// ============================================================================
// Helpers
// ============================================================================

function resolveDefault<T>(defaultValue: DefaultValue<T>): T | null {
  return typeof defaultValue === 'function' ? (defaultValue as () => T | null)() : defaultValue
}

function isEnoent(err: unknown): boolean {
  return err instanceof Error && 'code' in err && err.code === 'ENOENT'
}

// ============================================================================
// StateService
// ============================================================================

export class StateService {
  private readonly paths: PathResolver
  private readonly staleThresholdMs: number
  private readonly logger?: Logger
  private readonly cache: Map<string, { data: unknown; mtime: number }> | null
  private readonly configGetter?: () => StateServiceConfig

  constructor(projectRoot: string, options?: StateServiceOptions) {
    this.paths = new PathResolver(projectRoot, options?.stateDir)
    this.staleThresholdMs = options?.staleThresholdMs ?? 60_000
    this.logger = options?.logger
    this.cache = options?.cache ? new Map() : null
    // Support both static config and getter function for hot-reload
    if (options?.config) {
      this.configGetter =
        typeof options.config === 'function' ? options.config : () => options.config as StateServiceConfig
    }
  }

  /** Check if dev mode is currently enabled (supports hot-reload) */
  private isDevModeEnabled(): boolean {
    return this.configGetter?.().core.development.enabled ?? false
  }

  // ==========================================================================
  // Read/Write Primitives
  // ==========================================================================

  /**
   * Read state file with Zod validation.
   *
   * @param path - Absolute path to state file
   * @param schema - Zod schema for validation
   * @param defaultValue - Optional. Value or factory function.
   *                       If omitted, throws on missing/corrupt file.
   */
  async read<T>(path: string, schema: ZodType<T>, defaultValue?: DefaultValue<T>): Promise<StateReadResult<T>> {
    // Check cache first
    if (this.cache?.has(path)) {
      const cached = this.cache.get(path)!
      return { data: cached.data as T, source: 'fresh', mtime: cached.mtime }
    }

    try {
      const content = await fs.readFile(path, 'utf-8')
      const stat = await fs.stat(path)

      let json: unknown
      try {
        json = JSON.parse(content)
      } catch (parseErr) {
        return this.handleInvalid(path, 'parse_error', parseErr, defaultValue)
      }

      const parsed = schema.safeParse(json)
      if (!parsed.success) {
        return this.handleInvalid(path, 'schema_validation', parsed.error, defaultValue)
      }

      const isStale = Date.now() - stat.mtimeMs > this.staleThresholdMs

      // Update cache
      if (this.cache) {
        this.cache.set(path, { data: parsed.data, mtime: stat.mtimeMs })
      }

      return {
        data: parsed.data,
        source: isStale ? 'stale' : 'fresh',
        mtime: stat.mtimeMs,
      }
    } catch (err) {
      if (isEnoent(err)) {
        return this.handleMissing(path, defaultValue)
      }
      // Other errors (permission, etc.) - treat as corrupt
      return this.handleInvalid(path, 'parse_error', err, defaultValue)
    }
  }

  /**
   * Atomic write with Zod validation.
   * Uses tmp + rename pattern to prevent corruption.
   * Validates data against schema before writing.
   * In dev mode with trackHistory, creates timestamped backup before overwriting.
   *
   * @param path - Absolute path to state file
   * @param data - Data to write
   * @param schema - Zod schema for validation
   * @param options - Optional write options (trackHistory for dev mode backups)
   */
  async write<T>(path: string, data: T, schema: ZodType<T>, options?: WriteOptions): Promise<void> {
    // Validate before writing (fail fast)
    const parsed = schema.parse(data) // throws on invalid

    const dir = dirname(path)
    await fs.mkdir(dir, { recursive: true })

    // Dev mode: backup existing file before overwrite when trackHistory is enabled
    if (options?.trackHistory && this.isDevModeEnabled()) {
      await this.backupBeforeWrite(path)
    }

    // Include random suffix to prevent collisions when Date.now() returns same value
    const tmpPath = `${path}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`
    const json = JSON.stringify(parsed, null, 2)

    try {
      await fs.writeFile(tmpPath, json, 'utf-8')
      await fs.rename(tmpPath, path)

      // Update cache
      if (this.cache) {
        const stat = await fs.stat(path)
        this.cache.set(path, { data: parsed, mtime: stat.mtimeMs })
      }

      this.logger?.debug('State written', { path })
    } catch (err) {
      // Clean up tmp file on failure
      try {
        await fs.unlink(tmpPath)
      } catch (cleanupErr) {
        // Log cleanup errors for observability
        this.logger?.trace('Failed to cleanup temp file', {
          tmpPath,
          error: toErrorMessage(cleanupErr),
        })
      }
      throw err
    }
  }

  /**
   * Delete state file if it exists.
   * @returns true if the file was actually deleted, false if it didn't exist
   */
  async delete(path: string): Promise<boolean> {
    try {
      await fs.unlink(path)

      // Invalidate cache
      if (this.cache) {
        this.cache.delete(path)
      }

      this.logger?.debug('State deleted', { path })
      return true
    } catch (err) {
      if (!isEnoent(err)) {
        throw err
      }
      // File doesn't exist - that's fine
      return false
    }
  }

  /**
   * Invalidate cached entry for a path.
   * Used when an external process writes a file that this StateService has cached.
   * The next read() will re-read from disk.
   * No-op if caching is disabled or path is not cached.
   */
  invalidateCache(path: string): void {
    if (this.cache?.delete(path)) {
      this.logger?.debug('Cache invalidated', { path })
    }
  }

  /**
   * Rename/move state file.
   * Creates destination directory if needed.
   */
  async rename(oldPath: string, newPath: string): Promise<void> {
    const destDir = dirname(newPath)
    await fs.mkdir(destDir, { recursive: true })
    await fs.rename(oldPath, newPath)

    // Update cache
    if (this.cache) {
      const cached = this.cache.get(oldPath)
      if (cached) {
        this.cache.delete(oldPath)
        this.cache.set(newPath, cached)
      }
    }

    this.logger?.debug('State renamed', { oldPath, newPath })
  }

  // ==========================================================================
  // Path Accessors
  // ==========================================================================

  /** Root state directory (.sidekick or user config root) */
  rootDir(): string {
    return this.paths.rootDir()
  }

  /** Sessions directory (.sidekick/sessions) */
  sessionsDir(): string {
    return this.paths.sessionsDir()
  }

  /** Session root directory (.sidekick/sessions/{sessionId}) */
  sessionRootDir(sessionId: string): string {
    return this.paths.sessionRootDir(sessionId)
  }

  sessionStateDir(sessionId: string): string {
    return this.paths.sessionStateDir(sessionId)
  }

  sessionStagingDir(sessionId: string): string {
    return this.paths.sessionStagingDir(sessionId)
  }

  globalStateDir(): string {
    return this.paths.globalStateDir()
  }

  logsDir(): string {
    return this.paths.logsDir()
  }

  sessionStatePath(sessionId: string, filename: string): string {
    return this.paths.sessionState(sessionId, filename)
  }

  globalStatePath(filename: string): string {
    return this.paths.globalState(filename)
  }

  hookStagingDir(sessionId: string, hookName: string): string {
    return this.paths.hookStagingDir(sessionId, hookName)
  }

  // ==========================================================================
  // Directory Operations
  // ==========================================================================

  /**
   * Ensure directory exists (mkdir -p).
   */
  async ensureDir(path: string): Promise<void> {
    await fs.mkdir(path, { recursive: true })
  }

  // ==========================================================================
  // Cache Operations
  // ==========================================================================

  /**
   * Preload all JSON files in a directory into cache.
   * Used by daemon at startup to warm the cache.
   */
  async preloadDirectory(dir: string): Promise<void> {
    if (!this.cache) {
      this.logger?.warn('preloadDirectory called but caching is disabled')
      return
    }

    if (!existsSync(dir)) {
      return
    }

    const entries = readdirSync(dir)
    const jsonFiles = entries.filter((f) => f.endsWith('.json'))

    for (const file of jsonFiles) {
      const filePath = join(dir, file)
      try {
        const content = readFileSync(filePath, 'utf-8')
        const stat = await fs.stat(filePath)
        const data: unknown = JSON.parse(content)
        this.cache.set(filePath, { data, mtime: stat.mtimeMs })
        this.logger?.debug('Preloaded state file', { file })
      } catch (err) {
        this.logger?.warn('Failed to preload state file', {
          file,
          error: toErrorMessage(err),
        })
      }
    }
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private handleMissing<T>(path: string, defaultValue?: DefaultValue<T>): StateReadResult<T> {
    if (defaultValue === undefined) {
      throw new StateNotFoundError(path)
    }
    // Type assertion: callers who pass null as default have T = ActualType | null
    return { data: resolveDefault(defaultValue) as T, source: 'default' }
  }

  private async handleInvalid<T>(
    path: string,
    reason: 'parse_error' | 'schema_validation',
    error: unknown,
    defaultValue?: DefaultValue<T>
  ): Promise<StateReadResult<T>> {
    await this.moveToBackup(path, reason, error)

    if (defaultValue === undefined) {
      throw new StateCorruptError(path, reason, error)
    }
    // Type assertion: callers who pass null as default have T = ActualType | null
    return { data: resolveDefault(defaultValue) as T, source: 'recovered' }
  }

  private async moveToBackup(path: string, reason: string, error: unknown): Promise<void> {
    const bakPath = `${path}.bak`

    this.logger?.warn('Corrupt state file detected', {
      path,
      reason,
      error: toErrorMessage(error),
    })

    try {
      await fs.rename(path, bakPath)
      this.logger?.info('Corrupt file moved to backup', { bakPath })
    } catch {
      // Best effort - if we can't move it, just log and continue
      this.logger?.debug('Could not move corrupt file to backup', { path })
    }
  }

  /**
   * Create timestamped backup of existing file before overwrite.
   * Only called when dev mode is enabled.
   * Silent no-op if file doesn't exist.
   */
  private async backupBeforeWrite(path: string): Promise<void> {
    try {
      await fs.access(path)
    } catch {
      // File doesn't exist, nothing to backup
      return
    }

    const dir = dirname(path)
    const ext = extname(path)
    const base = basename(path, ext)
    const backupPath = join(dir, `${base}.${Date.now()}${ext}`)

    try {
      await fs.copyFile(path, backupPath)
      this.logger?.debug('Dev mode backup created', { original: path, backup: backupPath })
    } catch (err) {
      // TODO: The copyFile failure path is difficult to test because fs.copyFile
      // is not easily mockable (imported directly from node:fs/promises). Consider
      // injecting a filesystem abstraction interface to improve testability.
      // This would allow test code to simulate disk errors without monkey-patching
      // or modifying the actual filesystem.

      // Best effort - don't fail the write if backup fails
      this.logger?.warn('Failed to create dev mode backup', {
        path,
        error: toErrorMessage(err),
      })
    }
  }
}
