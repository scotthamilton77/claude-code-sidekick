/**
 * @fileoverview Runtime context type definition
 * Phase 4 Track B: RuntimeContext interface for dependency injection
 *
 * Central context object passed to all features during registration.
 * Contains initialized instances of core services.
 */

import type { ConfigService } from './config'
import type { Logger } from './structured-logging'
import type { AssetResolver } from './assets'
import type { LLMService } from '@sidekick/shared-providers'

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

  /** LLM service with telemetry integration */
  llm: LLMService

  /** Resolved runtime paths */
  paths: RuntimePaths

  // Future additions:
  // supervisor: SupervisorClient
}
