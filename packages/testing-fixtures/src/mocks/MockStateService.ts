/**
 * Mock State Service for Testing
 *
 * Provides an in-memory state service for testing without file I/O.
 * Implements the MinimalStateService interface from @sidekick/types.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

import type { MinimalStateService, StateReadResult } from '@sidekick/types'

/** Minimal schema interface matching Zod's safeParse/parse interface */
interface SchemaLike<T> {
  safeParse(data: unknown): { success: true; data: T } | { success: false; error: unknown }
  parse(data: unknown): T
}

export class MockStateService implements MinimalStateService {
  private storage = new Map<string, unknown>()
  private projectRoot: string

  constructor(projectRoot = '/mock/project') {
    this.projectRoot = projectRoot
  }

  read<T>(
    path: string,
    schema: SchemaLike<T>,
    defaultValue?: T | null | (() => T | null)
  ): Promise<StateReadResult<T>> {
    const stored = this.storage.get(path)

    if (stored === undefined) {
      if (defaultValue !== undefined) {
        const value = typeof defaultValue === 'function' ? (defaultValue as () => T | null)() : defaultValue
        return Promise.resolve({ data: value as T, source: 'default' })
      }
      return Promise.reject(new Error(`StateNotFoundError: ${path}`))
    }

    // Validate with schema
    const parsed = schema.safeParse(stored)
    if (!parsed.success) {
      if (defaultValue !== undefined) {
        const value = typeof defaultValue === 'function' ? (defaultValue as () => T | null)() : defaultValue
        return Promise.resolve({ data: value as T, source: 'recovered' })
      }
      return Promise.reject(new Error(`StateCorruptError: ${path}`))
    }

    return Promise.resolve({ data: parsed.data, source: 'fresh', mtime: Date.now() })
  }

  write<T>(path: string, data: T, schema: SchemaLike<T>, _options?: { trackHistory?: boolean }): Promise<void> {
    // Validate with schema
    const parsed = schema.parse(data) // throws on invalid
    this.storage.set(path, parsed)
    return Promise.resolve()
  }

  delete(path: string): Promise<void> {
    this.storage.delete(path)
    return Promise.resolve()
  }

  sessionStatePath(sessionId: string, filename: string): string {
    return `${this.projectRoot}/.sidekick/sessions/${sessionId}/state/${filename}`
  }

  globalStatePath(filename: string): string {
    return `${this.projectRoot}/.sidekick/state/${filename}`
  }

  rootDir(): string {
    return `${this.projectRoot}/.sidekick`
  }

  sessionsDir(): string {
    return `${this.projectRoot}/.sidekick/sessions`
  }

  sessionRootDir(sessionId: string): string {
    return `${this.projectRoot}/.sidekick/sessions/${sessionId}`
  }

  logsDir(): string {
    return `${this.projectRoot}/.sidekick/logs`
  }

  // Test utilities

  /**
   * Reset all stored state.
   */
  reset(): void {
    this.storage.clear()
  }

  /**
   * Get raw stored value (for test assertions).
   */
  getStored(path: string): unknown {
    return this.storage.get(path)
  }

  /**
   * Set raw stored value (for test setup).
   */
  setStored(path: string, value: unknown): void {
    this.storage.set(path, value)
  }

  /**
   * Check if a path exists.
   */
  has(path: string): boolean {
    return this.storage.has(path)
  }

  /**
   * Get all stored paths.
   */
  getPaths(): string[] {
    return Array.from(this.storage.keys())
  }
}
