/**
 * @fileoverview Runtime context type definition
 * Phase 4 Track B: RuntimeContext interface for dependency injection
 *
 * Central context object passed to all features during registration.
 * Contains initialized instances of core services.
 *
 * @see docs/design/CLI.md §4 Supervisor Interaction
 */

import type { ConfigService } from './config'
import type { Logger, LLMProvider } from '@sidekick/types'
import type { AssetResolver } from './assets'
import type { IpcService } from './ipc-service'

/**
 * Runtime paths resolved during bootstrap
 */
export interface RuntimePaths {
  /** Project root directory (if in project context) */
  projectDir?: string

  /** User config directory (~/.sidekick) */
  userConfigDir: string

  /** Project config directory (.sidekick) */
  projectConfigDir?: string

  /** Hook script installation path */
  hookScriptPath?: string
}

/**
 * Core runtime context passed to all features
 * Contains all initialized services needed for feature operation
 */
export interface RuntimeContext {
  /** Configuration service (merged from all sources) */
  config: ConfigService

  /** Structured logger (Pino-based) */
  logger: Logger

  /** Asset resolver (prompts, schemas, templates) */
  assets: AssetResolver

  /** LLM provider (typically LLMService with telemetry integration) */
  llm: LLMProvider

  /** Resolved runtime paths */
  paths: RuntimePaths

  /**
   * IPC service for supervisor communication.
   *
   * Provides connection pooling, auto-reconnection, and graceful degradation.
   * May be undefined if no project context is available.
   *
   * @see docs/design/CLI.md §4 Supervisor Interaction
   *
   * @example
   * ```typescript
   * // Send command to supervisor with graceful degradation
   * const result = await ctx.ipc?.send('state.update', { file: 'summary.json', data: {...} });
   *
   * // Check if supervisor is available before expensive operations
   * if (await ctx.ipc?.isAvailable()) {
   *   await ctx.ipc.send('task.enqueue', { type: 'summary', payload: {...} });
   * }
   * ```
   */
  ipc?: IpcService
}
