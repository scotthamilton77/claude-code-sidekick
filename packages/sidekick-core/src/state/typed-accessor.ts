/**
 * Typed State Accessors - Encapsulated state file access.
 *
 * Provides type-safe read/write/delete operations for state files
 * without exposing filenames, schemas, or path construction to consumers.
 *
 * Features create accessors from their descriptors and use them in handlers.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

import type { MinimalStateService, StateReadResult } from '@sidekick/types'
import type { StateDescriptor } from './state-descriptor.js'

// Re-export for convenience
export type { StateReadResult } from '@sidekick/types'

/** Minimal interface for state journal — avoids hard dependency on StateJournal class */
export interface StateJournalLike {
  appendIfChanged(sessionId: string, fileKey: string, data: Record<string, unknown>): Promise<void>
  appendDeletion(sessionId: string, fileKey: string): Promise<void>
}

/**
 * Accessor for session-scoped state files.
 * Encapsulates path construction and schema validation.
 *
 * Type parameter D represents the default value type:
 * - undefined (default): throws if file missing
 * - T: returns T if file missing
 * - null: returns null if file missing
 *
 * @example
 * const accessor = new SessionStateAccessor(stateService, PRBaselineDescriptor)
 * const result = await accessor.read(sessionId)
 */
export class SessionStateAccessor<T, D = undefined> {
  /** Descriptor filename without .json extension — used as journal file key */
  private readonly fileKey: string

  constructor(
    private readonly stateService: MinimalStateService,
    private readonly descriptor: StateDescriptor<T, D>,
    private readonly journal?: StateJournalLike
  ) {
    if (descriptor.scope !== 'session') {
      throw new Error(`SessionStateAccessor requires a session-scoped descriptor, got: ${descriptor.scope}`)
    }
    this.fileKey = descriptor.filename.replace(/\.json$/, '')
  }

  /**
   * Read session state file.
   * Returns default value if file is missing/corrupt and default is defined.
   * When default is null and file is missing, result.source will be 'default' and result.data will be null.
   */
  async read(sessionId: string): Promise<StateReadResult<T | D>> {
    const path = this.stateService.sessionStatePath(sessionId, this.descriptor.filename)
    // Type assertion needed because StateService types don't track null defaults
    const result = await this.stateService.read(path, this.descriptor.schema, this.descriptor.defaultValue as T | null)
    return result as StateReadResult<T | D>
  }

  /**
   * Write session state file atomically.
   * If descriptor has trackHistory: true and dev mode is enabled, creates backup.
   */
  async write(sessionId: string, data: T): Promise<void> {
    const path = this.stateService.sessionStatePath(sessionId, this.descriptor.filename)
    await this.stateService.write(path, data, this.descriptor.schema, {
      trackHistory: this.descriptor.trackHistory,
    })
    // Journal the state change — best-effort (never fail the write)
    if (this.journal) {
      try {
        await this.journal.appendIfChanged(sessionId, this.fileKey, data as Record<string, unknown>)
      } catch {
        // Journal failure must not prevent state writes
      }
    }
  }

  /**
   * Delete session state file.
   */
  async delete(sessionId: string): Promise<void> {
    const path = this.stateService.sessionStatePath(sessionId, this.descriptor.filename)
    await this.stateService.delete(path)
    // Journal the deletion — best-effort (never fail the delete)
    if (this.journal) {
      try {
        await this.journal.appendDeletion(sessionId, this.fileKey)
      } catch {
        // Journal failure must not prevent state deletes
      }
    }
  }

  /**
   * Get the path for a session state file.
   * Useful for low-level operations or testing.
   */
  getPath(sessionId: string): string {
    return this.stateService.sessionStatePath(sessionId, this.descriptor.filename)
  }
}

/**
 * Accessor for global (project-level) state files.
 * Encapsulates path construction and schema validation.
 *
 * Type parameter D represents the default value type:
 * - undefined (default): throws if file missing
 * - T: returns T if file missing
 * - null: returns null if file missing
 *
 * @example
 * const accessor = new GlobalStateAccessor(stateService, GlobalMetricsDescriptor)
 * const result = await accessor.read()
 */
export class GlobalStateAccessor<T, D = undefined> {
  constructor(
    private readonly stateService: MinimalStateService,
    private readonly descriptor: StateDescriptor<T, D>
  ) {
    if (descriptor.scope !== 'global') {
      throw new Error(`GlobalStateAccessor requires a global-scoped descriptor, got: ${descriptor.scope}`)
    }
  }

  /**
   * Read global state file.
   * Returns default value if file is missing/corrupt and default is defined.
   * When default is null and file is missing, result.source will be 'default' and result.data will be null.
   */
  async read(): Promise<StateReadResult<T | D>> {
    const path = this.stateService.globalStatePath(this.descriptor.filename)
    // Type assertion needed because StateService types don't track null defaults
    const result = await this.stateService.read(path, this.descriptor.schema, this.descriptor.defaultValue as T | null)
    return result as StateReadResult<T | D>
  }

  /**
   * Write global state file atomically.
   * If descriptor has trackHistory: true and dev mode is enabled, creates backup.
   */
  async write(data: T): Promise<void> {
    const path = this.stateService.globalStatePath(this.descriptor.filename)
    return this.stateService.write(path, data, this.descriptor.schema, {
      trackHistory: this.descriptor.trackHistory,
    })
  }

  /**
   * Delete global state file.
   */
  async delete(): Promise<void> {
    const path = this.stateService.globalStatePath(this.descriptor.filename)
    await this.stateService.delete(path)
  }

  /**
   * Get the path for the global state file.
   * Useful for low-level operations or testing.
   */
  getPath(): string {
    return this.stateService.globalStatePath(this.descriptor.filename)
  }
}
