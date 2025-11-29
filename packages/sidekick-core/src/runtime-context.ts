/**
 * @fileoverview Runtime context type definition
 * Phase 4 Track B: RuntimeContext interface for dependency injection
 *
 * Central context object passed to all features during registration.
 * Contains initialized instances of core services.
 *
 * @see docs/design/CLI.md §4 Supervisor Interaction
 * @see docs/design/CORE-RUNTIME.md §4.1 Runtime Context
 */

import type { ConfigService } from './config'
import type { Logger, LLMProvider, HandlerRegistry } from '@sidekick/types'
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
   * Handler registry for event dispatch.
   *
   * Features register handlers via `ctx.handlers.register()` during their
   * `register()` lifecycle. Handlers are invoked for matching hook and
   * transcript events.
   *
   * @see docs/design/flow.md §2.3 Handler Registration
   * @see docs/design/CORE-RUNTIME.md §3.5 Handler Registry
   */
  handlers: HandlerRegistry

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
