/**
 * PathResolver - Internal path construction for StateService.
 *
 * NOT exported from package - consumers use StateService path accessors instead.
 *
 * @see docs/plans/2026-01-12-state-service-design.md
 */

import { join } from 'node:path'

/**
 * Internal path resolver for state file locations.
 * Single source of truth for all .sidekick/ path patterns.
 */
export class PathResolver {
  private readonly stateBase: string

  constructor(projectRoot: string, stateDir = '.sidekick') {
    this.stateBase = join(projectRoot, stateDir)
  }

  // === Directories ===

  globalStateDir(): string {
    return join(this.stateBase, 'state')
  }

  sessionRoot(sessionId: string): string {
    return join(this.stateBase, 'sessions', sessionId)
  }

  sessionStateDir(sessionId: string): string {
    return join(this.sessionRoot(sessionId), 'state')
  }

  sessionStagingDir(sessionId: string): string {
    return join(this.sessionRoot(sessionId), 'stage')
  }

  hookStagingDir(sessionId: string, hookName: string): string {
    return join(this.sessionStagingDir(sessionId), hookName)
  }

  logsDir(): string {
    return join(this.stateBase, 'logs')
  }

  // === File Paths ===

  globalState(filename: string): string {
    return join(this.globalStateDir(), filename)
  }

  sessionState(sessionId: string, filename: string): string {
    return join(this.sessionStateDir(sessionId), filename)
  }

  stagedReminder(sessionId: string, hookName: string, reminderName: string): string {
    return join(this.hookStagingDir(sessionId, hookName), `${reminderName}.json`)
  }
}
