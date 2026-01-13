/**
 * Runtime Context Type Definitions
 *
 * Discriminated union types for CLI and Daemon contexts.
 * Enables type-safe role detection and role-specific service access.
 *
 * @see docs/design/CORE-RUNTIME.md §4.1 Runtime Context
 */

import type { HandlerRegistry } from './handler-registry.js'
import type { LLMProvider, ProfileProviderFactory } from './llm.js'
import type { Logger } from './logger.js'
import type { RuntimePaths } from './paths.js'
import type { MinimalConfigService, MinimalAssetResolver } from './services/config.js'
import type { StagingService } from './services/staging.js'
import type { DaemonClient } from './services/daemon-client.js'
import type { TranscriptService } from './services/transcript.js'
import type { MinimalStateService } from './services/state.js'

// ============================================================================
// Runtime Context (Discriminated Union)
// ============================================================================

/**
 * Base context shared by CLI and Daemon.
 * Contains services available in both roles.
 *
 * NOTE: Uses minimal service constraints to avoid circular dependencies.
 * Actual implementations (ConfigService, AssetResolver) are in @sidekick/core
 * and satisfy these minimal constraints via structural typing.
 */
export interface BaseContext {
  /** Configuration service (minimal constraint) */
  config: MinimalConfigService
  /** Structured logger */
  logger: Logger
  /** Asset resolver (minimal constraint) */
  assets: MinimalAssetResolver
  /** Resolved runtime paths */
  paths: RuntimePaths
  /** Handler registry for event dispatch */
  handlers: HandlerRegistry
}

/**
 * CLI context with role discriminant and Daemon client.
 * CLI handles synchronous hook responses.
 */
export interface CLIContext extends BaseContext {
  /** Role discriminant for type narrowing */
  role: 'cli'
  /** Daemon IPC client */
  daemon: DaemonClient
}

/**
 * Daemon context with role discriminant and async services.
 * Daemon handles background work, LLM calls, and file staging.
 */
export interface DaemonContext extends BaseContext {
  /** Role discriminant for type narrowing */
  role: 'daemon'
  /** LLM provider for completions (default profile) */
  llm: LLMProvider
  /** Profile-based provider factory for creating per-feature providers */
  profileFactory: ProfileProviderFactory
  /** Staging service for reminder files */
  staging: StagingService
  /** Transcript service for metrics */
  transcript: TranscriptService
  /** State service for atomic file operations with schema validation */
  stateService: MinimalStateService
}

/**
 * Task context extends DaemonContext with task-specific fields.
 * Used by TaskEngine handlers for background task execution.
 *
 * @see docs/design/DAEMON.md §4.2 Task Execution Engine
 */
export interface TaskContext extends DaemonContext {
  /** Unique task identifier for tracking */
  taskId: string
  /** AbortSignal for task cancellation */
  signal: AbortSignal
}

/**
 * Discriminated union of runtime contexts.
 * TypeScript narrows on `context.role` property.
 *
 * @example
 * ```typescript
 * function handleEvent(ctx: RuntimeContext) {
 *   if (ctx.role === 'daemon') {
 *     // TypeScript knows ctx is DaemonContext
 *     await ctx.llm.complete({ ... });
 *   }
 * }
 * ```
 */
export type RuntimeContext = CLIContext | DaemonContext

// ============================================================================
// Type Guards
// ============================================================================

/**
 * Type guard for CLI context.
 */
export function isCLIContext(ctx: RuntimeContext): ctx is CLIContext {
  return ctx.role === 'cli'
}

/**
 * Type guard for Daemon context.
 */
export function isDaemonContext(ctx: RuntimeContext): ctx is DaemonContext {
  return ctx.role === 'daemon'
}
