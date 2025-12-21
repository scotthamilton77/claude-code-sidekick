/**
 * Emulator State Manager
 *
 * Manages call count state for LLM emulators. Persists state to
 * .sidekick/emulator-state/call-counts.json for visibility during testing.
 */

import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname } from 'node:path'
import type { Logger } from '@sidekick/types'

export interface ProviderCallState {
  callCount: number
  lastCallAt: string // ISO timestamp
}

export interface EmulatorState {
  version: 1
  providers: Record<string, ProviderCallState>
}

const DEFAULT_STATE: EmulatorState = {
  version: 1,
  providers: {},
}

export class EmulatorStateManager {
  private state: EmulatorState | null = null

  constructor(
    private readonly statePath: string,
    private readonly logger: Logger
  ) {}

  /**
   * Load state from disk, creating file if it doesn't exist.
   */
  async load(): Promise<EmulatorState> {
    if (this.state) {
      return this.state
    }

    try {
      const content = await readFile(this.statePath, 'utf-8')
      this.state = JSON.parse(content) as EmulatorState
      this.logger.debug('Loaded emulator state', {
        path: this.statePath,
        providerCount: Object.keys(this.state.providers).length,
      })
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        this.logger.debug('Emulator state file not found, creating new state', {
          path: this.statePath,
        })
        this.state = { ...DEFAULT_STATE }
        await this.save()
      } else {
        this.logger.warn('Failed to load emulator state, using defaults', {
          path: this.statePath,
          error: (error as Error).message,
        })
        this.state = { ...DEFAULT_STATE }
      }
    }

    return this.state
  }

  /**
   * Increment call count for a provider and return the new count.
   */
  async incrementCallCount(providerId: string): Promise<number> {
    const state = await this.load()

    if (!state.providers[providerId]) {
      state.providers[providerId] = {
        callCount: 0,
        lastCallAt: new Date().toISOString(),
      }
    }

    state.providers[providerId].callCount++
    state.providers[providerId].lastCallAt = new Date().toISOString()

    await this.save()

    this.logger.debug('Incremented emulator call count', {
      providerId,
      callCount: state.providers[providerId].callCount,
    })

    return state.providers[providerId].callCount
  }

  /**
   * Get current call count for a provider.
   */
  async getCallCount(providerId: string): Promise<number> {
    const state = await this.load()
    return state.providers[providerId]?.callCount ?? 0
  }

  /**
   * Reset call counts. If providerId specified, reset only that provider.
   */
  async reset(providerId?: string): Promise<void> {
    const state = await this.load()

    if (providerId) {
      delete state.providers[providerId]
      this.logger.info('Reset emulator state for provider', { providerId })
    } else {
      state.providers = {}
      this.logger.info('Reset all emulator state')
    }

    await this.save()
  }

  /**
   * Save state to disk with atomic write.
   */
  private async save(): Promise<void> {
    if (!this.state) {
      return
    }

    try {
      // Ensure directory exists
      await mkdir(dirname(this.statePath), { recursive: true })

      // Write atomically via temp file
      const tempPath = `${this.statePath}.tmp`
      const content = JSON.stringify(this.state, null, 2)
      await writeFile(tempPath, content, 'utf-8')

      // Rename is atomic on POSIX systems
      const { rename } = await import('node:fs/promises')
      await rename(tempPath, this.statePath)
    } catch (error) {
      this.logger.error('Failed to save emulator state', {
        path: this.statePath,
        error: (error as Error).message,
      })
      throw error
    }
  }
}
